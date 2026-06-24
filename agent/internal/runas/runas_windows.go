//go:build windows

// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Run-as-user (Windows) — NOT SUPPORTED in this build. Launching a process as a
// different account on Windows needs a logon token (LogonUser + CreateProcessAsUser)
// and an elevated service account, which is out of scope here. The signature matches
// the unix build so the package compiles everywhere; it simply returns an error.
package runas

import (
	"errors"
	"os/exec"
)

// Launch is a documented stub on Windows. It never spawns a process; it returns a
// clear error so callers can surface "not supported on this platform".
func Launch(username, name string, args ...string) (*exec.Cmd, error) {
	return nil, errors.New("run-as-user on Windows requires service-account elevation; not supported in this build")
}
