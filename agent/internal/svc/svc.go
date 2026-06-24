// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Service lifecycle wrapper. Wraps the foreground run loop in a kardianos service
// so the agent installs/starts/stops/restarts as a native OS service (systemd,
// launchd, Windows SCM) — install-and-forget. The installed service relaunches the
// binary in `run` mode with the connection key/server baked into its arguments;
// keys are revocable from the UI, so a leaked install can be cut off centrally.
package svc

import (
	"context"

	"github.com/kardianos/service"

	"github.com/brijeshdave/argus-monitor/agent/internal/config"
	"github.com/brijeshdave/argus-monitor/agent/internal/run"
)

// program implements service.Interface. Start must not block: it launches the run
// loop on a goroutine and returns; Stop cancels the loop's context and returns.
type program struct {
	cfg     config.Config
	version string
	cancel  context.CancelFunc
}

// Start is called by the service manager. It kicks off the run loop and returns
// immediately so the manager considers the service "started".
func (p *program) Start(s service.Service) error {
	ctx, cancel := context.WithCancel(context.Background())
	p.cancel = cancel
	go func() {
		// run.Run returns when the context is cancelled (clean stop) or on a fatal
		// error; either way the service manager owns relaunch policy.
		_ = run.Run(ctx, p.cfg, p.version)
	}()
	return nil
}

// Stop cancels the run loop's context and returns. The run loop is fully
// context-cancellable, so this unwinds cleanly.
func (p *program) Stop(s service.Service) error {
	if p.cancel != nil {
		p.cancel()
	}
	return nil
}

// New builds a kardianos service.Service for the agent. The installed service
// relaunches this binary in `run` mode pointing at the on-disk config file (which
// holds the connection key with 0600 perms) — so the key never appears on the
// service command line, and the OS service manager keeps the agent alive across
// reboots. `Restart=always` (systemd) relaunches it on an unexpected exit.
func New(cfg config.Config, version string, configPath string) (service.Service, error) {
	if configPath == "" {
		configPath = config.DefaultPath()
	}
	svcConfig := &service.Config{
		Name:        "argus-agent",
		DisplayName: "Argus Monitoring Agent",
		Description: "Argus agent: collects host health/metrics/inventory and pushes it to the Argus backend.",
		// Relaunch in `service run` mode (required for Windows SCM; correct on
		// systemd/launchd too), loading key/server/etc. from the config file.
		Arguments: []string{"service", "run", "-config", configPath},
		Option: service.KeyValue{
			"Restart":                "always",  // systemd: relaunch on any exit
			"OnFailure":              "restart", // Windows SCM: recovery action on non-zero exit
			"OnFailureDelayDuration": "3s",
			"OnFailureResetPeriod":   86400,
		},
	}
	return service.New(&program{cfg: cfg, version: version}, svcConfig)
}

// StatusString reports the installed service's state as a human string.
func StatusString(svc service.Service) string {
	st, err := svc.Status()
	if err != nil {
		// Not installed, or insufficient privileges to query the SCM/systemd.
		return "unknown (not installed, or run elevated to query)"
	}
	switch st {
	case service.StatusRunning:
		return "running"
	case service.StatusStopped:
		return "stopped"
	default:
		return "unknown"
	}
}

// Control performs a lifecycle action (install|uninstall|start|stop|restart) on an
// already-built service. It maps directly to kardianos's service.Control.
func Control(svc service.Service, action string) error {
	return service.Control(svc, action)
}

// RunService runs the service under the OS service manager. This is the entrypoint
// the installed service invokes; it blocks until the manager stops the service.
func RunService(svc service.Service) error {
	return svc.Run()
}
