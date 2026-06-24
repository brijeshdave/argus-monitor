// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Host discovery: enumerate the services + processes an operator could choose to
// monitor. Read-only and best-effort — a failure to enumerate one kind yields an
// empty list, never an error, so discovery can never stall the agent. Service
// enumeration is per-OS (discover_<goos>.go); process enumeration is shared here.
package collect

import (
	"sort"
	"strings"

	"github.com/brijeshdave/argus-monitor/agent/internal/model"
	"github.com/shirou/gopsutil/v3/process"
)

// Discover returns the host's discoverable services and processes.
func Discover() model.Inventory {
	return model.Inventory{Services: discoverServices(), Processes: discoverProcesses()}
}

// discoverProcesses lists running processes, deduped by name (processes by stable
// name/path is how the collector matches — see collectors.go), with the executable
// path as detail. Cross-platform via gopsutil.
func discoverProcesses() []model.InvItem {
	procs, err := process.Processes()
	if err != nil {
		return nil
	}
	seen := make(map[string]model.InvItem, len(procs))
	for _, p := range procs {
		name, err := p.Name()
		if err != nil || name == "" {
			continue
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			continue
		}
		item := model.InvItem{Name: name}
		if exe, e := p.Exe(); e == nil {
			item.Detail = exe
		}
		seen[key] = item
	}
	return sortedItems(seen)
}

// sortedItems flattens a name-keyed map into a name-sorted slice (stable UI order).
func sortedItems(m map[string]model.InvItem) []model.InvItem {
	out := make([]model.InvItem, 0, len(m))
	for _, v := range m {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}
