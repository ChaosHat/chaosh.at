package main

// Handler tests. Every outbound call goes to an httptest server: nothing here
// can reach ntfy or GitHub. The rebuild debounce runs on fake timers the
// tests fire by hand, so it is exact and instant.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	log.SetOutput(io.Discard)
	os.Exit(m.Run())
}

func ago(d time.Duration) string {
	return time.Now().UTC().Add(-d).Format(time.RFC3339)
}

// stubs stands in for ntfy and GitHub.
type stubs struct {
	ntfy, gh *httptest.Server

	mu       sync.Mutex
	msgs     []map[string]any
	ntfyAuth []string
	ghCalls  []string // "METHOD path auth body"
	ghStatus int
}

func newStubs(t *testing.T) *stubs {
	sb := &stubs{ghStatus: http.StatusNoContent}
	sb.ntfy = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var m map[string]any
		json.NewDecoder(r.Body).Decode(&m)
		sb.mu.Lock()
		sb.msgs = append(sb.msgs, m)
		sb.ntfyAuth = append(sb.ntfyAuth, r.Header.Get("Authorization"))
		sb.mu.Unlock()
	}))
	sb.gh = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		sb.mu.Lock()
		sb.ghCalls = append(sb.ghCalls, r.Method+" "+r.URL.Path+" "+r.Header.Get("Authorization")+" "+string(b))
		code := sb.ghStatus
		sb.mu.Unlock()
		w.WriteHeader(code)
		if code != http.StatusNoContent {
			io.WriteString(w, `{"message":"Bad credentials"}`)
		}
	}))
	t.Cleanup(sb.ntfy.Close)
	t.Cleanup(sb.gh.Close)
	return sb
}

func (sb *stubs) messages() []map[string]any {
	sb.mu.Lock()
	defer sb.mu.Unlock()
	return append([]map[string]any(nil), sb.msgs...)
}

func (sb *stubs) auth(i int) string {
	sb.mu.Lock()
	defer sb.mu.Unlock()
	return sb.ntfyAuth[i]
}

func (sb *stubs) dispatches() []string {
	sb.mu.Lock()
	defer sb.mu.Unlock()
	return append([]string(nil), sb.ghCalls...)
}

func (sb *stubs) setGitHub(code int) {
	sb.mu.Lock()
	defer sb.mu.Unlock()
	sb.ghStatus = code
}

// fakeTimers replaces time.AfterFunc. A timer fires only when a test says.
type fakeTimers struct{ all []*fakeTimer }

type fakeTimer struct {
	f              func()
	stopped, fired bool
}

func (t *fakeTimer) Stop() bool {
	live := !t.stopped && !t.fired
	t.stopped = true
	return live
}

// expire marks the timer fired, as the runtime does just before it starts
// the callback goroutine, and returns the callback for the test to run.
func (t *fakeTimer) expire() func() {
	t.fired = true
	return t.f
}

func (ft *fakeTimers) afterFunc(_ time.Duration, f func()) stopper {
	t := &fakeTimer{f: f}
	ft.all = append(ft.all, t)
	return t
}

func (ft *fakeTimers) live() []*fakeTimer {
	var out []*fakeTimer
	for _, t := range ft.all {
		if !t.stopped && !t.fired {
			out = append(out, t)
		}
	}
	return out
}

// fireAll runs every live timer, as if the window passed.
func (ft *fakeTimers) fireAll() {
	for _, t := range ft.live() {
		t.expire()()
	}
}

const ghToken = "gh-secret-token-do-not-log"

func testEnv(dir string, sb *stubs) map[string]string {
	return map[string]string{
		"DATA_DIR":     dir,
		"NTFY_URL":     sb.ntfy.URL,
		"NTFY_TOPIC":   "test-topic",
		"NTFY_TOKEN":   "ntfy-secret",
		"GITHUB_TOKEN": ghToken,
		"GITHUB_API":   sb.gh.URL,
	}
}

func testApp(t *testing.T, dir string, sb *stubs) (*app, *fakeTimers) {
	t.Helper()
	vars := testEnv(dir, sb)
	a, err := newApp(func(k string) string { return vars[k] })
	if err != nil {
		t.Fatal(err)
	}
	ft := &fakeTimers{}
	a.afterFunc = ft.afterFunc
	return a, ft
}

func form(name, msg string) url.Values {
	return url.Values{"name": {name}, "website": {""}, "message": {msg}, honeypot: {""}}
}

func do(a *app, r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	a.handler().ServeHTTP(w, r)
	a.bg.Wait()
	return w
}

// sign posts f from ip as the site's form does. hdr pairs override headers;
// an empty value removes one.
func sign(a *app, f url.Values, ip string, hdr ...string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/sign", strings.NewReader(f.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.Header.Set("Origin", "https://chaosh.at")
	if ip != "" {
		r.Header.Set("X-Forwarded-For", ip)
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		if hdr[i+1] == "" {
			r.Header.Del(hdr[i])
		} else {
			r.Header.Set(hdr[i], hdr[i+1])
		}
	}
	return do(a, r)
}

func mod(a *app, action string, id, token string) *httptest.ResponseRecorder {
	return do(a, httptest.NewRequest("POST", "/mod/"+action+"/"+id+"/"+token, nil))
}

func publicEntries(t *testing.T, a *app) ([]map[string]any, string) {
	t.Helper()
	w := do(a, httptest.NewRequest("GET", "/entries.json", nil))
	if w.Code != 200 {
		t.Fatalf("/entries.json = %d", w.Code)
	}
	var out []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("/entries.json: %v: %s", err, w.Body)
	}
	return out, w.Body.String()
}

func entries(a *app) []Entry {
	a.st.mu.Lock()
	defer a.st.mu.Unlock()
	return append([]Entry(nil), a.st.Entries...)
}

func onDisk(t *testing.T, dir string) *store {
	t.Helper()
	s, err := loadStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// --- config ---------------------------------------------------------------

func TestConfigRequiresNtfyTopicAndURL(t *testing.T) {
	sb := newStubs(t)
	for _, tc := range []struct {
		unset, set, value, want string
	}{
		{unset: "NTFY_TOPIC", want: "NTFY_TOPIC is unset"},
		{unset: "NTFY_URL", want: "NTFY_URL is unset"},
		{set: "NTFY_URL", value: "ntfy.example.com", want: "not an http(s) URL"},
		{set: "SITE_URL", value: "chaosh.at", want: "SITE_URL"},
	} {
		vars := testEnv(t.TempDir(), sb)
		delete(vars, tc.unset)
		if tc.set != "" {
			vars[tc.set] = tc.value
		}
		_, err := newApp(func(k string) string { return vars[k] })
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("unset %q set %q=%q: err = %v, want %q", tc.unset, tc.set, tc.value, err, tc.want)
		}
	}
	// Both missing are named together, so one edit fixes the file.
	dir := t.TempDir()
	_, err := newApp(func(k string) string { return map[string]string{"DATA_DIR": dir}[k] })
	if err == nil || !strings.Contains(err.Error(), "NTFY_URL") || !strings.Contains(err.Error(), "NTFY_TOPIC") {
		t.Errorf("empty env: %v", err)
	}
	// The production shape: URL, topic, token, the rest defaulted.
	vars := map[string]string{"DATA_DIR": t.TempDir(), "NTFY_URL": "https://ntfy.example.com/", "NTFY_TOPIC": "x", "NTFY_TOKEN": "tk"}
	a, err := newApp(func(k string) string { return vars[k] })
	if err != nil {
		t.Fatal(err)
	}
	if a.ntfyURL != "https://ntfy.example.com" || a.siteOrigin != "https://chaosh.at" || a.selfOrigin != "https://sign.chaosh.at" ||
		a.ghAPI != "https://api.github.com" || a.listen != "127.0.0.1:8477" || a.coalesce != dispatchCoalesce {
		t.Errorf("defaults: url %q origins %q %q api %q listen %q", a.ntfyURL, a.siteOrigin, a.selfOrigin, a.ghAPI, a.listen)
	}
}

// --- /sign ----------------------------------------------------------------

func TestSignHappyPath(t *testing.T) {
	sb := newStubs(t)
	dir := t.TempDir()
	a, _ := testApp(t, dir, sb)
	f := form("Ada", "hello\nthere")
	f.Set("website", "ada.example.com")
	w := sign(a, f, "203.0.113.7")
	if w.Code != http.StatusSeeOther || w.Header().Get("Location") != "https://chaosh.at/guestbook/thanks/" {
		t.Fatalf("sign = %d %q", w.Code, w.Header().Get("Location"))
	}
	es := entries(a)
	if len(es) != 1 {
		t.Fatalf("%d entries", len(es))
	}
	e := es[0]
	if e.ID != 1 || e.Name != "Ada" || e.Message != "hello\nthere" || e.Website != "https://ada.example.com" ||
		e.Status != "pending" || e.IP != "203.0.113.7" || len(e.Token) != 32 {
		t.Errorf("entry = %+v", e)
	}
	if d := onDisk(t, dir); len(d.Entries) != 1 || d.Entries[0] != e || d.NextID != 2 {
		t.Errorf("disk = %+v", d.Entries)
	}
	msgs := sb.messages()
	if len(msgs) != 1 {
		t.Fatalf("%d ntfy messages", len(msgs))
	}
	m := msgs[0]
	if m["topic"] != "test-topic" || m["title"] != "guestbook: Ada" || sb.auth(0) != "Bearer ntfy-secret" {
		t.Errorf("ntfy = %v auth %q", m, sb.auth(0))
	}
	acts, _ := json.Marshal(m["actions"])
	if !strings.Contains(string(acts), "https://sign.chaosh.at/mod/approve/1/"+e.Token) ||
		!strings.Contains(string(acts), "https://sign.chaosh.at/mod/reject/1/"+e.Token) {
		t.Errorf("actions = %s", acts)
	}
	if pub, _ := publicEntries(t, a); len(pub) != 0 {
		t.Errorf("pending entry is public: %v", pub)
	}
}

func TestSignValidation(t *testing.T) {
	sb := newStubs(t)
	a, _ := testApp(t, t.TempDir(), sb)
	long := func(n int) string { return strings.Repeat("é", n) }
	withSite := func(site string) url.Values { f := form("Ada", "hi"); f.Set("website", site); return f }
	for i, tc := range []struct {
		name    string
		f       url.Values
		wantMsg string
	}{
		{"no name", form("", "hi"), "A name, please"},
		{"blank name", form(" \t ", "hi"), "A name, please"},
		{"control-only name", form("\x00\x01", "hi"), "A name, please"},
		{"no message", form("Ada", "   "), "The message was empty"},
		{"javascript site", withSite("javascript:alert(1)"), "website address"},
		{"data site", withSite("data:text/html,<script>alert(1)</script>"), "website address"},
		{"oversized body", form("Ada", strings.Repeat("x", 20<<10)), "too much"},
	} {
		w := sign(a, tc.f, fmt.Sprintf("198.51.100.%d", i+1))
		if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), tc.wantMsg) {
			t.Errorf("%s: %d %q", tc.name, w.Code, w.Body)
		}
	}
	if n := len(entries(a)); n != 0 {
		t.Fatalf("refused posts stored %d entries", n)
	}
	// Over-long fields are cut to the limit in runes, control characters go,
	// newlines survive in the message only.
	w := sign(a, form(long(100)+"\nx", "a\r\nb\x07"+long(600)), "198.51.100.50")
	if w.Code != http.StatusSeeOther {
		t.Fatalf("long post: %d %s", w.Code, w.Body)
	}
	e := entries(a)[0]
	if n := len([]rune(e.Name)); n != maxName || strings.Contains(e.Name, "\n") {
		t.Errorf("name: %d runes %q", n, e.Name)
	}
	if n := len([]rune(e.Message)); n != maxMessage || !strings.HasPrefix(e.Message, "a\nbé") {
		t.Errorf("message: %d runes, starts %q", n, string([]rune(e.Message)[:4]))
	}
}

func TestHoneypotOldAndNewForm(t *testing.T) {
	sb := newStubs(t)
	a, _ := testApp(t, t.TempDir(), sb)
	newForm := func(trap, email string) url.Values {
		f := form("Ada", "hi")
		f.Set(honeypot, trap)
		if email != "" {
			f.Set("email", email)
		}
		return f
	}
	oldForm := func(email string) url.Values {
		return url.Values{"name": {"Ada"}, "website": {""}, "message": {"hi"}, "email": {email}}
	}
	for i, tc := range []struct {
		name   string
		f      url.Values
		stored bool
	}{
		{"new form, trap filled", newForm("red", ""), false},
		{"new form, trap filled and email", newForm("red", "bot@example.com"), false},
		{"new form, autofilled email", newForm("", "ada@example.com"), true},
		{"new form, clean", newForm("", ""), true},
		{"old form, email filled", oldForm("bot@example.com"), false},
		{"old form, clean", oldForm(""), true},
	} {
		before := len(entries(a))
		sent := len(sb.messages())
		w := sign(a, tc.f, fmt.Sprintf("192.0.2.%d", i+1))
		// Trapped or not, the visitor sees the thank-you page.
		if w.Code != http.StatusSeeOther || !strings.HasSuffix(w.Header().Get("Location"), "/guestbook/thanks/") {
			t.Errorf("%s: %d %q", tc.name, w.Code, w.Header().Get("Location"))
		}
		if got := len(entries(a)) > before; got != tc.stored {
			t.Errorf("%s: stored = %v, want %v", tc.name, got, tc.stored)
		}
		if pushed := len(sb.messages()) > sent; pushed != tc.stored {
			t.Errorf("%s: pushed = %v, want %v", tc.name, pushed, tc.stored)
		}
	}
	for _, e := range entries(a) {
		if strings.Contains(e.Name+e.Message+e.Website, "@") {
			t.Errorf("an email got stored: %+v", e)
		}
	}
}

func TestPerIPLimits(t *testing.T) {
	sb := newStubs(t)
	a, _ := testApp(t, t.TempDir(), sb)
	for i := 0; i < perHour; i++ {
		if w := sign(a, form("Ada", "hi"), "203.0.113.5"); w.Code != http.StatusSeeOther {
			t.Fatalf("signing %d: %d", i+1, w.Code)
		}
	}
	w := sign(a, form("Ada", "hi"), "203.0.113.5")
	if w.Code != http.StatusTooManyRequests || !strings.Contains(w.Body.String(), "Come back tomorrow") {
		t.Errorf("over the hourly cap: %d %s", w.Code, w.Body)
	}
	// The same address written IPv4-mapped is the same signer.
	if w := sign(a, form("Ada", "hi"), "::ffff:203.0.113.5"); w.Code != http.StatusTooManyRequests {
		t.Errorf("v4-mapped dodged the cap: %d", w.Code)
	}
	if w := sign(a, form("Bob", "hi"), "203.0.113.6"); w.Code != http.StatusSeeOther {
		t.Errorf("a different IP was refused: %d", w.Code)
	}

	// The daily cap, from signings older than the hour.
	a.st.mu.Lock()
	for i := 0; i < perDay; i++ {
		a.st.Entries = append(a.st.Entries, Entry{ID: int64(100 + i), IP: "203.0.113.9", Status: "rejected", Date: ago(time.Duration(2+i) * time.Hour)})
	}
	a.st.mu.Unlock()
	if w := sign(a, form("Ada", "hi"), "203.0.113.9"); w.Code != http.StatusTooManyRequests {
		t.Errorf("over the daily cap: %d", w.Code)
	}

	// IPv6 counts by /64: three addresses in one block share one quota.
	for i, ip := range []string{"2001:db8:1:2::1", "2001:db8:1:2::2", "2001:db8:1:2:aaaa:bbbb:cccc:dddd"} {
		if w := sign(a, form("Six", "hi"), ip); w.Code != http.StatusSeeOther {
			t.Fatalf("v6 signing %d: %d", i+1, w.Code)
		}
	}
	if w := sign(a, form("Six", "hi"), "2001:db8:1:2:ffff::9"); w.Code != http.StatusTooManyRequests {
		t.Errorf("same /64 dodged the cap: %d", w.Code)
	}
	if w := sign(a, form("Six", "hi"), "2001:db8:1:3::1"); w.Code != http.StatusSeeOther {
		t.Errorf("the next /64 was refused: %d", w.Code)
	}
}

// There is deliberately no global cap (2026-09-18): a busy hour from many
// addresses, with a pile of entries waiting, must all get in.
func TestNoGlobalCap(t *testing.T) {
	sb := newStubs(t)
	a, _ := testApp(t, t.TempDir(), sb)
	a.st.mu.Lock()
	for i := 0; i < 200; i++ {
		a.st.Entries = append(a.st.Entries, Entry{ID: a.st.NextID, IP: fmt.Sprintf("10.1.%d.%d", i/250, i%250+1), Status: "pending", Token: fmt.Sprintf("tok%d", i), Date: ago(time.Duration(i) * time.Second)})
		a.st.NextID++
	}
	a.st.mu.Unlock()
	for i := 0; i < 100; i++ {
		if w := sign(a, form("Visitor", "hi"), fmt.Sprintf("198.18.%d.%d", i/250, i%250+1)); w.Code != http.StatusSeeOther {
			t.Fatalf("signing %d from a fresh IP refused: %d %s", i+1, w.Code, w.Body)
		}
	}
	if n := len(entries(a)); n != 300 {
		t.Errorf("%d entries, want 300", n)
	}
}

func TestOriginCheck(t *testing.T) {
	sb := newStubs(t)
	a, _ := testApp(t, t.TempDir(), sb)
	for i, tc := range []struct {
		origin, referer string
		ok              bool
	}{
		{"https://chaosh.at", "", true},
		{"HTTPS://CHAOSH.AT", "", true},
		{"", "", true},                             // no header at all
		{"null", "", true},                         // no-referrer policy, privacy tools
		{"", "https://chaosh.at/guestbook/", true}, // Referer only
		{"", "https://sign.chaosh.at/", true},      // Referer rewritten to the target
		{"null", "https://chaosh.at/guestbook/", true},
		{"https://evil.example", "", false},
		{"https://chaosh.at.evil.example", "", false},
		{"http://chaosh.at", "", false},
		{"https://evil.example", "https://chaosh.at/guestbook/", false},
		{"", "https://evil.example/page", false},
		{"null", "https://evil.example/page", false},
	} {
		w := sign(a, form("Ada", "hi"), fmt.Sprintf("192.0.2.%d", i+1), "Origin", tc.origin, "Referer", tc.referer)
		want := http.StatusSeeOther
		if !tc.ok {
			want = http.StatusForbidden
		}
		if w.Code != want {
			t.Errorf("Origin %q Referer %q: %d, want %d", tc.origin, tc.referer, w.Code, want)
		}
	}
}

// --- parsing ---------------------------------------------------------------

func TestClientIP(t *testing.T) {
	for _, tc := range []struct{ remote, xff, want string }{
		{"127.0.0.1:5555", "203.0.113.1", "203.0.113.1"},
		{"127.0.0.1:5555", "6.6.6.6, 203.0.113.1", "203.0.113.1"}, // the client's own claim is ignored
		{"127.0.0.1:5555", " 6.6.6.6 ,  2001:db8::1 ", "2001:db8::1"},
		{"192.0.2.9:1234", "", "192.0.2.9"},
		{"[2001:db8::5]:443", "", "2001:db8::5"},
		{"not-a-hostport", "", "not-a-hostport"},
	} {
		r := httptest.NewRequest("POST", "/sign", nil)
		r.RemoteAddr = tc.remote
		if tc.xff != "" {
			r.Header.Set("X-Forwarded-For", tc.xff)
		}
		if got := clientIP(r); got != tc.want {
			t.Errorf("clientIP(%q, XFF %q) = %q, want %q", tc.remote, tc.xff, got, tc.want)
		}
	}
}

func TestRateKey(t *testing.T) {
	for in, want := range map[string]string{
		"203.0.113.5":                "203.0.113.5",
		"::ffff:203.0.113.5":         "203.0.113.5",
		"2001:db8:1:2::1":            "2001:db8:1:2::/64",
		"2001:db8:1:2:ffff:ffff::1":  "2001:db8:1:2::/64",
		"2001:0DB8:0001:0002:0::abc": "2001:db8:1:2::/64",
		"fe80::1%eth0":               "fe80::/64",
		"garbage":                    "garbage",
		"":                           "",
	} {
		if got := rateKey(in); got != want {
			t.Errorf("rateKey(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNormalizeWebsite(t *testing.T) {
	for _, tc := range []struct {
		in, want string
		ok       bool
	}{
		{"", "", true},
		{"   ", "", true},
		{"example.com", "https://example.com", true},
		{"http://example.com/a?b=c#frag", "http://example.com/a?b=c", true},
		{"HTTPS://Example.com/", "https://Example.com/", true},
		{"javascript:alert(1)", "", false},
		{"JavaScript:alert(1)", "", false},
		{"javascript://example.com/%0aalert(1)", "", false},
		{"data:text/html,<script>alert(1)</script>", "", false},
		{"data:text/html;base64,PHNjcmlwdD4=", "", false},
		{"vbscript:msgbox", "", false},
		{"ftp://example.com", "", false},
		{"file:///etc/passwd", "", false},
		{"http://localhost", "", false},
		{"https://", "", false},
		{"//evil.example", "", false},
	} {
		got, ok := normalizeWebsite(tc.in)
		if got != tc.want || ok != tc.ok {
			t.Errorf("normalizeWebsite(%q) = %q, %v; want %q, %v", tc.in, got, ok, tc.want, tc.ok)
		}
	}
}

// --- moderation -------------------------------------------------------------

func TestModerateTokens(t *testing.T) {
	sb := newStubs(t)
	dir := t.TempDir()
	a, ft := testApp(t, dir, sb)
	sign(a, form("Ada", "hi"), "192.0.2.1")
	sign(a, form("Bob", "hi"), "192.0.2.2")
	ada, bob := entries(a)[0], entries(a)[1]

	for _, tc := range []struct{ action, id, token string }{
		{"approve", "1", "wrong"},
		{"approve", "1", bob.Token}, // another entry's token
		{"approve", "1", ""},
		{"approve", "9", ada.Token},
		{"approve", "1abc", ada.Token},
		{"publish", "1", ada.Token},
	} {
		if w := mod(a, tc.action, tc.id, tc.token); w.Code != http.StatusNotFound {
			t.Errorf("%s/%s/%q = %d, want 404", tc.action, tc.id, tc.token, w.Code)
		}
	}
	if w := do(a, httptest.NewRequest("GET", "/mod/approve/1/"+ada.Token, nil)); w.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET moderation = %d, want 405", w.Code)
	}
	if entries(a)[0].Status != "pending" || len(ft.all) != 0 {
		t.Fatalf("a bad request changed something: %+v, %d timers", entries(a)[0], len(ft.all))
	}

	w := mod(a, "approve", "1", ada.Token)
	if w.Code != 200 || w.Body.String() != "approved #1 Ada\n" || !strings.HasPrefix(w.Header().Get("Content-Type"), "text/plain") {
		t.Fatalf("approve = %d %q %q", w.Code, w.Body, w.Header().Get("Content-Type"))
	}
	if onDisk(t, dir).Entries[0].Status != "approved" || a.st.publicChanged().IsZero() {
		t.Error("approval not on disk, or no public_changed")
	}
	if len(ft.live()) != 1 {
		t.Errorf("approve armed %d timers, want 1", len(ft.live()))
	}
	if pub, _ := publicEntries(t, a); len(pub) != 1 || pub[0]["name"] != "Ada" {
		t.Errorf("public = %v", pub)
	}
	// A repeat tap changes nothing and asks for nothing.
	mod(a, "approve", "1", ada.Token)
	if len(ft.all) != 1 {
		t.Errorf("a no-op approve requested a build")
	}
	ft.fireAll()
	// Rejecting a pending entry leaves the page alone: no build.
	mod(a, "reject", "2", bob.Token)
	if len(ft.live()) != 0 {
		t.Errorf("rejecting a pending entry requested a build")
	}
	// Rejecting a live one takes it off the page: build.
	if w := mod(a, "reject", "1", ada.Token); w.Code != 200 {
		t.Fatalf("reject = %d", w.Code)
	}
	if len(ft.live()) != 1 {
		t.Errorf("un-approving requested %d builds, want 1", len(ft.live()))
	}
	if pub, _ := publicEntries(t, a); len(pub) != 0 {
		t.Errorf("rejected entry still public: %v", pub)
	}
}

func TestSaveFailureRollsBack(t *testing.T) {
	sb := newStubs(t)
	dir := t.TempDir()
	a, ft := testApp(t, dir, sb)
	boom := func(string, []byte) error { return errors.New("disk full") }

	a.st.write = boom
	w := sign(a, form("Ada", "hi"), "192.0.2.1")
	if w.Code != http.StatusInternalServerError || w.Header().Get("Location") != "" {
		t.Errorf("sign with a failing disk = %d %q", w.Code, w.Header().Get("Location"))
	}
	if n, next := len(entries(a)), a.st.NextID; n != 0 || next != 1 {
		t.Errorf("after a failed save: %d entries, next id %d", n, next)
	}
	if len(sb.messages()) != 0 {
		t.Error("a failed save still pushed a notification")
	}

	a.st.write = nil
	sign(a, form("Ada", "hi"), "192.0.2.1")
	e := entries(a)[0]
	if e.ID != 1 {
		t.Fatalf("id after the failed attempt = %d, want 1", e.ID)
	}

	a.st.write = boom
	w = mod(a, "approve", "1", e.Token)
	if w.Code != http.StatusInternalServerError || !strings.Contains(w.Body.String(), "nothing changed") {
		t.Errorf("approve with a failing disk = %d %q", w.Code, w.Body)
	}
	if got := entries(a)[0].Status; got != "pending" {
		t.Errorf("memory says %q after a failed save", got)
	}
	if !a.st.publicChanged().IsZero() {
		t.Error("public_changed moved on a failed save")
	}
	if pub, _ := publicEntries(t, a); len(pub) != 0 {
		t.Errorf("/entries.json serves an approval the disk doesn't hold: %v", pub)
	}
	if len(ft.all) != 0 {
		t.Error("a failed approval requested a build")
	}
	if onDisk(t, dir).Entries[0].Status != "pending" {
		t.Error("disk changed")
	}

	// Un-approving fails the same way, and the entry stays live.
	a.st.write = nil
	mod(a, "approve", "1", e.Token)
	ft.fireAll()
	a.st.write = boom
	if w := mod(a, "reject", "1", e.Token); w.Code != http.StatusInternalServerError {
		t.Errorf("reject with a failing disk = %d", w.Code)
	}
	if pub, _ := publicEntries(t, a); len(pub) != 1 {
		t.Errorf("memory dropped an entry the disk still has approved")
	}
	if len(ft.live()) != 0 {
		t.Error("a failed un-approval requested a build")
	}
}

func TestEntriesJSONOnlyApprovedAndPublicFields(t *testing.T) {
	sb := newStubs(t)
	a, _ := testApp(t, t.TempDir(), sb)
	a.st.Entries = []Entry{
		{ID: 1, Name: "Old", Message: "m1", Date: ago(48 * time.Hour), Status: "approved", Token: "tok-one-secret", IP: "203.0.113.1"},
		{ID: 2, Name: "Pend", Message: "m2", Date: ago(2 * time.Hour), Status: "pending", Token: "tok-two-secret", IP: "203.0.113.2"},
		{ID: 3, Name: "Rej", Message: "m3", Date: ago(3 * time.Hour), Status: "rejected", Token: "tok-three-secret", IP: "203.0.113.3"},
		{ID: 4, Name: "New", Website: "https://new.example", Message: "m4", Date: ago(time.Hour), Status: "approved", Token: "tok-four-secret", IP: "2001:db8::4"},
	}
	pub, raw := publicEntries(t, a)
	if len(pub) != 2 || pub[0]["name"] != "New" || pub[1]["name"] != "Old" {
		t.Fatalf("public = %v, want New then Old", pub)
	}
	allowed := map[string]bool{"name": true, "website": true, "message": true, "date": true}
	for _, e := range pub {
		for k := range e {
			if !allowed[k] {
				t.Errorf("public entry carries %q", k)
			}
		}
	}
	if _, ok := pub[1]["website"]; ok {
		t.Error("empty website not omitted")
	}
	for _, secret := range []string{"tok-", "203.0.113", "2001:db8::4", "Pend", "Rej", "pending", "rejected", "email", "\"id\""} {
		if strings.Contains(raw, secret) {
			t.Errorf("/entries.json contains %q: %s", secret, raw)
		}
	}
	// An empty book is [], not null.
	b, _ := testApp(t, t.TempDir(), sb)
	if _, raw := publicEntries(t, b); strings.TrimSpace(raw) != "[]" {
		t.Errorf("empty book = %q", raw)
	}
}

// --- rebuild ---------------------------------------------------------------

func TestRequestBuildCoalesces(t *testing.T) {
	sb := newStubs(t)
	a, ft := testApp(t, t.TempDir(), sb)
	a.requestBuild()
	a.requestBuild()
	a.requestBuild()
	if len(ft.all) != 3 || len(ft.live()) != 1 {
		t.Fatalf("%d timers, %d live; want each request to replace the last", len(ft.all), len(ft.live()))
	}
	ft.fireAll()
	calls := sb.dispatches()
	if len(calls) != 1 {
		t.Fatalf("%d dispatches for one burst", len(calls))
	}
	want := "POST /repos/ChaosHat/chaosh.at/actions/workflows/deploy.yml/dispatches Bearer " + ghToken + ` {"ref":"main"}`
	if calls[0] != want {
		t.Errorf("dispatch = %q\nwant       %q", calls[0], want)
	}
	if _, ok := a.lastDispatch(); !ok {
		t.Error("no marker after a successful dispatch")
	}
}

// The old bug: a request landing after the timer fired but before its
// callback took the lock re-armed the same timer, and the burst dispatched
// twice. Here the first timer has expired and its callback is still to run;
// the new request must leave exactly one dispatch between them.
func TestRequestBuildNoDoubleFire(t *testing.T) {
	sb := newStubs(t)
	a, ft := testApp(t, t.TempDir(), sb)
	a.requestBuild()
	first := ft.all[0].expire() // fired, callback not yet run
	a.requestBuild()
	first()
	if n := len(sb.dispatches()); n != 0 {
		t.Fatalf("superseded callback dispatched (%d)", n)
	}
	ft.fireAll()
	if n := len(sb.dispatches()); n != 1 {
		t.Fatalf("%d dispatches, want exactly 1", n)
	}
	// An approval after a dispatch has gone out gets a run of its own.
	a.requestBuild()
	ft.fireAll()
	if n := len(sb.dispatches()); n != 2 {
		t.Errorf("%d dispatches, want 2", n)
	}
}

// Real timers and many goroutines, for -race: a burst inside one short
// window still gives one run.
func TestRequestBuildConcurrent(t *testing.T) {
	sb := newStubs(t)
	a, _ := testApp(t, t.TempDir(), sb)
	a.afterFunc = func(d time.Duration, f func()) stopper { return time.AfterFunc(d, f) }
	a.coalesce = 100 * time.Millisecond
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); a.requestBuild() }()
	}
	wg.Wait()
	deadline := time.Now().Add(5 * time.Second)
	for len(sb.dispatches()) == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	time.Sleep(300 * time.Millisecond)
	if n := len(sb.dispatches()); n != 1 {
		t.Errorf("%d dispatches for one burst", n)
	}
}

func TestDispatchFailureWarnsAndNeverLogsToken(t *testing.T) {
	sb := newStubs(t)
	a, ft := testApp(t, t.TempDir(), sb)
	sb.setGitHub(http.StatusUnauthorized)
	var buf bytes.Buffer
	log.SetOutput(&buf)
	defer log.SetOutput(io.Discard)
	a.requestBuild()
	ft.fireAll()
	msgs := sb.messages()
	if len(msgs) != 1 || msgs[0]["title"] != "guestbook: rebuild failed" || !strings.Contains(msgs[0]["message"].(string), "401") {
		t.Fatalf("warning = %v", msgs)
	}
	all, _ := json.Marshal(msgs)
	if strings.Contains(buf.String(), ghToken) || strings.Contains(string(all), ghToken) {
		t.Errorf("the GitHub token leaked: log %q", buf.String())
	}
	if !strings.Contains(buf.String(), "401") {
		t.Errorf("the failure wasn't logged: %q", buf.String())
	}
	if _, ok := a.lastDispatch(); ok {
		t.Error("marker written for a failed dispatch")
	}
}

func TestRestartInsideWindowStillRebuilds(t *testing.T) {
	sb := newStubs(t)
	dir := t.TempDir()
	a, ft := testApp(t, dir, sb)
	sign(a, form("Ada", "hi"), "192.0.2.1")
	mod(a, "approve", "1", entries(a)[0].Token)
	if len(ft.live()) != 1 || len(sb.dispatches()) != 0 {
		t.Fatal("setup: want one armed, unfired timer")
	}
	// The process dies here, timer unfired. The next one starts.
	b, bt := testApp(t, dir, sb)
	b.resumeBuild()
	if len(bt.live()) != 1 {
		t.Fatalf("restart lost the rebuild: %d timers", len(bt.live()))
	}
	bt.fireAll()
	if n := len(sb.dispatches()); n != 1 {
		t.Fatalf("%d dispatches", n)
	}
	// Once dispatched, a further restart asks for nothing.
	c, ct := testApp(t, dir, sb)
	c.resumeBuild()
	if len(ct.all) != 0 {
		t.Error("restart after a dispatch asked again")
	}
	// A dispatch that failed counts as not sent.
	mod(c, "reject", "1", entries(c)[0].Token)
	sb.setGitHub(http.StatusBadGateway)
	ct.fireAll()
	sb.setGitHub(http.StatusNoContent)
	d, dt := testApp(t, dir, sb)
	d.resumeBuild()
	if len(dt.live()) != 1 {
		t.Error("restart after a failed dispatch didn't ask again")
	}
}

// --- storage ---------------------------------------------------------------

// The file as the service wrote it before 2026-11-11, from that code's
// structs: no public_changed, no marker beside it.
const oldFormat = `{
 "entries": [
  {
   "id": 1,
   "name": "Declan",
   "website": "https://vale.rocks",
   "message": "Love the vibes",
   "date": "2026-11-03T03:25:19Z",
   "status": "approved",
   "token": "0123456789abcdef0123456789abcdef",
   "ip": ""
  },
  {
   "id": 2,
   "name": "Pending Pat",
   "message": "hi\nthere",
   "date": "2026-11-10T12:00:00Z",
   "status": "pending",
   "token": "fedcba9876543210fedcba9876543210",
   "ip": "203.0.113.9"
  }
 ],
 "next_id": 3
}
`

func TestOldFormatLoadsAndRoundTrips(t *testing.T) {
	sb := newStubs(t)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "guestbook.json"), []byte(oldFormat), 0o640); err != nil {
		t.Fatal(err)
	}
	a, ft := testApp(t, dir, sb)
	a.resumeBuild()
	if len(ft.all) != 0 {
		t.Error("an old file with no public_changed asked for a rebuild")
	}
	pub, _ := publicEntries(t, a)
	if len(pub) != 1 || pub[0]["name"] != "Declan" || pub[0]["date"] != "2026-11-03T03:25:19Z" || pub[0]["website"] != "https://vale.rocks" {
		t.Fatalf("public = %v", pub)
	}
	if w := mod(a, "approve", "2", "fedcba9876543210fedcba9876543210"); w.Code != 200 {
		t.Fatalf("approve an old entry: %d", w.Code)
	}
	sign(a, form("New", "hi"), "192.0.2.1")
	if e := entries(a)[2]; e.ID != 3 {
		t.Errorf("new id = %d, want next_id 3", e.ID)
	}
	// What the old binary would read back (rollback safety): the same
	// fields, the new one ignored.
	type oldStore struct {
		Entries []Entry `json:"entries"`
		NextID  int64   `json:"next_id"`
	}
	b, _ := os.ReadFile(filepath.Join(dir, "guestbook.json"))
	var old oldStore
	if err := json.Unmarshal(b, &old); err != nil || len(old.Entries) != 3 || old.NextID != 4 || old.Entries[1].Status != "approved" {
		t.Errorf("old reader: %v %+v", err, old)
	}
	var keys map[string]json.RawMessage
	json.Unmarshal(b, &keys)
	if len(keys) != 3 || keys["public_changed"] == nil {
		t.Errorf("top-level keys: %v", keys)
	}
}

func TestWriteDurable(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "g.json")
	if err := writeDurable(p, []byte("one")); err != nil {
		t.Fatal(err)
	}
	if err := writeDurable(p, []byte("two")); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(p); string(b) != "two" {
		t.Errorf("content %q", b)
	}
	if fi, _ := os.Stat(p); fi.Mode().Perm()&^0o640 != 0 {
		t.Errorf("mode %v, want at most 0640", fi.Mode())
	}
	if _, err := os.Stat(p + ".tmp"); !os.IsNotExist(err) {
		t.Error("temp file left behind")
	}
	if err := writeDurable(filepath.Join(dir, "missing", "g.json"), []byte("x")); err == nil {
		t.Error("no error writing into a missing directory")
	}
}

func TestIPsBlankedAfter30Days(t *testing.T) {
	s := &store{path: t.TempDir() + "/g.json", NextID: 1}
	s.Entries = []Entry{
		{ID: 1, IP: "1.1.1.1", Date: ago(31 * 24 * time.Hour)},
		{ID: 2, IP: "2.2.2.2", Date: ago(29 * 24 * time.Hour)},
		{ID: 3, IP: "3.3.3.3", Date: ago(time.Hour)},
	}
	if err := s.save(); err != nil {
		t.Fatal(err)
	}
	if s.Entries[0].IP != "" {
		t.Errorf("31-day-old IP survived: %q", s.Entries[0].IP)
	}
	if s.Entries[1].IP != "2.2.2.2" {
		t.Errorf("29-day-old IP was blanked: %q", s.Entries[1].IP)
	}
	if s.Entries[2].IP != "3.3.3.3" {
		t.Errorf("fresh IP was blanked: %q", s.Entries[2].IP)
	}
	// A blanked IP matches no client, so it never eats anyone's quota.
	if err := s.admit("", time.Now()); err != nil {
		t.Errorf("blank IP: %v", err)
	}
}
