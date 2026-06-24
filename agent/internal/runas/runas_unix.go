//go:build !windows

// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Run-as-user (unix), GATED + EXPERIMENTAL. Drops to a named local account before
// launching a child process by setting the process credential (uid/gid). This needs
// root (setuid is privileged), so Launch refuses unless the agent is running as
// root. Argus is read-only by default; this only exists for the separately-gated
// remediation path and must never be used to touch monitored processes otherwise.
package runas

import (
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"strconv"
	"syscall"
)

// Launch starts `name args...` as the OS account username, dropping privileges via
// the process credential. It returns an error (without spawning) if the agent is
// not root or the user/uid/gid cannot be resolved.
func Launch(username, name string, args ...string) (*exec.Cmd, error) {
	if os.Geteuid() != 0 {
		return nil, fmt.Errorf("run-as-user requires root to drop privileges to %q", username)
	}

	u, err := user.Lookup(username)
	if err != nil {
		return nil, fmt.Errorf("lookup user %q: %w", username, err)
	}
	uid, err := strconv.ParseUint(u.Uid, 10, 32)
	if err != nil {
		return nil, fmt.Errorf("parse uid for %q: %w", username, err)
	}
	gid, err := strconv.ParseUint(u.Gid, 10, 32)
	if err != nil {
		return nil, fmt.Errorf("parse gid for %q: %w", username, err)
	}

	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Credential: &syscall.Credential{Uid: uint32(uid), Gid: uint32(gid)},
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("launch %q as %q: %w", name, username, err)
	}
	return cmd, nil
}
