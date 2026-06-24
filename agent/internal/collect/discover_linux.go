// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Linux service discovery via systemd. Best-effort: if systemctl is absent (non-
// systemd host) or errors, returns an empty list rather than failing.
package collect

import (
	"context"
	"os/exec"
	"strings"
	"time"

	"github.com/brijeshdave/argus-monitor/agent/internal/model"
)

func discoverServices() []model.InvItem {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// --plain/--no-legend/--no-pager give stable, parseable output; --all includes
	// inactive units so the operator can pre-arm a monitor for a stopped service.
	out, err := exec.CommandContext(ctx, "systemctl",
		"list-units", "--type=service", "--all", "--plain", "--no-legend", "--no-pager").Output()
	if err != nil {
		return nil
	}

	var items []model.InvItem
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		unit := fields[0] // e.g. "nginx.service"
		if !strings.HasSuffix(unit, ".service") {
			continue
		}
		name := strings.TrimSuffix(unit, ".service")
		// Remaining fields after LOAD/ACTIVE/SUB are the human description.
		detail := ""
		if len(fields) > 4 {
			detail = strings.Join(fields[4:], " ")
		}
		items = append(items, model.InvItem{Name: name, Detail: detail})
	}
	return items
}
