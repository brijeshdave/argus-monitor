// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// On-demand folder scanner: runs a watched-folder walk in the foreground (call from
// a goroutine) with live progress + cooperative cancel, then stores the result in the
// folder cache so the next telemetry tick picks it up. Drives the "Scan now" + cancel
// controls; scheduled/cached walks still go through Storage() with a nil progress ctx.
package collect

import (
	"strings"
	"sync"
	"time"

	"github.com/brijeshdave/argus-monitor/agent/internal/model"
)

// ScanProgress is a snapshot of a running scan, streamed to the backend.
type ScanProgress struct {
	Status  string // running | done | cancelled
	Folders int
	Files   int
	Bytes   int64
	Current string
}

type scanRun struct {
	running   bool
	cancelled bool
	prog      ScanProgress
}

var (
	scanMu   sync.Mutex
	scanRuns = map[string]*scanRun{}
	scanSend func(monitorID string, p ScanProgress)
)

// SetScanSender registers the callback used to stream progress to the backend.
func SetScanSender(f func(monitorID string, p ScanProgress)) { scanSend = f }

// CancelScan asks a running scan for monitorID to stop at the next checkpoint.
func CancelScan(monitorID string) {
	scanMu.Lock()
	if r := scanRuns[monitorID]; r != nil {
		r.cancelled = true
	}
	scanMu.Unlock()
}

// scanCtx threads progress + cancel through the walk. A nil *scanCtx is the no-op
// (cached tick) path, so all its methods are nil-safe.
type scanCtx struct {
	run      *scanRun
	emit     func()
	lastEmit time.Time
}

func (s *scanCtx) cancelled() bool { return s != nil && s.run.cancelled }

// folder records a folder being entered; returns false when the scan is cancelled.
func (s *scanCtx) folder(current string) bool {
	if s == nil {
		return true
	}
	if s.run.cancelled {
		return false
	}
	s.run.prog.Folders++
	s.run.prog.Current = current
	if time.Since(s.lastEmit) >= time.Second {
		s.lastEmit = time.Now()
		if s.emit != nil {
			s.emit()
		}
	}
	return true
}

// RunScan walks the monitor's watched folders now (call from a goroutine), streaming
// progress + honoring cancel, and refreshes the folder cache with the result.
func RunScan(monitorID, path string, withFolders bool, watch []WatchSpec) {
	scanMu.Lock()
	if r := scanRuns[monitorID]; r != nil && r.running {
		scanMu.Unlock()
		return // already scanning
	}
	run := &scanRun{running: true, prog: ScanProgress{Status: "running"}}
	scanRuns[monitorID] = run
	scanMu.Unlock()

	emit := func() {
		if scanSend != nil {
			scanMu.Lock()
			p := run.prog
			scanMu.Unlock()
			scanSend(monitorID, p)
		}
	}
	ctx := &scanCtx{run: run, emit: emit}
	emit()

	specs := watch
	if len(specs) == 0 && withFolders {
		specs = []WatchSpec{{Sub: ".", Depth: 1}}
	}

	var folders []model.FolderNode
	for _, w := range specs {
		if run.cancelled {
			break
		}
		nodes := walkWatch(path, w, ctx)
		setFolderCache(folderKey(path, w.Sub, scanDepth(w.Depth)), nodes)
		folders = append(folders, nodes...)
	}

	// Final totals from the top-level (non-nested) nodes — no double counting.
	var tFiles int
	var tBytes int64
	for _, n := range folders {
		if !strings.Contains(n.Name, "/") {
			tFiles += n.FileCount
			tBytes += n.SizeBytes
		}
	}
	scanMu.Lock()
	run.running = false
	run.prog.Files = tFiles
	run.prog.Bytes = tBytes
	if run.cancelled {
		run.prog.Status = "cancelled"
	} else {
		run.prog.Status = "done"
	}
	scanMu.Unlock()
	emit()
}
