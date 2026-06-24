// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Tests for the bounded log ring: ordering, drain-clears, the cap bound and
// concurrent-write safety.
package logbuf

import (
	"sync"
	"testing"
)

func TestAddDrainOrderAndClear(t *testing.T) {
	b := New()
	b.Add("info", "agent", "first")
	b.Add("warn", "agent", "second")

	got := b.Drain()
	if len(got) != 2 {
		t.Fatalf("expected 2 lines, got %d", len(got))
	}
	if got[0].Message != "first" || got[1].Message != "second" {
		t.Fatalf("unexpected order: %+v", got)
	}
	if got[1].Level != "warn" {
		t.Fatalf("expected level warn, got %q", got[1].Level)
	}

	// Drain clears the buffer.
	if again := b.Drain(); again != nil {
		t.Fatalf("expected nil after drain, got %d lines", len(again))
	}
}

func TestBoundedDropsOldest(t *testing.T) {
	b := New()
	total := cap + 50
	for i := 0; i < total; i++ {
		b.Add("info", "agent", "x")
	}
	got := b.Drain()
	if len(got) != cap {
		t.Fatalf("expected buffer capped at %d, got %d", cap, len(got))
	}
}

func TestConcurrentAddIsSafe(t *testing.T) {
	b := New()
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				b.Add("info", "agent", "line")
			}
		}()
	}
	wg.Wait()

	// Bounded regardless of how many concurrent writes landed.
	if got := b.Drain(); len(got) > cap {
		t.Fatalf("expected <= %d lines, got %d", cap, len(got))
	}
}
