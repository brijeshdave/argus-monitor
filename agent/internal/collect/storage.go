// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Agentless NAS/SMB storage monitoring. A "storage" monitor names a UNC share
// (\\host\share); the agent probes its capacity over SMB and reports a
// StorageSample. Read-only. Status: UP when reachable and under the capacity
// threshold, DEGRADED at/over it, DOWN when unreachable. Capacity collection is
// platform-specific (storage_windows.go / storage_other.go); optional per-folder
// sizing is cross-platform (os walk over the already-authenticated path).
package collect

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/brijeshdave/argus-monitor/agent/internal/model"
)

// capacityThresholdPct → DEGRADED at/over this used %.
const capacityThresholdPct = 90.0

// Folder sizing is expensive (walks the tree), so it's cached per share and only
// refreshed occasionally — never on every telemetry tick.
const (
	folderRefresh  = 15 * time.Minute
	maxTopFolders  = 1000      // cap subfolders reported per level
	maxFolderNodes = 8000      // global cap on emitted folder nodes (payload guard)
	maxFilesWalked = 1_000_000 // hard guard so a huge tree can't stall the agent
	unlimitedDepth = 64        // "unlimited" depth (config depth <= 0) → effectively no limit
)

type folderCacheEntry struct {
	folders []model.FolderNode
	at      time.Time
}

var (
	folderMu    sync.Mutex
	folderCache = map[string]folderCacheEntry{}
)

// WatchSpec is one watched folder with its own scan depth + schedule. RefreshMin is
// the "every N minutes" cadence; ScanTimes (["02:00","14:30"], in ScanTZ / local) runs
// at fixed clock times each day (off-hours heavy scans). ScanTimes wins when set.
type WatchSpec struct {
	Sub        string
	Depth      int
	RefreshMin int
	ScanTimes  []string
	ScanTZ     string
}

// ClearFolderCache drops all cached folder results so the next tick re-walks every
// watched folder. Wired to the "rescan" command (manual "Scan now").
func ClearFolderCache() {
	folderMu.Lock()
	folderCache = map[string]folderCacheEntry{}
	folderMu.Unlock()
}

// dueAt reports whether a folder cached at `last` should be re-walked now. With
// `times` set it runs at fixed clock times each day (in tz, default local): due when
// a scheduled time today has passed and the last walk was before it. Otherwise it
// falls back to the interval ttl.
func dueAt(last time.Time, ttl time.Duration, times []string, tz string) bool {
	if len(times) > 0 {
		loc := time.Local
		if tz != "" {
			if l, err := time.LoadLocation(tz); err == nil {
				loc = l
			}
		}
		now := time.Now().In(loc)
		lastL := last.In(loc)
		for _, t := range times {
			var hh, mm int
			if _, err := fmt.Sscanf(strings.TrimSpace(t), "%d:%d", &hh, &mm); err != nil || hh < 0 || hh > 23 || mm < 0 || mm > 59 {
				continue
			}
			runToday := time.Date(now.Year(), now.Month(), now.Day(), hh, mm, 0, 0, loc)
			if !now.Before(runToday) && lastL.Before(runToday) {
				return true
			}
		}
		return false
	}
	return time.Since(last) >= ttl
}

// Storage probes a UNC share's capacity. Empty path → UNKNOWN (not configured).
// withFolders → top-level folder sizes; watch → those specific subfolders, each with
// its own depth + refresh period. Folder scans are cached (never run on the hot tick).
func Storage(name, path, user, pass string, withFolders bool, watch []WatchSpec) model.Unit {
	if path == "" {
		return model.Unit{Entity: name, Status: statusUNKNOWN}
	}
	total, free, ok := storageCapacity(path, user, pass)
	s := &model.StorageSample{Reachable: ok}
	if !ok {
		return model.Unit{Entity: name, Status: statusDOWN, Meta: &model.UnitMeta{Storage: s}}
	}
	used := int64(0)
	if total > free {
		used = int64(total - free)
	}
	usedPct := 0.0
	if total > 0 {
		usedPct = float64(used) / float64(total) * 100
	}
	t, f := int64(total), int64(free)
	s.TotalBytes, s.FreeBytes, s.UsedBytes, s.UsedPct = &t, &f, &used, &usedPct

	var folders []model.FolderNode
	for _, w := range watch {
		w := w
		ttl := folderRefresh
		if w.RefreshMin > 0 {
			ttl = time.Duration(w.RefreshMin) * time.Minute
		}
		times, tz := w.ScanTimes, w.ScanTZ
		nodes := cachedFolders(folderKey(path, w.Sub, scanDepth(w.Depth)), func(at time.Time) bool { return dueAt(at, ttl, times, tz) }, func() []model.FolderNode {
			return walkWatch(path, w, nil)
		})
		folders = append(folders, nodes...)
	}
	if len(watch) == 0 && withFolders {
		folders = cachedFolders(path+"|top", func(at time.Time) bool { return time.Since(at) >= folderRefresh }, func() []model.FolderNode { budget := maxFolderNodes; return enumFolders(path, "", 1, &budget, nil) })
	}
	if len(folders) > 0 {
		sort.Slice(folders, func(i, j int) bool { return folders[i].SizeBytes > folders[j].SizeBytes })
		s.Folders = folders
	}

	status := statusUP
	if usedPct >= capacityThresholdPct {
		status = statusDEGRADED
	}
	return model.Unit{Entity: name, Status: status, Meta: &model.UnitMeta{Storage: s}}
}

// isSystemFolder reports whether a folder name is a NAS/OS system or hidden folder
// that should be excluded from folder stats (QNAP @Recycle / @Recently-Snapshot /
// .@__thumb / .streams, Windows recycle/SVI, etc.). Anything starting with "@" or "."
// is treated as system/hidden.
func isSystemFolder(name string) bool {
	if name == "" {
		return false
	}
	if name[0] == '@' || name[0] == '.' {
		return true
	}
	switch name {
	case "#recycle", "$RECYCLE.BIN", "System Volume Information", "lost+found":
		return true
	}
	return false
}

// scanDepth resolves a configured depth (0/blank = unlimited) to a concrete depth.
func scanDepth(d int) int {
	if d < 1 {
		return unlimitedDepth
	}
	return d
}

// folderKey is the folderCache key for a (share, watched subfolder, depth) tuple —
// shared by the cached tick path and the on-demand scanner so results line up.
func folderKey(path, sub string, depth int) string {
	return fmt.Sprintf("%s|%s|%d", path, sub, depth)
}

// setFolderCache stores a folder result under key with a fresh timestamp (used by the
// scanner so the next tick reads its result as a cache hit).
func setFolderCache(key string, folders []model.FolderNode) {
	folderMu.Lock()
	folderCache[key] = folderCacheEntry{folders: folders, at: time.Now()}
	folderMu.Unlock()
}

// walkWatch computes one watched folder's tree. "."/"" → the whole share (no wrapper
// node); a named subfolder keeps a wrapper. prog (nil on the cached tick path) streams
// progress + honors cancel for an interactive scan.
func walkWatch(path string, w WatchSpec, prog *scanCtx) []model.FolderNode {
	depth := scanDepth(w.Depth)
	sub, full := w.Sub, filepath.Join(path, w.Sub)
	if _, err := os.Stat(full); err != nil {
		return nil
	}
	budget := maxFolderNodes
	if sub == "" || sub == "." {
		return enumFolders(full, "", depth, &budget, prog)
	}
	size, files, dirs := dirSize(full, prog)
	out := []model.FolderNode{{Name: sub, SizeBytes: size, FileCount: files, FolderCount: dirs}}
	if depth > 1 {
		out = append(out, enumFolders(full, sub, depth-1, &budget, prog)...)
	}
	return out
}

// cachedFolders memoizes a folder-size computation per key; `due(lastAt)` decides
// when to recompute (interval or daily) — folder walks never run on the hot tick.
func cachedFolders(key string, due func(at time.Time) bool, compute func() []model.FolderNode) []model.FolderNode {
	folderMu.Lock()
	entry, ok := folderCache[key]
	folderMu.Unlock()
	if ok && !due(entry.at) {
		return entry.folders
	}
	folders := compute()
	setFolderCache(key, folders)
	return folders
}

// enumFolders lists subfolders of root up to `depth` levels, each with its recursive
// size + file count, path-labelled under `label`. Bounded by maxTopFolders per level
// and a shared node budget (payload guard) so "unlimited" depth can't run away.
func enumFolders(root, label string, depth int, budget *int, prog *scanCtx) []model.FolderNode {
	if *budget <= 0 || prog.cancelled() {
		return nil
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	out := make([]model.FolderNode, 0, 16)
	count := 0
	for _, e := range entries {
		if !e.IsDir() || isSystemFolder(e.Name()) {
			continue
		}
		if count >= maxTopFolders || *budget <= 0 {
			break
		}
		count++
		*budget--
		full := filepath.Join(root, e.Name())
		name := e.Name()
		if label != "" {
			name = label + "/" + name
		}
		if !prog.folder(name) { // returns false when the scan is cancelled
			break
		}
		size, files, dirs := dirSize(full, prog)
		out = append(out, model.FolderNode{Name: name, SizeBytes: size, FileCount: files, FolderCount: dirs})
		if depth > 1 {
			out = append(out, enumFolders(full, name, depth-1, budget, prog)...)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].SizeBytes > out[j].SizeBytes })
	return out
}

// dirSize sums the sizes + counts the files and subfolders under path (recursive).
// Unreadable entries are skipped; the walk stops after maxFilesWalked files so a
// pathological tree can't stall us. With prog set it aborts promptly on cancel.
func dirSize(path string, prog *scanCtx) (size int64, files int, dirs int) {
	_ = filepath.WalkDir(path, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // skip unreadable entries, keep going
		}
		if files >= maxFilesWalked {
			return filepath.SkipAll
		}
		if files%8192 == 0 && prog.cancelled() {
			return filepath.SkipAll // responsive cancel inside file-heavy folders
		}
		if d.IsDir() {
			if p != path {
				if isSystemFolder(d.Name()) {
					return filepath.SkipDir // exclude @Recycle/.streams/… from size + counts
				}
				dirs++
			}
			if dirs%256 == 0 && prog.cancelled() {
				return filepath.SkipAll
			}
			return nil
		}
		if info, e := d.Info(); e == nil {
			size += info.Size()
			files++
		}
		return nil
	})
	return size, files, dirs
}
