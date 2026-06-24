// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Per-monitor collectors. Each returns a model.Unit (a status string + optional
// pid) for one monitored entity. Collectors are read-only and cross-platform: they
// observe and report, never touch the monitored process. gopsutil's process
// package is portable across linux/windows/darwin.
package collect

import (
	"fmt"
	"net"
	"sort"
	"strings"
	"time"

	"github.com/brijeshdave/argus-monitor/agent/internal/model"
	"github.com/shirou/gopsutil/v3/process"
)

// Health status strings — must match packages/shared (UnitSample.status).
const (
	statusUP       = "UP"
	statusDOWN     = "DOWN"
	statusUNKNOWN  = "UNKNOWN"
	statusDEGRADED = "DEGRADED"
)

// dialTimeout is how long Ping waits for a TCP connection before declaring DOWN.
const dialTimeout = 3 * time.Second

// Process reports UP (with the matching pid + rich detail) if any running process's
// name or executable path contains match (case-insensitive), else DOWN. Entity = name.
func Process(name, match string) model.Unit {
	needle := strings.ToLower(match)
	procs, err := process.Processes()
	if err != nil {
		// Can't enumerate processes — report UNKNOWN rather than a false DOWN.
		return model.Unit{Entity: name, Status: statusUNKNOWN}
	}
	for _, p := range procs {
		if pname, e := p.Name(); e == nil && strings.Contains(strings.ToLower(pname), needle) {
			return matched(name, p)
		}
		if exe, e := p.Exe(); e == nil && exe != "" && strings.Contains(strings.ToLower(exe), needle) {
			return matched(name, p)
		}
	}
	return model.Unit{Entity: name, Status: statusDOWN}
}

func matched(name string, p *process.Process) model.Unit {
	pid := int(p.Pid)
	return model.Unit{Entity: name, Status: statusUP, PID: &pid, Meta: processMeta(p)}
}

// processMeta gathers best-effort rich detail for a matched process. Every probe is
// independent and failure-tolerant: a field we can't read is simply omitted, never
// an error — read-only and cheap (Golden rule #2).
func processMeta(p *process.Process) *model.UnitMeta {
	m := &model.UnitMeta{}
	if u, e := p.Username(); e == nil {
		m.User = u
	}
	if exe, e := p.Exe(); e == nil {
		m.ExePath = exe
	}
	if cpu, e := p.CPUPercent(); e == nil {
		m.CPUPercent = &cpu
	}
	if mi, e := p.MemoryInfo(); e == nil && mi != nil {
		mb := float64(mi.RSS) / (1024 * 1024)
		m.MemMB = &mb
	}
	if ct, e := p.CreateTime(); e == nil && ct > 0 {
		up := (time.Now().UnixMilli() - ct) / 1000
		if up >= 0 {
			m.UptimeSec = &up
		}
	}
	if n, e := p.NumThreads(); e == nil {
		t := int(n)
		m.Threads = &t
	}
	// Listen ports owned by this pid + the ESTABLISHED clients on those ports.
	if conns, e := p.Connections(); e == nil {
		listen := map[uint32]bool{}
		for _, c := range conns {
			if c.Status == "LISTEN" {
				listen[c.Laddr.Port] = true
			}
		}
		for port := range listen {
			m.ListenPorts = append(m.ListenPorts, int(port))
		}
		sort.Ints(m.ListenPorts)

		const maxClients = 200
		var arp map[string]string
		clients := 0
		for _, c := range conns {
			if c.Status != "ESTABLISHED" || !listen[c.Laddr.Port] || c.Raddr.IP == "" {
				continue
			}
			clients++
			if len(m.Clients) >= maxClients {
				continue
			}
			if arp == nil {
				arp = arpTable() // built once, on first client
			}
			hn, src := resolveHostname(c.Raddr.IP)
			m.Clients = append(m.Clients, model.ClientSample{
				IP:             c.Raddr.IP,
				Port:           int(c.Raddr.Port),
				LocalPort:      int(c.Laddr.Port),
				Hostname:       hn,
				HostnameSource: src,
				MAC:            arp[c.Raddr.IP],
			})
		}
		m.ClientCount = &clients
	}
	return m
}

// Ping reports UP if a TCP connection to host:port succeeds within dialTimeout,
// else DOWN. The entity is name.
func Ping(name, host string, port int) model.Unit {
	addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))
	conn, err := net.DialTimeout("tcp", addr, dialTimeout)
	if err != nil {
		return model.Unit{Entity: name, Status: statusDOWN}
	}
	_ = conn.Close()
	return model.Unit{Entity: name, Status: statusUP}
}

// Host always reports UP — the agent running on the host proves the host is up.
func Host(name string) model.Unit {
	return model.Unit{Entity: name, Status: statusUP}
}

// FromMonitor routes a monitor config to the right collector by type. Unknown
// types yield UNKNOWN rather than an error, so one bad config never stalls a tick.
func FromMonitor(m model.MonitorConfig) model.Unit {
	switch m.Type {
	case "process", "service":
		match := stringField(m.Config, "match")
		if match == "" {
			match = m.Name
		}
		return Process(m.Name, match)
	case "ping":
		return Ping(m.Name, stringField(m.Config, "host"), intField(m.Config, "port"))
	case "host":
		return Host(m.Name)
	case "database":
		conn := stringField(m.Config, "connectionString")
		if conn == "" {
			conn = buildMSSQLDSN(m.Config) // assemble from host/port/database/user/password
		}
		return Database(m.Name, conn, boolField(m.Config, "collectQueries"), intField(m.Config, "topN"))
	case "storage":
		return Storage(m.Name, stringField(m.Config, "path"), stringField(m.Config, "user"), stringField(m.Config, "password"), boolField(m.Config, "folders"), watchSpecs(m.Config, "watchFolders"))
	default:
		return model.Unit{Entity: m.Name, Status: statusUNKNOWN}
	}
}

// stringField reads a string value from a config map, "" if absent or wrong type.
func stringField(cfg map[string]any, key string) string {
	if cfg == nil {
		return ""
	}
	if v, ok := cfg[key].(string); ok {
		return v
	}
	return ""
}

// stringSlice reads a []string from a config value (JSON arrays decode to []any).
func stringSlice(cfg map[string]any, key string) []string {
	arr, ok := cfg[key].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, x := range arr {
		if s, ok := x.(string); ok {
			if s = strings.TrimSpace(s); s != "" {
				out = append(out, s)
			}
		}
	}
	return out
}

// StorageScanParams extracts the folder-scan inputs from a storage monitor's config
// (used by the on-demand "Scan now" path).
func StorageScanParams(cfg map[string]any) (path string, withFolders bool, watch []WatchSpec) {
	return stringField(cfg, "path"), boolField(cfg, "folders"), watchSpecs(cfg, "watchFolders")
}

// watchSpecs parses the watched-folders config: an array of {path,depth,refreshMin}
// objects (per-folder controls), tolerating legacy plain strings. Blank paths skipped.
func watchSpecs(cfg map[string]any, key string) []WatchSpec {
	if cfg == nil {
		return nil
	}
	arr, ok := cfg[key].([]any)
	if !ok {
		return nil
	}
	out := make([]WatchSpec, 0, len(arr))
	for _, x := range arr {
		switch v := x.(type) {
		case string:
			if s := strings.TrimSpace(v); s != "" {
				out = append(out, WatchSpec{Sub: s})
			}
		case map[string]any:
			p := strings.TrimSpace(stringField(v, "path"))
			if p != "" {
				out = append(out, WatchSpec{Sub: p, Depth: intField(v, "depth"), RefreshMin: intField(v, "refreshMin"), ScanTimes: stringSlice(v, "scanTimes"), ScanTZ: stringField(v, "scanTimezone")})
			}
		}
	}
	return out
}

// intField reads an integer value from a config map, tolerating JSON's float64
// numbers; returns 0 if absent or non-numeric.
func intField(cfg map[string]any, key string) int {
	if cfg == nil {
		return 0
	}
	switch v := cfg[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	}
	return 0
}

func boolField(cfg map[string]any, key string) bool {
	if cfg == nil {
		return false
	}
	b, _ := cfg[key].(bool)
	return b
}
