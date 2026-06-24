// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Service discovery fallback for platforms without a dedicated implementation
// (e.g. macOS): no service enumeration yet — process discovery still works.
//go:build !linux && !windows

package collect

import "github.com/brijeshdave/argus-monitor/agent/internal/model"

func discoverServices() []model.InvItem { return nil }
