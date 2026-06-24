// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Host snapshot collector. Uses cross-platform stdlib facts only
// (hostname, OS/arch, CPU count); richer per-OS metrics (CPU%, memory, services,
// processes, storage) arrive with the monitor model. The hot path is
// allocation-light and never panics.
package collect

import (
	"net"
	"os"
	"runtime"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/mem"

	"github.com/brijeshdave/argus-monitor/agent/internal/model"
)

// BuildTime is the agent build timestamp (ISO-8601), stamped at build via
// -ldflags "-X .../internal/collect.BuildTime=...". Empty for unstamped dev builds.
var BuildTime = ""

// Hostname returns the host name (best effort).
func Hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	return h
}

// Platform is the OS identifier (e.g. "linux", "windows", "darwin").
func Platform() string { return runtime.GOOS }

// PrimaryIP returns the host's primary outbound IPv4 address (best effort). It
// opens a UDP socket toward a public address to learn which local interface the
// OS would route through — no packets are actually sent. Empty string if unknown;
// the backend uses this as the default server-side ping target.
func PrimaryIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return ""
	}
	defer conn.Close()
	if addr, ok := conn.LocalAddr().(*net.UDPAddr); ok {
		return addr.IP.String()
	}
	return ""
}

// Snapshot builds one telemetry sample, including host CPU% and memory% for the
// dashboard gauges. CPU is sampled over a short window so it's a real instantaneous
// figure; both probes are best-effort and omitted on error.
func Snapshot(version string) model.IngestRequest {
	m := &model.Metrics{
		Extra: map[string]any{
			"numCpu":  runtime.NumCPU(),
			"goos":    runtime.GOOS,
			"goarch":  runtime.GOARCH,
			"version": version,
		},
	}
	if pcts, err := cpu.Percent(200*time.Millisecond, false); err == nil && len(pcts) > 0 {
		c := pcts[0]
		m.CPUPct = &c
	}
	if vm, err := mem.VirtualMemory(); err == nil && vm != nil {
		p := vm.UsedPercent
		m.MemPct = &p
		used := int(vm.Used / (1024 * 1024))
		m.MemUsedMB = &used
	}
	return model.IngestRequest{Metrics: m}
}
