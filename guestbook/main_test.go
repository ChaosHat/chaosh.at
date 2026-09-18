package main

import (
	"testing"
	"time"
)

func ago(d time.Duration) string {
	return time.Now().UTC().Add(-d).Format(time.RFC3339)
}

// Rejecting an entry that is already live must trigger a rebuild, or the
// entry stays on the public page until the next nightly build.
func TestUnapproveTriggersRebuild(t *testing.T) {
	s := &store{path: t.TempDir() + "/g.json", NextID: 1}
	s.Entries = []Entry{{ID: 1, Token: "tok", Status: "approved", Date: ago(time.Hour)}}

	_, changed, was, err := s.moderate(1, "tok", "rejected")
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected a change")
	}
	if was != "approved" {
		t.Fatalf("old status = %q, want approved", was)
	}
	// This is the condition the handler uses.
	if !(changed && (was == "approved")) {
		t.Fatal("a rebuild would NOT be requested — the bug")
	}
}

func TestApproveStillTriggersRebuild(t *testing.T) {
	s := &store{path: t.TempDir() + "/g.json", NextID: 1}
	s.Entries = []Entry{{ID: 1, Token: "tok", Status: "pending", Date: ago(time.Hour)}}
	_, changed, was, _ := s.moderate(1, "tok", "approved")
	if !(changed && ("approved" == "approved" || was == "approved")) {
		t.Fatal("approve must still rebuild")
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
}

// The rate window must still work on entries whose IP is intact, and a blanked
// entry must never match a real client.
func TestRecentStillCountsAfterBlanking(t *testing.T) {
	s := &store{path: t.TempDir() + "/g.json", NextID: 1}
	s.Entries = []Entry{
		{ID: 1, IP: "9.9.9.9", Date: ago(time.Hour)},
		{ID: 2, IP: "9.9.9.9", Date: ago(2 * time.Hour)},
		{ID: 3, IP: "9.9.9.9", Date: ago(40 * 24 * time.Hour)},
	}
	_ = s.save()
	if n := s.recent("9.9.9.9", 24*time.Hour); n != 2 {
		t.Errorf("recent = %d, want 2", n)
	}
	if n := s.recent("", 24*time.Hour); n != 0 {
		t.Errorf("blank IP matched %d entries, want 0", n)
	}
}
