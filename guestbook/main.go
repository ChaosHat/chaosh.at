// guestbook is the write side of chaosh.at/guestbook/.
//
// The site is static and ships no JavaScript, so the form on /guestbook/
// posts here (sign.chaosh.at), and this stores the entry as pending and
// pushes an ntfy notification with Approve / Reject buttons. Approval marks
// the entry, then asks GitHub Actions to rebuild the site, whose build
// fetches /entries.json and bakes the approved entries into the page. The
// nightly publish also copies /entries.json into the repo as a snapshot, so
// the build has a fallback when this box is unreachable and the book
// outlives the box.
//
// Nothing here touches git. One writer to the repo (publish.py), by design.
//
// Storage is one JSON file, rewritten atomically. A guestbook is not a
// database; the whole thing fits in memory forever.
//
// Env (see /etc/guestbook/env):
//
//	LISTEN          127.0.0.1:8477
//	DATA_DIR        /var/lib/guestbook
//	SITE_URL        https://chaosh.at
//	NTFY_URL        https://ntfy.hatnas.com
//	NTFY_TOPIC      guestbook
//	NTFY_TOKEN      write-only token for the topic
//	GITHUB_TOKEN    fine-grained PAT, Actions read/write on one repo
//	GITHUB_REPO     ChaosHat/chaosh.at
//	GITHUB_WORKFLOW deploy.yml
package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	maxName    = 60
	maxWebsite = 200
	maxMessage = 500
	// Per-IP caps. The gate against spam is moderation, not this; this only
	// keeps one bad night from being fifty pings.
	perHour = 3
	perDay  = 6
	// Approvals within this window share one rebuild.
	dispatchCoalesce = 45 * time.Second
)

type Entry struct {
	ID      int64  `json:"id"`
	Name    string `json:"name"`
	Website string `json:"website,omitempty"`
	Message string `json:"message"`
	Date    string `json:"date"` // RFC 3339, UTC
	Status  string `json:"status"`
	Token   string `json:"token"` // per-entry moderation secret
	IP      string `json:"ip"`
}

type publicEntry struct {
	Name    string `json:"name"`
	Website string `json:"website,omitempty"`
	Message string `json:"message"`
	Date    string `json:"date"`
}

type store struct {
	mu      sync.Mutex
	path    string
	Entries []Entry `json:"entries"`
	NextID  int64   `json:"next_id"`
}

func loadStore(dir string) (*store, error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, err
	}
	s := &store{path: filepath.Join(dir, "guestbook.json"), NextID: 1}
	b, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, s); err != nil {
		return nil, fmt.Errorf("%s: %w", s.path, err)
	}
	return s, nil
}

// save writes the whole file via temp+rename. Caller holds mu.
func (s *store) save() error {
	b, err := json.MarshalIndent(s, "", " ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0o640); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *store) add(e Entry) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e.ID = s.NextID
	s.NextID++
	s.Entries = append(s.Entries, e)
	return e, s.save()
}

// moderate flips a pending entry. Returns the entry and whether it changed.
func (s *store) moderate(id int64, token, status string) (Entry, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.Entries {
		e := &s.Entries[i]
		if e.ID != id || e.Token != token {
			continue
		}
		if e.Status == status {
			return *e, false, nil
		}
		e.Status = status
		return *e, true, s.save()
	}
	return Entry{}, false, errors.New("no such entry")
}

func (s *store) approved() []publicEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]publicEntry, 0, len(s.Entries))
	for _, e := range s.Entries {
		if e.Status == "approved" {
			out = append(out, publicEntry{e.Name, e.Website, e.Message, e.Date})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Date > out[j].Date })
	return out
}

// recent counts signing attempts from ip in the window, pending or not.
// Rejected entries count too — a rejected spammer does not get a fresh quota.
func (s *store) recent(ip string, window time.Duration) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	cut := time.Now().UTC().Add(-window).Format(time.RFC3339)
	n := 0
	for _, e := range s.Entries {
		if e.IP == ip && e.Date >= cut {
			n++
		}
	}
	return n
}

type app struct {
	st       *store
	siteURL  string
	ntfyURL  string
	ntfyTop  string
	ntfyTok  string
	ghToken  string
	ghRepo   string
	ghFlow   string
	selfURL  string
	client   *http.Client
	buildMu  sync.Mutex
	buildDue *time.Timer
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	st, err := loadStore(env("DATA_DIR", "/var/lib/guestbook"))
	if err != nil {
		log.Fatal(err)
	}
	a := &app{
		st:      st,
		siteURL: strings.TrimRight(env("SITE_URL", "https://chaosh.at"), "/"),
		ntfyURL: strings.TrimRight(env("NTFY_URL", "https://ntfy.hatnas.com"), "/"),
		ntfyTop: env("NTFY_TOPIC", "guestbook"),
		ntfyTok: os.Getenv("NTFY_TOKEN"),
		ghToken: os.Getenv("GITHUB_TOKEN"),
		ghRepo:  env("GITHUB_REPO", "ChaosHat/chaosh.at"),
		ghFlow:  env("GITHUB_WORKFLOW", "deploy.yml"),
		selfURL: strings.TrimRight(env("SELF_URL", "https://sign.chaosh.at"), "/"),
		client:  &http.Client{Timeout: 15 * time.Second},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, a.siteURL+"/guestbook/", http.StatusFound)
	})
	mux.HandleFunc("GET /entries.json", a.entries)
	mux.HandleFunc("POST /sign", a.sign)
	mux.HandleFunc("POST /mod/{action}/{id}/{token}", a.moderate)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok\n")) })
	addr := env("LISTEN", "127.0.0.1:8477")
	log.Printf("guestbook listening on %s, %d entries", addr, len(st.Entries))
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(srv.ListenAndServe())
}

func (a *app) entries(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	json.NewEncoder(w).Encode(a.st.approved())
}

// clientIP is the last X-Forwarded-For hop, which is the one Caddy appended.
// Anything earlier in the list was sent by the client and can't be trusted.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[len(parts)-1])
	}
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return h
}

// clean trims, collapses control characters (newlines survive in message),
// and enforces a length in runes.
func clean(s string, max int, multiline bool) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(s) {
		switch {
		case r == '\n' && multiline:
			b.WriteRune(r)
		case r == '\r':
		case unicode.IsControl(r):
		default:
			b.WriteRune(r)
		}
	}
	out := b.String()
	if n := []rune(out); len(n) > max {
		out = string(n[:max])
	}
	return strings.TrimSpace(out)
}

func normalizeWebsite(s string) (string, bool) {
	s = clean(s, maxWebsite, false)
	if s == "" {
		return "", true
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || !strings.Contains(u.Host, ".") {
		return "", false
	}
	u.Fragment = ""
	return u.String(), true
}

func (a *app) sign(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	if err := r.ParseForm(); err != nil {
		a.fail(w, "That was too much. Keep it under 500 characters.")
		return
	}
	thanks := a.siteURL + "/guestbook/thanks/"
	// Honeypot: a hidden field nobody real fills in. Bots that fill it get
	// the same thank-you page and nothing stored, so they learn nothing.
	if r.PostFormValue("email") != "" {
		log.Printf("honeypot from %s", clientIP(r))
		http.Redirect(w, r, thanks, http.StatusSeeOther)
		return
	}
	ip := clientIP(r)
	if a.st.recent(ip, time.Hour) >= perHour || a.st.recent(ip, 24*time.Hour) >= perDay {
		log.Printf("rate limited %s", ip)
		a.fail(w, "You've signed a few times already. Come back tomorrow.")
		return
	}
	name := clean(r.PostFormValue("name"), maxName, false)
	msg := clean(r.PostFormValue("message"), maxMessage, true)
	site, ok := normalizeWebsite(r.PostFormValue("website"))
	switch {
	case name == "":
		a.fail(w, "A name, please. Any name.")
		return
	case msg == "":
		a.fail(w, "The message was empty.")
		return
	case !ok:
		a.fail(w, "That website address didn't parse. Leave it blank if you don't have one.")
		return
	}
	tok := make([]byte, 16)
	if _, err := rand.Read(tok); err != nil {
		a.fail(w, "Something broke on my end. Try again in a minute.")
		return
	}
	e, err := a.st.add(Entry{
		Name: name, Website: site, Message: msg,
		Date: time.Now().UTC().Format(time.RFC3339), Status: "pending",
		Token: hex.EncodeToString(tok), IP: ip,
	})
	if err != nil {
		log.Printf("store: %v", err)
		a.fail(w, "Something broke on my end. Try again in a minute.")
		return
	}
	log.Printf("pending #%d from %s (%q)", e.ID, ip, name)
	go a.notifyNew(e)
	http.Redirect(w, r, thanks, http.StatusSeeOther)
}

func (a *app) moderate(w http.ResponseWriter, r *http.Request) {
	action := r.PathValue("action")
	var status string
	switch action {
	case "approve":
		status = "approved"
	case "reject":
		status = "rejected"
	default:
		http.NotFound(w, r)
		return
	}
	var id int64
	if _, err := fmt.Sscan(r.PathValue("id"), &id); err != nil {
		http.NotFound(w, r)
		return
	}
	e, changed, err := a.st.moderate(id, r.PathValue("token"), status)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	log.Printf("%s #%d (%q) changed=%v", status, e.ID, e.Name, changed)
	if changed && status == "approved" {
		a.requestBuild()
	}
	fmt.Fprintf(w, "%s #%d %s\n", status, e.ID, e.Name)
}

// requestBuild asks GitHub to rebuild, coalescing a burst of approvals into
// one run. The nightly 07:30 UTC build is the fallback if this ever fails.
func (a *app) requestBuild() {
	a.buildMu.Lock()
	defer a.buildMu.Unlock()
	if a.buildDue != nil {
		a.buildDue.Reset(dispatchCoalesce)
		return
	}
	a.buildDue = time.AfterFunc(dispatchCoalesce, func() {
		a.buildMu.Lock()
		a.buildDue = nil
		a.buildMu.Unlock()
		if err := a.dispatch(); err != nil {
			log.Printf("dispatch: %v", err)
			a.ntfy(map[string]any{
				"title":    "guestbook: rebuild failed",
				"message":  err.Error() + "\nApproved entries appear on the next nightly build.",
				"priority": 4, "tags": []string{"warning"},
			})
			return
		}
		log.Print("dispatched site rebuild")
	})
}

func (a *app) dispatch() error {
	if a.ghToken == "" {
		return errors.New("GITHUB_TOKEN unset")
	}
	u := fmt.Sprintf("https://api.github.com/repos/%s/actions/workflows/%s/dispatches", a.ghRepo, a.ghFlow)
	req, _ := http.NewRequest("POST", u, strings.NewReader(`{"ref":"main"}`))
	req.Header.Set("Authorization", "Bearer "+a.ghToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		var b bytes.Buffer
		b.ReadFrom(resp.Body)
		return fmt.Errorf("github %s: %s", resp.Status, strings.TrimSpace(b.String()))
	}
	return nil
}

func (a *app) notifyNew(e Entry) {
	mod := func(action string) string {
		return fmt.Sprintf("%s/mod/%s/%d/%s", a.selfURL, action, e.ID, e.Token)
	}
	body := e.Message
	if e.Website != "" {
		body += "\n" + e.Website
	}
	err := a.ntfy(map[string]any{
		"title":   "guestbook: " + e.Name,
		"message": body,
		"tags":    []string{"book"},
		"actions": []map[string]any{
			{"action": "http", "label": "Approve", "url": mod("approve"), "method": "POST", "clear": true},
			{"action": "http", "label": "Reject", "url": mod("reject"), "method": "POST", "clear": true},
		},
	})
	if err != nil {
		log.Printf("ntfy: %v", err)
	}
}

func (a *app) ntfy(msg map[string]any) error {
	msg["topic"] = a.ntfyTop
	b, _ := json.Marshal(msg)
	req, _ := http.NewRequest("POST", a.ntfyURL, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if a.ntfyTok != "" {
		req.Header.Set("Authorization", "Bearer "+a.ntfyTok)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("ntfy %s", resp.Status)
	}
	return nil
}

// fail is the one page this service renders: a plain refusal with a way
// back. The site has no JS to show inline errors, and the form's own
// required/maxlength attributes catch the ordinary cases before this.
func (a *app) fail(w http.ResponseWriter, why string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusBadRequest)
	fmt.Fprintf(w, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>guestbook</title>
<style>body{background:#0a0c18;color:#eceafa;font:18px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem}a{color:#8ce8cc}</style>
<p>%s</p><p><a href="%s/guestbook/">&larr; back to the guestbook</a></p>
`, html.EscapeString(why), a.siteURL)
}
