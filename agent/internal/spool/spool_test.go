// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
package spool

import (
	"errors"
	"testing"
)

func TestSpoolFifoAndDrain(t *testing.T) {
	s, err := New(t.TempDir())
	if err != nil {
		t.Fatalf("new: %v", err)
	}
	for _, v := range []string{"a", "b", "c"} {
		if err := s.Enqueue([]byte(v)); err != nil {
			t.Fatalf("enqueue: %v", err)
		}
	}
	if s.Len() != 3 {
		t.Fatalf("want 3 queued, got %d", s.Len())
	}

	var got []string
	if err := s.Drain(func(b []byte) error { got = append(got, string(b)); return nil }); err != nil {
		t.Fatalf("drain: %v", err)
	}
	if len(got) != 3 || got[0] != "a" || got[2] != "c" {
		t.Fatalf("want FIFO a,b,c got %v", got)
	}
	if s.Len() != 0 {
		t.Fatalf("queue should be empty after drain, got %d", s.Len())
	}
}

func TestSpoolStopsOnSendFailure(t *testing.T) {
	s, _ := New(t.TempDir())
	_ = s.Enqueue([]byte("x"))
	_ = s.Enqueue([]byte("y"))

	err := s.Drain(func([]byte) error { return errors.New("backend down") })
	if err == nil {
		t.Fatal("expected error from failing send")
	}
	if s.Len() != 2 {
		t.Fatalf("nothing should be removed on failure, got %d", s.Len())
	}
}
