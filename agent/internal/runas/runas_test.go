// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Run-as-user tests. We never spawn a privileged process in tests; we only assert
// that a bogus user (or an unsupported platform) is rejected with an error.
package runas

import "testing"

func TestLaunchBogusUserErrors(t *testing.T) {
	// On unix this fails at the non-root check or the user lookup; on Windows it is
	// an unconditional "not supported" error. Either way: no process, an error.
	cmd, err := Launch("argus-no-such-user-xyz", "true")
	if err == nil {
		t.Fatal("expected an error launching as a bogus user, got nil")
	}
	if cmd != nil {
		t.Fatalf("expected no command on error, got %v", cmd)
	}
}
