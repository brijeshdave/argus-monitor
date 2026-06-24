// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Argus Agent — a single static binary that runs on each monitored host. It is
// CONFIG-LESS: the only thing it needs is a connection key (minted in the web
// UI). On first connect it registers itself and pulls its monitor config over
// the WebSocket control channel; telemetry is pushed over HTTPS.
//
// Run modes:
//
//	argus-agent run     -key <KEY> -server <URL>   # foreground (development)
//	argus-agent service install|start|stop|restart|uninstall   # production (one-time elevation)
//	argus-agent version
//
// Safety: read-only by default. It never touches monitored processes unless a
// separately-gated remediation feature is explicitly enabled. A supervisor keeps
// it alive, with disk-backed store-and-forward so telemetry is never lost across
// outages and the control connection auto-reconnects with backoff.
//
// Provides the CLI surface + version; collectors, the WS client and the
// service lifecycle live under internal/.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata" // embed the IANA tz database so folder scan-time zones resolve anywhere

	"github.com/brijeshdave/argus-monitor/agent/internal/config"
	"github.com/brijeshdave/argus-monitor/agent/internal/pathenv"
	"github.com/brijeshdave/argus-monitor/agent/internal/run"
	"github.com/brijeshdave/argus-monitor/agent/internal/svc"
)

// Version is stamped at build time via -ldflags "-X main.Version=...".
var Version = "1.0.0"

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	switch os.Args[1] {
	case "run":
		fs := flag.NewFlagSet("run", flag.ExitOnError)
		key := fs.String("key", "", "connection key (overrides env / config file)")
		server := fs.String("server", "", "backend base URL (overrides env / config file)")
		configPath := fs.String("config", config.DefaultPath(), "path to the agent config file")
		_ = fs.Parse(os.Args[2:])
		cfg, err := config.Resolve(*key, *server, *configPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "run: %v\n", err)
			os.Exit(2)
		}

		// Cancel cleanly on Ctrl-C / SIGTERM.
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		log.Printf("argus-agent %s: starting (server: %s)", Version, cfg.Server)
		if err := run.Run(ctx, cfg, Version); err != nil && ctx.Err() == nil {
			log.Fatalf("argus-agent: %v", err)
		}

	case "service":
		// argus-agent service <install|uninstall|start|stop|restart|run> [-key K -server S]
		if len(os.Args) < 3 {
			usage()
			os.Exit(2)
		}
		action := os.Args[2]
		fs := flag.NewFlagSet("service", flag.ExitOnError)
		key := fs.String("key", "", "connection key (required for install unless already in the config file)")
		server := fs.String("server", "", "backend base URL (required for install unless already in the config file)")
		configPath := fs.String("config", config.DefaultPath(), "path to the agent config file")
		_ = fs.Parse(os.Args[3:])

		switch action {
		case "run": // entrypoint the installed service invokes — loads from the config file
			cfg, lerr := config.Resolve(*key, *server, *configPath)
			if lerr != nil {
				log.Fatalf("argus-agent: service run: %v", lerr)
			}
			svcHandle, serr := svc.New(cfg, Version, *configPath)
			if serr != nil {
				log.Fatalf("argus-agent: service init: %v", serr)
			}
			if err := svc.RunService(svcHandle); err != nil {
				log.Fatalf("argus-agent: service run: %v", err)
			}
		case "install":
			// Resolve from flags/env/existing file, persist to the config file (0600),
			// then install a service that loads from that file (key NOT on the cmdline).
			cfg, lerr := config.Resolve(*key, *server, *configPath)
			if lerr != nil {
				fmt.Fprintf(os.Stderr, "service install: %v\n", lerr)
				os.Exit(2)
			}
			if err := config.Save(*configPath, cfg); err != nil {
				log.Fatalf("argus-agent: writing config %s: %v", *configPath, err)
			}
			svcHandle, serr := svc.New(cfg, Version, *configPath)
			if serr != nil {
				log.Fatalf("argus-agent: service init: %v", serr)
			}
			if err := svc.Control(svcHandle, "install"); err != nil {
				log.Fatalf("argus-agent: install: %v", err)
			}
			fmt.Printf("argus-agent: installed (config: %s) — start with: argus-agent service start\n", *configPath)
			// Make `argus-agent` runnable from anywhere (PATH on Windows, symlink on Unix).
			if exe, e := os.Executable(); e == nil {
				if note, perr := pathenv.EnsureOnPath(exe); perr == nil {
					fmt.Println("argus-agent:", note)
				} else {
					fmt.Fprintf(os.Stderr, "argus-agent: could not update PATH (%v) — run with a full path\n", perr)
				}
			}
		case "uninstall", "start", "stop", "restart":
			svcHandle, serr := svc.New(config.Config{}, Version, *configPath)
			if serr != nil {
				log.Fatalf("argus-agent: service init: %v", serr)
			}
			if err := svc.Control(svcHandle, action); err != nil {
				log.Fatalf("argus-agent: %s: %v", action, err)
			}
			if action == "uninstall" {
				if exe, e := os.Executable(); e == nil {
					pathenv.RemoveFromPath(exe) // best-effort: undo the PATH/symlink entry
				}
			}
			fmt.Printf("argus-agent: %s ok\n", action)
		default:
			usage()
			os.Exit(2)
		}

	case "status":
		fs := flag.NewFlagSet("status", flag.ExitOnError)
		configPath := fs.String("config", config.DefaultPath(), "path to the agent config file")
		_ = fs.Parse(os.Args[2:])
		printStatus(*configPath)

	case "logs":
		fs := flag.NewFlagSet("logs", flag.ExitOnError)
		n := fs.Int("n", 50, "number of recent lines to show")
		follow := fs.Bool("f", false, "follow (live tail) until Ctrl-C")
		_ = fs.Parse(os.Args[2:])
		if err := tailLogs(run.LogFilePath(), *n, *follow); err != nil {
			fmt.Fprintf(os.Stderr, "logs: %v\n", err)
			os.Exit(1)
		}

	case "completion":
		shell := ""
		if len(os.Args) >= 3 {
			shell = os.Args[2]
		}
		if err := printCompletion(shell); err != nil {
			fmt.Fprintf(os.Stderr, "%v\n", err)
			os.Exit(2)
		}

	case "version", "-v", "--version":
		fmt.Printf("argus-agent %s\n", Version)

	case "help", "-h", "--help":
		usage()

	default:
		usage()
		os.Exit(2)
	}
}

// maskKey shows only enough of the connection key to recognise it in `status`.
func maskKey(k string) string {
	if len(k) <= 12 {
		return "set"
	}
	return k[:10] + "…" + k[len(k)-3:]
}

// printStatus reports version, resolved config (key masked) and the service state.
func printStatus(configPath string) {
	fmt.Printf("argus-agent %s\n", Version)
	fmt.Printf("config file: %s\n", configPath)
	if cfg, err := config.Resolve("", "", configPath); err == nil {
		fmt.Printf("server:      %s\n", cfg.Server)
		fmt.Printf("key:         %s\n", maskKey(cfg.Key))
		fmt.Printf("interval:    %s (start value; backend can change it live)\n", cfg.Interval)
		fmt.Printf("spool dir:   %s\n", cfg.SpoolDir)
		if cfg.Timezone != "" {
			fmt.Printf("timezone:    %s (local override)\n", cfg.Timezone)
		} else {
			fmt.Printf("timezone:    (follows server)\n")
		}
	} else {
		fmt.Printf("config:      not configured (%v)\n", err)
	}
	if h, err := svc.New(config.Config{}, Version, configPath); err == nil {
		fmt.Printf("service:     %s\n", svc.StatusString(h))
	}
	fmt.Printf("log file:    %s\n", run.LogFilePath())
	printAgentUnits()
}

// agentStatusFile mirrors run.statusFile (the JSON the running agent writes each tick).
type agentStatusFile struct {
	Time        string   `json:"time"`
	Connection  string   `json:"connection"`
	IngestHosts []string `json:"ingestHosts"`
	Units       []struct {
		Name   string `json:"name"`
		Status string `json:"status"`
		PID    *int   `json:"pid"`
	} `json:"units"`
}

// printAgentUnits shows the latest monitored-service statuses from the status file
// the running agent maintains. Absent (agent not running) → a friendly note.
func printAgentUnits() {
	data, err := os.ReadFile(run.StatusFilePath())
	if err != nil {
		fmt.Printf("monitors:    (no live status yet — is the agent running?)\n")
		return
	}
	var sf agentStatusFile
	if err := json.Unmarshal(data, &sf); err != nil {
		fmt.Printf("monitors:    (status file unreadable)\n")
		return
	}
	fmt.Printf("connection:  %s (as of %s)\n", sf.Connection, sf.Time)
	if len(sf.IngestHosts) > 0 {
		fmt.Printf("also pushing: %s\n", strings.Join(sf.IngestHosts, ", "))
	}
	if len(sf.Units) == 0 {
		fmt.Printf("monitors:    (none configured)\n")
		return
	}
	fmt.Printf("monitors (%d):\n", len(sf.Units))
	for _, u := range sf.Units {
		pid := ""
		if u.PID != nil {
			pid = fmt.Sprintf("  pid=%d", *u.PID)
		}
		fmt.Printf("  %-7s %s%s\n", u.Status, u.Name, pid)
	}
}

// tailLogs prints the last n lines of the agent log; with follow it streams new
// lines until interrupted. Safe when the file doesn't exist yet.
func tailLogs(path string, n int, follow bool) error {
	data, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	lines := strings.Split(strings.TrimRight(string(data), "\n"), "\n")
	if len(data) == 0 {
		lines = nil
		fmt.Printf("(no logs yet at %s)\n", path)
	}
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	for _, l := range lines {
		fmt.Println(l)
	}
	if !follow {
		return nil
	}

	offset := int64(len(data))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
			fi, e := os.Stat(path)
			if e != nil {
				continue
			}
			if fi.Size() < offset {
				offset = 0 // file was rotated/truncated
			}
			if fi.Size() > offset {
				f, e := os.Open(path)
				if e != nil {
					continue
				}
				_, _ = f.Seek(offset, io.SeekStart)
				b, _ := io.ReadAll(f)
				_ = f.Close()
				_, _ = os.Stdout.Write(b)
				offset = fi.Size()
			}
		}
	}
}

// printCompletion emits a shell completion script for the agent's commands.
func printCompletion(shell string) error {
	const cmds = "run service status logs version completion help"
	const sub = "install start stop restart uninstall run"
	switch shell {
	case "bash":
		fmt.Printf(`# argus-agent bash completion — eval "$(argus-agent completion bash)"
_argus_agent() {
  local cur=${COMP_WORDS[COMP_CWORD]}
  if [ $COMP_CWORD -eq 1 ]; then COMPREPLY=( $(compgen -W "%s" -- "$cur") );
  elif [ "${COMP_WORDS[1]}" = "service" ] && [ $COMP_CWORD -eq 2 ]; then COMPREPLY=( $(compgen -W "%s" -- "$cur") );
  fi
}
complete -F _argus_agent argus-agent
`, cmds, sub)
	case "zsh":
		fmt.Printf(`# argus-agent zsh completion — eval "$(argus-agent completion zsh)"
_argus_agent() { compadd %s }
compdef _argus_agent argus-agent
`, cmds)
	case "powershell", "pwsh":
		fmt.Printf(`# argus-agent PowerShell completion — add to $PROFILE:
#   argus-agent completion powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName argus-agent -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  @('%s') -split ' ' | Where-Object { $_ -like "$wordToComplete*" } |
    ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
}
`, strings.ReplaceAll(cmds, " ", " "))
	default:
		return fmt.Errorf("completion: specify a shell (bash | zsh | powershell)")
	}
	return nil
}

func usage() {
	fmt.Fprintf(os.Stderr, `Argus Agent %s — Author: Brijesh Dave (https://github.com/brijeshdave)

Usage:
  argus-agent run [-key <KEY>] [-server <URL>] [-config <PATH>]   foreground (dev)
  argus-agent service install -key <KEY> -server <URL> [-config <PATH>]
  argus-agent service <start|stop|restart|uninstall> [-config <PATH>]
  argus-agent status                       show version, config + service state
  argus-agent logs [-n N] [-f]             show recent agent logs (-f to follow)
  argus-agent completion <bash|zsh|powershell>
  argus-agent version
  argus-agent help

Config: install writes a JSON file next to the binary (default %s) with 0600 perms;
it holds the key + server. Precedence: flags > ARGUS_* env > config file > defaults.
install also adds the agent to PATH (Windows) / symlinks it into /usr/local/bin
(Unix) so you can run "argus-agent" from anywhere.
`, Version, config.DefaultPath())
}
