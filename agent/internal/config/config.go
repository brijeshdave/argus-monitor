// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Agent configuration. The agent reads a small JSON config file that lives NEXT TO
// THE BINARY (e.g. C:\tools\argus-agent\agent.json), managed by `service install`,
// with flags and env taking precedence so an operator can override without editing
// it. Precedence, highest first:
//
//	-flag  >  ARGUS_* env  >  config file  >  built-in default
//
// The file holds the connection key, so it is written with owner-only (0600)
// permissions and the key never appears in the service's command line. Everything
// else has a safe default; richer monitor config is pulled from the backend.
package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

type Config struct {
	Key        string        // connection key (minted in the UI)
	Server     string        // backend base URL, e.g. https://argus.example.com
	Interval   time.Duration // collect/push cadence (starting value; backend can change it live)
	SpoolDir   string        // disk-backed store-and-forward directory
	DhcpServer string        // optional Windows DHCP server for cross-subnet client hostname lookup
	Timezone   string        // IANA tz for log timestamps; empty = use the server's timezone
}

// fileConfig is the on-disk JSON shape. Empty values mean "unset" so the resolver
// can tell an explicit value from an absent one.
type fileConfig struct {
	Key         string `json:"key,omitempty"`
	Server      string `json:"server,omitempty"`
	IntervalSec int    `json:"intervalSec,omitempty"`
	SpoolDir    string `json:"spoolDir,omitempty"`
	DhcpServer  string `json:"dhcpServer,omitempty"`
	Timezone    string `json:"timezone,omitempty"`
}

const defaultIntervalSec = 30

// DefaultPath is the config file location: agent.json alongside the agent binary
// (an absolute path, so the installed service finds it regardless of working dir).
// Falls back to the current directory if the executable path can't be resolved.
func DefaultPath() string {
	if exe, err := os.Executable(); err == nil {
		if resolved, rerr := filepath.EvalSymlinks(exe); rerr == nil {
			exe = resolved
		}
		return filepath.Join(filepath.Dir(exe), "agent.json")
	}
	return "agent.json"
}

// loadFile reads the JSON config at path. A missing file is not an error (returns
// an empty config); malformed JSON is surfaced so a typo doesn't silently wipe config.
func loadFile(path string) (fileConfig, error) {
	var fc fileConfig
	b, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fc, nil
		}
		return fc, err
	}
	if err := json.Unmarshal(b, &fc); err != nil {
		return fc, err
	}
	return fc, nil
}

// firstNonEmpty returns the first non-empty string (precedence order).
func firstNonEmpty(vs ...string) string {
	for _, v := range vs {
		if v != "" {
			return v
		}
	}
	return ""
}

// Resolve merges flag, env, file and default sources into a validated Config.
// flagKey/flagServer are the parsed -key/-server (empty when not passed); path is
// the config-file path (DefaultPath() when -config was not given).
func Resolve(flagKey, flagServer, path string) (Config, error) {
	if path == "" {
		path = DefaultPath()
	}
	fc, err := loadFile(path)
	if err != nil {
		return Config{}, err
	}

	key := firstNonEmpty(flagKey, os.Getenv("ARGUS_KEY"), fc.Key)
	server := firstNonEmpty(flagServer, os.Getenv("ARGUS_SERVER"), fc.Server)
	if key == "" {
		return Config{}, errors.New("connection key is required (-key, ARGUS_KEY, or config file)")
	}
	if server == "" {
		return Config{}, errors.New("server URL is required (-server, ARGUS_SERVER, or config file)")
	}

	spool := firstNonEmpty(os.Getenv("ARGUS_SPOOL_DIR"), fc.SpoolDir)
	if spool == "" {
		spool = filepath.Join(os.TempDir(), "argus-agent-spool")
	}

	intervalSec := fc.IntervalSec
	if intervalSec <= 0 {
		intervalSec = defaultIntervalSec
	}

	return Config{
		Key:        key,
		Server:     server,
		Interval:   time.Duration(intervalSec) * time.Second,
		SpoolDir:   spool,
		DhcpServer: firstNonEmpty(os.Getenv("ARGUS_DHCP_SERVER"), fc.DhcpServer),
		Timezone:   firstNonEmpty(os.Getenv("ARGUS_TZ"), fc.Timezone),
	}, nil
}

// Save writes cfg to the JSON file at path with owner-only permissions (the file
// contains the connection key). Creates the parent directory if needed.
func Save(path string, cfg Config) error {
	if path == "" {
		path = DefaultPath()
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	intervalSec := int(cfg.Interval / time.Second)
	if intervalSec <= 0 {
		intervalSec = defaultIntervalSec
	}
	fc := fileConfig{
		Key:         cfg.Key,
		Server:      cfg.Server,
		IntervalSec: intervalSec,
		SpoolDir:    cfg.SpoolDir,
		DhcpServer:  cfg.DhcpServer,
		Timezone:    cfg.Timezone,
	}
	b, err := json.MarshalIndent(fc, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}
