// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Windows service discovery via the Service Control Manager. Read-only: opens the
// SCM with connect/enumerate rights only and lists service names + display names.
// Best-effort — any failure yields an empty list.
package collect

import (
	"github.com/brijeshdave/argus-monitor/agent/internal/model"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc/mgr"
)

func discoverServices() []model.InvItem {
	m, err := mgr.Connect()
	if err != nil {
		return nil
	}
	defer m.Disconnect()

	names, err := m.ListServices()
	if err != nil {
		return nil
	}

	items := make([]model.InvItem, 0, len(names))
	for _, name := range names {
		item := model.InvItem{Name: name}
		// Display name is friendlier in the pick-list; skip if it can't be read.
		if s, e := openServiceRead(m, name); e == nil {
			if cfg, e2 := s.Config(); e2 == nil && cfg.DisplayName != "" {
				item.Detail = cfg.DisplayName
			}
			s.Close()
		}
		items = append(items, item)
	}
	return items
}

// openServiceRead opens a service with read-only access (no start/stop rights).
func openServiceRead(m *mgr.Mgr, name string) (*mgr.Service, error) {
	h, err := windows.OpenService(m.Handle, windows.StringToUTF16Ptr(name), windows.SERVICE_QUERY_CONFIG)
	if err != nil {
		return nil, err
	}
	return &mgr.Service{Name: name, Handle: h}, nil
}
