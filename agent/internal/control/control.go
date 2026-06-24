// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// WSS control-channel client. The agent opens ONE outbound WebSocket to the
// backend (no inbound ports), registers, heartbeats, and applies pushed commands
// (restart/update/config), acking each. It reconnects with capped backoff so the
// control link self-heals across network outages.
package control

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/brijeshdave/argus-monitor/agent/internal/collect"
	"github.com/brijeshdave/argus-monitor/agent/internal/logbuf"
)

const (
	heartbeatEvery = 20 * time.Second
	maxBackoff     = 60 * time.Second
)

// Handlers lets the caller react to commands without this package knowing how.
type Handlers struct {
	OnRestart    func()
	OnUpdate     func(payload map[string]any)
	OnConfig     func(payload map[string]any) // live config (e.g. push interval) change
	OnRescan     func(payload map[string]any) // force a folder re-scan ("Scan now")
	OnCancelScan func(payload map[string]any) // cancel a running folder scan
}

// outbound carries agent→server messages (e.g. scan progress) raised outside the
// command flow. Buffered + lossy: progress is best-effort and must never block a walk.
var outbound = make(chan any, 64)

// Send queues a message to the server over the control channel (dropped if the buffer
// is full or the link is down — fine for progress updates).
func Send(v any) {
	select {
	case outbound <- v:
	default:
	}
}

type clientMsg struct {
	T         string `json:"t"`
	Name      string `json:"name,omitempty"`
	Hostname  string `json:"hostname,omitempty"`
	Platform  string `json:"platform,omitempty"`
	Version   string `json:"version,omitempty"`
	Address   string `json:"address,omitempty"`
	BuildTime string `json:"buildTime,omitempty"`
	CommandID string `json:"commandId,omitempty"`
}

type serverMsg struct {
	T       string `json:"t"`
	Command struct {
		ID      string         `json:"id"`
		Type    string         `json:"type"`
		Payload map[string]any `json:"payload"`
	} `json:"command"`
}

// Run maintains the control connection until ctx is cancelled.
func Run(ctx context.Context, server, key, version string, h Handlers) {
	backoff := time.Second
	for ctx.Err() == nil {
		if err := connect(ctx, server, key, version, h); err != nil && ctx.Err() == nil {
			logbuf.Warn(fmt.Sprintf("argus-agent: control link down (%v) — reconnecting in %s", err, backoff))
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			if backoff *= 2; backoff > maxBackoff {
				backoff = maxBackoff
			}
			continue
		}
		backoff = time.Second
	}
}

func connect(ctx context.Context, server, key, version string, h Handlers) error {
	c, _, err := websocket.Dial(ctx, wsURL(server), &websocket.DialOptions{
		HTTPHeader: map[string][]string{"x-argus-key": {key}},
	})
	if err != nil {
		return err
	}
	defer c.Close(websocket.StatusNormalClosure, "")

	if err := wsjson.Write(ctx, c, clientMsg{
		T: "register", Hostname: collect.Hostname(), Platform: collect.Platform(), Version: version, Address: collect.PrimaryIP(), BuildTime: collect.BuildTime,
	}); err != nil {
		return err
	}

	// Heartbeat loop in the background; cancelled when the read loop returns.
	hbCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		t := time.NewTicker(heartbeatEvery)
		defer t.Stop()
		for {
			select {
			case <-hbCtx.Done():
				return
			case <-t.C:
				_ = wsjson.Write(hbCtx, c, clientMsg{T: "heartbeat"})
			case m := <-outbound:
				_ = wsjson.Write(hbCtx, c, m)
			}
		}
	}()

	for {
		var msg serverMsg
		if err := wsjson.Read(ctx, c, &msg); err != nil {
			return err
		}
		if msg.T == "command" {
			applyCommand(ctx, c, msg, h)
		}
	}
}

func applyCommand(ctx context.Context, c *websocket.Conn, msg serverMsg, h Handlers) {
	logbuf.Info(fmt.Sprintf("argus-agent: command %s (%s)", msg.Command.Type, msg.Command.ID))
	// Ack first so the server records delivery even if we then restart.
	_ = wsjson.Write(ctx, c, clientMsg{T: "ack", CommandID: msg.Command.ID})

	switch msg.Command.Type {
	case "restart":
		if h.OnRestart != nil {
			h.OnRestart()
		}
	case "update":
		if h.OnUpdate != nil {
			h.OnUpdate(msg.Command.Payload)
		}
	case "config":
		if h.OnConfig != nil {
			h.OnConfig(msg.Command.Payload)
		}
	case "rescan":
		if h.OnRescan != nil {
			h.OnRescan(msg.Command.Payload)
		}
	case "cancelScan":
		if h.OnCancelScan != nil {
			h.OnCancelScan(msg.Command.Payload)
		}
	}
}

// wsURL converts a backend base URL into the control-channel WebSocket URL.
func wsURL(server string) string {
	base := strings.TrimRight(server, "/")
	if u, err := url.Parse(base); err == nil {
		switch u.Scheme {
		case "https":
			u.Scheme = "wss"
		case "http":
			u.Scheme = "ws"
		}
		u.Path = "/ws/agent"
		return u.String()
	}
	return base + "/ws/agent"
}
