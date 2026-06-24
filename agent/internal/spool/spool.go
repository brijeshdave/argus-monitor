// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Disk-backed store-and-forward queue. When the backend is unreachable, snapshots
// are written here and replayed (oldest first) on reconnect — so telemetry is
// never lost across outages. The queue is bounded to protect the host disk.
package spool

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// maxItems caps the queue so a long outage cannot fill the disk (oldest dropped).
const maxItems = 5000

type Spool struct {
	dir string
	mu  sync.Mutex
	seq uint64
}

func New(dir string) (*Spool, error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, err
	}
	return &Spool{dir: dir}, nil
}

// Enqueue persists one payload. Filenames sort chronologically for FIFO replay.
func (s *Spool) Enqueue(data []byte) error {
	s.mu.Lock()
	s.seq++
	name := fmt.Sprintf("%020d-%06d.json", time.Now().UnixNano(), s.seq)
	s.mu.Unlock()

	if err := os.WriteFile(filepath.Join(s.dir, name), data, 0o640); err != nil {
		return err
	}
	s.trim()
	return nil
}

// Drain replays queued payloads oldest-first, deleting each only after `send`
// succeeds. It stops at the first failure so ordering and delivery are preserved.
func (s *Spool) Drain(send func([]byte) error) error {
	files, err := s.list()
	if err != nil {
		return err
	}
	for _, f := range files {
		path := filepath.Join(s.dir, f)
		data, err := os.ReadFile(path)
		if err != nil {
			_ = os.Remove(path) // unreadable: drop and continue
			continue
		}
		if err := send(data); err != nil {
			return err // backend still down — keep the rest for later
		}
		_ = os.Remove(path)
	}
	return nil
}

// Len reports the number of queued items.
func (s *Spool) Len() int {
	files, _ := s.list()
	return len(files)
}

func (s *Spool) list() ([]string, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".json" {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

// trim enforces maxItems by removing the oldest files.
func (s *Spool) trim() {
	files, _ := s.list()
	for i := 0; i < len(files)-maxItems; i++ {
		_ = os.Remove(filepath.Join(s.dir, files[i]))
	}
}
