// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// logbuf is a thread-safe, bounded ring buffer of recent operational log lines.
// Operational events (registered, config refreshed, ingest failed, …) are routed
// here so they BOTH print to the host stdout (visible on the box) AND stream to
// the operator UI on the next ingest tick. The buffer is bounded and never blocks
// the collect/push hot path — when full, the oldest lines are dropped.
package logbuf

import (
	"bytes"
	"fmt"
	"log"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

// cap is the maximum number of lines retained before the oldest are dropped.
const cap = 500

// maxFileBytes bounds the on-disk log file (rotated by keeping the last half), so
// it can be tailed by `argus-agent logs` without ever cluttering the host disk.
const maxFileBytes = 256 * 1024

var (
	fileMu  sync.Mutex
	logFile string
	loc     = time.UTC
)

func init() {
	// We prepend our own timezone-aware timestamp, so disable the stdlib prefix to
	// avoid a second (local-time) stamp on each console line.
	log.SetFlags(0)
}

// SetFile enables mirroring log lines to a capped file on disk (empty = disabled).
func SetFile(path string) {
	fileMu.Lock()
	logFile = path
	fileMu.Unlock()
}

// SetLocation sets the timezone used for all log timestamps (console + file).
// Defaults to UTC; the backend can push the server's timezone, overridable locally.
func SetLocation(l *time.Location) {
	if l == nil {
		return
	}
	fileMu.Lock()
	loc = l
	fileMu.Unlock()
}

// stamp formats "now" in the configured timezone, including the zone abbreviation.
func stamp() string {
	fileMu.Lock()
	l := loc
	fileMu.Unlock()
	return time.Now().In(l).Format("2006-01-02 15:04:05 MST")
}

// writeFile appends one stamped line to the on-disk log, rotating when too large.
// Best-effort: any error is swallowed (logging must never break the agent).
func writeFile(ts, level, msg string) {
	fileMu.Lock()
	path := logFile
	fileMu.Unlock()
	if path == "" {
		return
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	_, _ = f.WriteString(ts + " [" + level + "] " + msg + "\n")
	fi, statErr := f.Stat()
	_ = f.Close()
	if statErr == nil && fi.Size() > maxFileBytes {
		rotate(path)
	}
}

// emit stamps a line once and writes it to stdout, the ring buffer and the file.
func emit(level, msg string) {
	ts := stamp()
	log.Print(ts + " " + msg)
	def.Add(level, "agent", msg)
	writeFile(ts, level, msg)
}

// rotate trims the log file to its most recent half (dropping the partial first line).
func rotate(path string) {
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	if len(b) > maxFileBytes/2 {
		b = b[len(b)-maxFileBytes/2:]
		if i := bytes.IndexByte(b, '\n'); i >= 0 {
			b = b[i+1:]
		}
	}
	_ = os.WriteFile(path, b, 0o600)
}

// Line is one buffered log entry. Category defaults to "agent" when emitted.
type Line struct {
	Level    string
	Message  string
	Category string
}

// Buffer is a bounded FIFO of recent log lines, safe for concurrent use.
type Buffer struct {
	mu    sync.Mutex
	lines []Line
}

// New returns an empty buffer.
func New() *Buffer { return &Buffer{} }

// Add appends a line, dropping the oldest if the buffer is full. Never blocks.
func (b *Buffer) Add(level, category, message string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.lines) >= cap {
		// Drop the oldest entry to make room (bounded memory).
		b.lines = b.lines[1:]
	}
	b.lines = append(b.lines, Line{Level: level, Category: category, Message: message})
}

// Drain returns up to cap buffered lines and clears the buffer.
func (b *Buffer) Drain() []Line {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.lines) == 0 {
		return nil
	}
	out := b.lines
	b.lines = nil
	if len(out) > cap {
		out = out[len(out)-cap:]
	}
	return out
}

// def is the package-level default buffer used by the helpers below.
var def = New()

// Default returns the package-level buffer (drained each tick by the run loop).
func Default() *Buffer { return def }

// Info logs an informational line to stdout, the buffer AND the on-disk log.
func Info(msg string) { emit("info", msg) }

// Warn logs a warning line to stdout, the buffer AND the on-disk log.
func Warn(msg string) { emit("warn", msg) }

// Errorf formats an error line and writes it to stdout, the buffer AND the disk log.
func Errorf(format string, args ...any) { emit("error", fmt.Sprintf(format, args...)) }

// debugOn gates verbose DEBUG output; toggled live by the server (config.debug).
var debugOn atomic.Bool

// SetDebug enables/disables verbose debug logging (server-controlled, no restart).
func SetDebug(on bool) {
	if debugOn.Swap(on) != on {
		emit("info", fmt.Sprintf("argus-agent: debug logging %s", map[bool]string{true: "enabled", false: "disabled"}[on]))
	}
}

// DebugEnabled reports whether verbose debug logging is on.
func DebugEnabled() bool { return debugOn.Load() }

// Debugf formats a DEBUG line, but only emits when debug logging is enabled.
func Debugf(format string, args ...any) {
	if debugOn.Load() {
		emit("debug", fmt.Sprintf(format, args...))
	}
}
