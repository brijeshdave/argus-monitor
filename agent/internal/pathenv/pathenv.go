// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// pathenv makes `argus-agent` runnable from anywhere (no full path). On Windows it
// adds the binary's directory to the machine PATH using the registry API (which,
// unlike setx, never truncates a long PATH) — idempotent. On Unix it symlinks the
// binary into /usr/local/bin. Both are reversible and best-effort: a failure here
// never blocks install/uninstall (which already require elevation).
package pathenv

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

const unixLink = "/usr/local/bin/argus-agent"

// EnsureOnPath registers the binary so it can be invoked by name. Returns a short
// human-readable note describing what it did.
func EnsureOnPath(exePath string) (string, error) {
	dir := filepath.Dir(exePath)
	if runtime.GOOS == "windows" {
		// Read the full machine PATH and append our dir only if absent.
		script := `$d=$env:ARGUS_DIR; $p=[Environment]::GetEnvironmentVariable('Path','Machine'); ` +
			`if(($p -split ';') -notcontains $d){ [Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';')+';'+$d),'Machine') }`
		if err := runPS(script, dir); err != nil {
			return "", err
		}
		return fmt.Sprintf("added %s to the system PATH — open a NEW terminal to run `argus-agent` from anywhere", dir), nil
	}
	_ = os.Remove(unixLink)
	if err := os.Symlink(exePath, unixLink); err != nil {
		return "", fmt.Errorf("symlink %s: %w", unixLink, err)
	}
	return fmt.Sprintf("linked %s -> %s", unixLink, exePath), nil
}

// RemoveFromPath reverses EnsureOnPath (best-effort; errors ignored).
func RemoveFromPath(exePath string) {
	dir := filepath.Dir(exePath)
	if runtime.GOOS == "windows" {
		script := `$d=$env:ARGUS_DIR; $p=[Environment]::GetEnvironmentVariable('Path','Machine'); ` +
			`$n=(($p -split ';') | Where-Object { $_ -ne $d -and $_ -ne '' }) -join ';'; ` +
			`[Environment]::SetEnvironmentVariable('Path',$n,'Machine')`
		_ = runPS(script, dir)
		return
	}
	if target, err := os.Readlink(unixLink); err == nil && target == exePath {
		_ = os.Remove(unixLink)
	}
}

// runPS runs a PowerShell snippet with ARGUS_DIR set (passed via env to avoid any
// quoting issues with paths that contain spaces).
func runPS(script, dir string) error {
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.Env = append(os.Environ(), "ARGUS_DIR="+dir)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("update PATH: %v: %s", err, out)
	}
	return nil
}
