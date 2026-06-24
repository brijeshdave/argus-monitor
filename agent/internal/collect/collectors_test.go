// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Tests for the per-monitor collectors. Ping is exercised against a real loopback
// listener (UP) and an unused port (DOWN); Host and FromMonitor routing are checked
// directly. Process is environment-dependent, so it is not asserted here.
package collect

import (
	"net"
	"strconv"
	"testing"

	"github.com/brijeshdave/argus-monitor/agent/internal/model"
)

func TestPingUpOnOpenPort(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	port := ln.Addr().(*net.TCPAddr).Port
	u := Ping("svc", "127.0.0.1", port)
	if u.Status != statusUP {
		t.Fatalf("expected UP for open port, got %q", u.Status)
	}
	if u.Entity != "svc" {
		t.Fatalf("expected entity svc, got %q", u.Entity)
	}
}

func TestPingDownOnClosedPort(t *testing.T) {
	// Grab a port, then close it so nothing is listening there.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()

	u := Ping("svc", "127.0.0.1", port)
	if u.Status != statusDOWN {
		t.Fatalf("expected DOWN for closed port %d, got %q", port, u.Status)
	}
}

func TestHostAlwaysUp(t *testing.T) {
	u := Host("box")
	if u.Status != statusUP {
		t.Fatalf("expected UP, got %q", u.Status)
	}
	if u.Entity != "box" {
		t.Fatalf("expected entity box, got %q", u.Entity)
	}
}

func TestFromMonitorRoutesHost(t *testing.T) {
	u := FromMonitor(model.MonitorConfig{Type: "host", Name: "box"})
	if u.Status != statusUP {
		t.Fatalf("host monitor: expected UP, got %q", u.Status)
	}
}

func TestFromMonitorUnknownType(t *testing.T) {
	u := FromMonitor(model.MonitorConfig{Type: "wormhole", Name: "x"})
	if u.Status != statusUNKNOWN {
		t.Fatalf("unknown monitor: expected UNKNOWN, got %q", u.Status)
	}
}

func TestFromMonitorRoutesPing(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	port := ln.Addr().(*net.TCPAddr).Port

	u := FromMonitor(model.MonitorConfig{
		Type:   "ping",
		Name:   "svc",
		Config: map[string]any{"host": "127.0.0.1", "port": float64(port)},
	})
	if u.Status != statusUP {
		t.Fatalf("ping monitor: expected UP on %s, got %q", strconv.Itoa(port), u.Status)
	}
}
