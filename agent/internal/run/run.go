// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Foreground run loop (dev mode and the body of the service). Registers with the
// backend (retrying with capped backoff), then on each tick drains any spooled
// telemetry and pushes a fresh snapshot. Transport failures spool to disk;
// "not approved" is a benign wait. Everything is context-cancellable.
package run

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/brijeshdave/argus-monitor/agent/internal/collect"
	"github.com/brijeshdave/argus-monitor/agent/internal/config"
	"github.com/brijeshdave/argus-monitor/agent/internal/control"
	"github.com/brijeshdave/argus-monitor/agent/internal/logbuf"
	"github.com/brijeshdave/argus-monitor/agent/internal/model"
	"github.com/brijeshdave/argus-monitor/agent/internal/spool"
	"github.com/brijeshdave/argus-monitor/agent/internal/transport"
	"github.com/brijeshdave/argus-monitor/agent/internal/update"
)

const maxBackoff = 60 * time.Second

// scanMsg is the agent→server folder-scan progress frame (matches @argus/shared
// ScanProgressMsg). Sent over the control channel during a "Scan now".
type scanMsg struct {
	T         string `json:"t"`
	MonitorID string `json:"monitorId"`
	Status    string `json:"status"`
	Folders   int    `json:"folders"`
	Files     int    `json:"files"`
	Bytes     int64  `json:"bytes"`
	Current   string `json:"current"`
}

// Latest monitor list, exposed to the (separate) control goroutine so a rescan
// command can resolve a monitor id → its storage config.
var (
	monMu       sync.Mutex
	curMonitors []model.MonitorConfig
)

func storeMonitors(m []model.MonitorConfig) {
	monMu.Lock()
	curMonitors = m
	monMu.Unlock()
}

func findStorageMonitor(id string) (model.MonitorConfig, bool) {
	monMu.Lock()
	defer monMu.Unlock()
	for _, m := range curMonitors {
		if m.ID == id && m.Type == "storage" {
			return m, true
		}
	}
	return model.MonitorConfig{}, false
}

// Live collect/push cadence control. The ticker is created in Run; both the
// periodic config pull and the control-channel "config" command can reset it
// without a restart. While DEBUG is on we drop to a fast cadence so operational
// logs (which ride the snapshot push) reach the UI near-live instead of waiting a
// full push interval. Guarded because the control goroutine runs separately.
const debugCadenceSec = 3

var (
	ivMu      sync.Mutex
	ivTicker  *time.Ticker
	ivCurSec  int  // cadence currently applied to the ticker
	ivBaseSec int  // configured (non-debug) cadence
	ivDebug   bool // debug fast-cadence override active
)

// bindTicker registers the loop's ticker so the cadence can be reset later.
func bindTicker(t *time.Ticker, sec int) {
	ivMu.Lock()
	ivTicker = t
	ivCurSec = sec
	ivBaseSec = sec
	ivMu.Unlock()
}

// applyInterval sets the configured collect/push cadence (clamped 5s–1h).
func applyInterval(sec int) {
	if sec < 5 {
		sec = 5
	}
	if sec > 3600 {
		sec = 3600
	}
	ivMu.Lock()
	defer ivMu.Unlock()
	ivBaseSec = sec
	reapplyCadenceLocked()
}

// setDebugCadence turns the debug fast-cadence override on/off so live logs flow
// quickly while debugging, then revert to the configured cadence.
func setDebugCadence(on bool) {
	ivMu.Lock()
	defer ivMu.Unlock()
	ivDebug = on
	reapplyCadenceLocked()
}

// reapplyCadenceLocked resets the ticker to the effective cadence. Caller holds ivMu.
func reapplyCadenceLocked() {
	if ivTicker == nil {
		return
	}
	want := ivBaseSec
	if ivDebug && debugCadenceSec < want {
		want = debugCadenceSec
	}
	if want == ivCurSec {
		return
	}
	ivCurSec = want
	ivTicker.Reset(time.Duration(want) * time.Second)
	suffix := ""
	if ivDebug && want == debugCadenceSec {
		suffix = " (debug)"
	}
	logbuf.Info(fmt.Sprintf("argus-agent: push interval set to %ds%s", want, suffix))
}

// versionAtLeast reports whether dotted version cur >= target (numeric compare;
// non-numeric parts treated as 0). Used to skip a self-update we don't need.
func versionAtLeast(cur, target string) bool {
	norm := func(v string) []int {
		v = strings.TrimPrefix(v, "v")
		parts := strings.FieldsFunc(v, func(r rune) bool { return r == '.' || r == '-' || r == '+' })
		out := make([]int, len(parts))
		for i, p := range parts {
			out[i], _ = strconv.Atoi(p)
		}
		return out
	}
	a, b := norm(cur), norm(target)
	for i := 0; i < len(a) || i < len(b); i++ {
		var x, y int
		if i < len(a) {
			x = a[i]
		}
		if i < len(b) {
			y = b[i]
		}
		if x != y {
			return x > y
		}
	}
	return true // equal
}

// localTZ holds the operator's timezone override (config file / env), if any. When
// empty the agent follows the server-provided timezone on each config refresh.
var localTZ string

// applyTimezone switches log timestamps to the named IANA zone (tzdata is embedded,
// so any zone resolves on any OS). Unknown names are ignored (kept as-is).
func applyTimezone(name string) {
	if name == "" {
		return
	}
	if l, err := time.LoadLocation(name); err == nil {
		logbuf.SetLocation(l)
	} else {
		logbuf.Warn(fmt.Sprintf("argus-agent: unknown timezone %q — keeping current", name))
	}
}

// LogFilePath is the on-disk operational log location: agent.log next to the binary
// (matches the config file). Used by the run loop (writer) and `logs` (reader).
func LogFilePath() string {
	exe, err := os.Executable()
	if err != nil {
		return "agent.log"
	}
	if resolved, e := filepath.EvalSymlinks(exe); e == nil {
		exe = resolved
	}
	return filepath.Join(filepath.Dir(exe), "agent.log")
}

// sweepOldBinaries removes leftover "<exe>.<ts>.old" files from a prior self-update
// (Windows can't delete the running .exe, so the old one is moved aside and cleaned
// up here on the next start, once it's no longer locked). Best-effort.
func sweepOldBinaries() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	if resolved, e := filepath.EvalSymlinks(exe); e == nil {
		exe = resolved
	}
	matches, _ := filepath.Glob(exe + ".*.old")
	matches = append(matches, exe+".old")
	for _, m := range matches {
		_ = os.Remove(m)
	}
}

// configEveryNTicks is how often (in ticks) we re-pull the monitor list. Between
// refreshes the agent runs off its cached config so a backend blip never blinds it.
const configEveryNTicks = 4

// inventoryEveryNTicks is how often (in ticks) we re-discover + push the host's
// services/processes. Discovery is heavier than a normal tick, so it runs rarely.
const inventoryEveryNTicks = 40

// agentArtifactName returns the build file name for the running platform — it must
// match the backend's naming (argus-agent-<GOOS>-<GOARCH>, .exe on Windows) so the
// agent can fetch the correct binary for a self-update.
func agentArtifactName() string {
	name := fmt.Sprintf("argus-agent-%s-%s", runtime.GOOS, runtime.GOARCH)
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return name
}

// ── Additional ingest hosts (server-pushed) ──────────────────────────────────
// The master delivers extra backends to ALSO push telemetry to (see ConfigResponse
// .IngestHosts). The agent uses its existing key for each. Best-effort: a failed
// extra push is logged and dropped (never spooled) so it can't disturb the primary.
type extraTarget struct {
	host   string
	client *transport.Client
}

var (
	extraMu      sync.Mutex
	extraTargets []extraTarget
	agentKey     string // captured at Run() start, for building extra-host clients
	primaryURL   string // captured at Run() start, for the status file
	agentVersion string // captured at Run() start, for the status file
)

// setExtraHosts rebuilds the extra-target clients from a server-pushed host list.
func setExtraHosts(hosts []string) {
	extraMu.Lock()
	defer extraMu.Unlock()
	same := len(hosts) == len(extraTargets)
	if same {
		for i := range hosts {
			if hosts[i] != extraTargets[i].host {
				same = false
				break
			}
		}
	}
	if same {
		return
	}
	extraTargets = make([]extraTarget, 0, len(hosts))
	for _, h := range hosts {
		extraTargets = append(extraTargets, extraTarget{host: h, client: transport.New(h, agentKey)})
	}
	if len(hosts) > 0 {
		logbuf.Info(fmt.Sprintf("argus-agent: additional ingest hosts: %s", strings.Join(hosts, ", ")))
	}
}

// pushExtras delivers the same snapshot to every additional ingest host (best-effort).
func pushExtras(ctx context.Context, body []byte) {
	extraMu.Lock()
	targets := append([]extraTarget(nil), extraTargets...)
	extraMu.Unlock()
	for _, t := range targets {
		if err := t.client.Ingest(ctx, body); err != nil {
			logbuf.Info(fmt.Sprintf("argus-agent: extra ingest to %s skipped (%v)", t.host, err))
		}
	}
}

// ── Status snapshot file (read by `argus-agent status`) ───────────────────────
type statusUnit struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	PID    *int   `json:"pid,omitempty"`
}

type statusFile struct {
	Time        string       `json:"time"`
	Version     string       `json:"version"`
	Server      string       `json:"server"`
	IngestHosts []string     `json:"ingestHosts,omitempty"`
	Connection  string       `json:"connection"` // online | pending | spooling
	Units       []statusUnit `json:"units"`
}

// StatusFilePath is agent.status.json next to the binary — the latest health
// snapshot the running agent writes each tick, so `status` can show what's monitored.
func StatusFilePath() string {
	exe, err := os.Executable()
	if err != nil {
		return "agent.status.json"
	}
	if resolved, e := filepath.EvalSymlinks(exe); e == nil {
		exe = resolved
	}
	return filepath.Join(filepath.Dir(exe), "agent.status.json")
}

// writeStatus atomically persists the current health snapshot (write temp + rename).
func writeStatus(connection string, units []model.Unit) {
	extraMu.Lock()
	hosts := make([]string, len(extraTargets))
	for i, t := range extraTargets {
		hosts[i] = t.host
	}
	extraMu.Unlock()

	sf := statusFile{
		Time:        time.Now().UTC().Format(time.RFC3339),
		Version:     agentVersion,
		Server:      primaryURL,
		IngestHosts: hosts,
		Connection:  connection,
		Units:       make([]statusUnit, 0, len(units)),
	}
	for _, u := range units {
		sf.Units = append(sf.Units, statusUnit{Name: u.Entity, Status: u.Status, PID: u.PID})
	}
	b, err := json.MarshalIndent(sf, "", "  ")
	if err != nil {
		return
	}
	path := StatusFilePath()
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return
	}
	_ = os.Rename(tmp, path)
}

func Run(ctx context.Context, cfg config.Config, version string) error {
	// Child context so a "restart" command can stop the agent cleanly; the
	// supervisor/service manager then relaunches it (install-and-forget).
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	agentKey = cfg.Key
	primaryURL = cfg.Server
	agentVersion = version

	sweepOldBinaries()            // clear leftovers from any prior self-update
	logbuf.SetFile(LogFilePath()) // mirror operational logs to a capped file for `argus-agent logs`

	// Log-timestamp timezone: a local override (config file / ARGUS_TZ) wins; otherwise
	// the agent adopts the server's timezone delivered with the monitor config.
	localTZ = cfg.Timezone
	if localTZ != "" {
		applyTimezone(localTZ)
	}

	client := transport.New(cfg.Server, cfg.Key)
	sp, err := spool.New(cfg.SpoolDir)
	if err != nil {
		return err
	}

	registerWithBackoff(ctx, client, version)

	// Outbound WSS control channel (commands: restart/update/config).
	go control.Run(ctx, cfg.Server, cfg.Key, version, control.Handlers{
		OnRestart: func() {
			// Exit the PROCESS (non-zero) so the service manager relaunches a fresh
			// agent — systemd Restart=always / Windows SCM OnFailure=restart. A clean
			// cancel() alone would leave the service "running" but idle (disconnected),
			// which is exactly what was happening. Brief grace so the ack + log flush.
			logbuf.Info("argus-agent: restart requested — exiting for the service manager to relaunch")
			cancel()
			time.Sleep(300 * time.Millisecond)
			os.Exit(2)
		},
		OnConfig: func(p map[string]any) {
			if v, ok := p["intervalSec"].(float64); ok {
				applyInterval(int(v))
			}
			if d, ok := p["debug"].(bool); ok {
				logbuf.SetDebug(d)    // live debug toggle from the server (no restart)
				setDebugCadence(d)    // flush logs fast while debugging so the UI is near-live
			}
		},
		OnRescan: func(p map[string]any) {
			id, _ := p["monitorId"].(string)
			if m, ok := findStorageMonitor(id); ok {
				logbuf.Info("argus-agent: folder rescan requested for " + m.Name)
				path, withFolders, watch := collect.StorageScanParams(m.Config)
				go collect.RunScan(id, path, withFolders, watch)
			} else {
				// Unknown id (or no monitor list yet): fall back to clearing the cache.
				collect.ClearFolderCache()
			}
		},
		OnCancelScan: func(p map[string]any) {
			if id, _ := p["monitorId"].(string); id != "" {
				collect.CancelScan(id)
			}
		},
		OnUpdate: func(p map[string]any) {
			// Skip a needless swap: if we're already at/above the target version
			// (and not forced), do nothing. The backend also pre-checks this.
			target, _ := p["version"].(string)
			force, _ := p["force"].(bool)
			if target != "" && !force && versionAtLeast(version, target) {
				logbuf.Info(fmt.Sprintf("argus-agent: already at v%s (>= target v%s) — update skipped", version, target))
				return
			}
			url, _ := p["url"].(string)
			if url == "" {
				// No operator-supplied URL: pull the build matching THIS agent's
				// platform from the backend, authenticated by our connection key.
				url = strings.TrimRight(cfg.Server, "/") + "/api/agent/download/" + agentArtifactName()
			}
			logbuf.Info(fmt.Sprintf("argus-agent: applying self-update from %s", url))
			err := update.Apply(ctx, url, cfg.Key, version)
			// ErrUpdated is the SUCCESS sentinel (binary swapped). Exit the PROCESS
			// (non-zero) so the service manager relaunches the freshly written binary
			// — systemd Restart=always / Windows SCM recovery (OnFailure=restart).
			// A clean cancel() alone would leave the service "running" but idle.
			if err == nil || errors.Is(err, update.ErrUpdated) {
				logbuf.Info("argus-agent: self-update applied — exiting to relaunch the new binary")
				os.Exit(2)
			}
			logbuf.Errorf("argus-agent: self-update failed: %v", err)
		},
	})

	// Optional DHCP-lease hostname fallback for cross-subnet clients (ARGUS_DHCP_SERVER).
	collect.SetDhcpServer(cfg.DhcpServer)

	// Stream folder-scan progress (from "Scan now") back over the control channel.
	collect.SetScanSender(func(monitorID string, p collect.ScanProgress) {
		control.Send(scanMsg{T: "scan", MonitorID: monitorID, Status: p.Status, Folders: p.Folders, Files: p.Files, Bytes: p.Bytes, Current: p.Current})
	})

	ticker := time.NewTicker(cfg.Interval)
	defer ticker.Stop()
	bindTicker(ticker, int(cfg.Interval/time.Second)) // enable live cadence changes

	// Cached monitor list, refreshed from the backend every configEveryNTicks. We
	// pull once up front so the first snapshot already carries unit samples.
	var monitors []model.MonitorConfig
	refreshConfig(ctx, client, &monitors)
	storeMonitors(monitors)    // expose to the rescan handler
	pushInventory(ctx, client) // discover services/processes once at startup

	tick := 0
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			tick++
			if tick%configEveryNTicks == 0 {
				refreshConfig(ctx, client, &monitors)
				storeMonitors(monitors)
			}
			if tick%inventoryEveryNTicks == 0 {
				pushInventory(ctx, client)
			}

			// Replay anything queued during an earlier outage (oldest first).
			_ = sp.Drain(func(b []byte) error { return client.Ingest(ctx, b) })

			// Run each cached monitor's collector to build this tick's unit samples.
			snapshot := collect.Snapshot(version)
			snapshot.Units = collectUnits(monitors)
			// Attach any operational log lines accumulated since the last tick so
			// the backend stores + live-broadcasts them. Bounded; never blocks.
			snapshot.Logs = drainLogs()
			body, _ := json.Marshal(snapshot)
			connection := "online"
			switch err := client.Ingest(ctx, body); {
			case err == nil:
				// delivered
			case errors.Is(err, transport.ErrNotApproved):
				connection = "pending"
				logbuf.Info("argus-agent: awaiting approval in the UI")
			default:
				connection = "spooling"
				logbuf.Errorf("argus-agent: ingest failed (%v) — spooling", err)
				if e := sp.Enqueue(body); e != nil {
					logbuf.Errorf("argus-agent: spool error: %v", e)
				}
			}
			// Mirror the same snapshot to any additional ingest hosts (best-effort),
			// then persist a local health snapshot for `argus-agent status`.
			pushExtras(ctx, body)
			writeStatus(connection, snapshot.Units)
			logbuf.Debugf("argus-agent: tick %d — %s, %d units, %d bytes, %d log lines", tick, connection, len(snapshot.Units), len(body), len(snapshot.Logs))
		}
	}
}

// drainLogs pulls accumulated operational lines from the default buffer and maps
// them to wire LogLine values for the ingest snapshot. Returns nil when empty.
func drainLogs() []model.LogLine {
	buffered := logbuf.Default().Drain()
	if len(buffered) == 0 {
		return nil
	}
	out := make([]model.LogLine, 0, len(buffered))
	for _, l := range buffered {
		category := l.Category
		if category == "" {
			category = "agent"
		}
		out = append(out, model.LogLine{Category: category, Level: l.Level, Message: l.Message})
	}
	return out
}

// refreshConfig pulls the latest monitor list and replaces the cache on success.
// A pending agent (ErrNotApproved) or transport error keeps the existing cache —
// we never panic and never clear good config because of a transient failure.
func refreshConfig(ctx context.Context, client *transport.Client, dst *[]model.MonitorConfig) {
	resp, err := client.FetchConfig(ctx)
	if err != nil {
		if errors.Is(err, transport.ErrNotApproved) {
			return
		}
		logbuf.Errorf("argus-agent: config fetch failed (%v) — keeping cached monitors", err)
		return
	}
	*dst = resp.Monitors
	if resp.PushIntervalSec > 0 {
		applyInterval(resp.PushIntervalSec) // converge cadence even if a WS command was missed
	}
	if localTZ == "" && resp.Timezone != "" {
		applyTimezone(resp.Timezone) // adopt the server's timezone (no local override set)
	}
	setExtraHosts(resp.IngestHosts) // master-controlled list of additional ingest backends
	logbuf.SetDebug(resp.Debug)     // server-controlled verbose logging (live)
	logbuf.Info("argus-agent: monitor config refreshed")
	logbuf.Debugf("argus-agent: config — %d monitors, %d extra hosts, push %ds, tz %q", len(resp.Monitors), len(resp.IngestHosts), resp.PushIntervalSec, resp.Timezone)
}

// pushInventory discovers the host's services + processes and uploads them so the
// UI can offer a pick-list. Best-effort: failures (incl. "pending") are logged at
// debug and never disturb the telemetry loop.
func pushInventory(ctx context.Context, client *transport.Client) {
	body, err := json.Marshal(collect.Discover())
	if err != nil {
		return
	}
	if err := client.PushInventory(ctx, body); err != nil {
		logbuf.Info(fmt.Sprintf("argus-agent: inventory push skipped (%v)", err))
	}
}

// collectUnits runs each monitor's collector and gathers the resulting samples.
// Collectors are read-only and self-contained; an empty list yields nil units.
func collectUnits(monitors []model.MonitorConfig) []model.Unit {
	if len(monitors) == 0 {
		return nil
	}
	units := make([]model.Unit, 0, len(monitors))
	for _, m := range monitors {
		units = append(units, collect.FromMonitor(m))
	}
	return units
}

func registerWithBackoff(ctx context.Context, client *transport.Client, version string) {
	req := model.RegisterRequest{Hostname: collect.Hostname(), Platform: collect.Platform(), Version: version, Address: collect.PrimaryIP(), BuildTime: collect.BuildTime}
	backoff := time.Second
	for {
		resp, err := client.Register(ctx, req)
		if err == nil {
			logbuf.Info(fmt.Sprintf("argus-agent: registered as %s (status: %s)", resp.AgentID, resp.Status))
			return
		}
		logbuf.Warn(fmt.Sprintf("argus-agent: register failed (%v) — retrying in %s", err, backoff))
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff *= 2; backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}
