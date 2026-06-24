// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Self-update. On an "update" command from the backend the agent downloads a new
// binary and atomically replaces the one it is running, then exits so the service
// manager / supervisor relaunches the new version. The swap is platform-aware: a
// running binary can be renamed in place on unix, but Windows needs the old .exe
// moved aside first because an executing image is locked.
package update

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// ErrUpdated is a sentinel returned after a successful swap. The caller treats it
// as "stop now" — cancel the run context and exit so the manager relaunches the
// freshly written binary. It is not a failure.
var ErrUpdated = errors.New("agent updated — restart required")

// downloadTimeout bounds the whole fetch so a hung mirror can never wedge the agent.
const downloadTimeout = 60 * time.Second

// Apply downloads the binary at url and atomically replaces the running executable.
// On success it returns ErrUpdated (a sentinel, not a real error) so the caller can
// trigger a restart. Any other error means the swap did not happen and the current
// binary is untouched. When key is non-empty it is sent as the x-argus-key header,
// so the agent can fetch its build from the (auth-gated) backend download endpoint.
func Apply(ctx context.Context, downloadURL, key, version string) error {
	if err := validateURL(downloadURL); err != nil {
		return err
	}

	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate current executable: %w", err)
	}
	exePath, err = filepath.EvalSymlinks(exePath)
	if err != nil {
		return fmt.Errorf("resolve executable path: %w", err)
	}

	// Stage the download next to the current binary so the final rename is on the
	// same filesystem (rename across mounts is not atomic / can fail).
	tmp, err := download(ctx, downloadURL, key, exePath)
	if err != nil {
		return err
	}
	// Best-effort cleanup if we bail before the rename succeeds.
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmp)
		}
	}()

	if err := os.Chmod(tmp, 0o755); err != nil {
		return fmt.Errorf("chmod staged binary: %w", err)
	}

	// TODO: verify a checksum / signature on the downloaded binary before swapping
	// it in. Until then self-update should only be enabled against a trusted server
	// over HTTPS.

	if err := swap(tmp, exePath); err != nil {
		return err
	}
	cleanup = false // tmp has been moved into place

	return ErrUpdated
}

// download fetches downloadURL into a temp file beside exePath and returns its path.
func download(ctx context.Context, downloadURL, key, exePath string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, downloadTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		return "", fmt.Errorf("build update request: %w", err)
	}
	if key != "" {
		req.Header.Set("x-argus-key", key)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("download update: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("download update: status %d", resp.StatusCode)
	}

	tmp, err := os.CreateTemp(filepath.Dir(exePath), ".argus-agent-update-*")
	if err != nil {
		return "", fmt.Errorf("create staging file: %w", err)
	}
	tmpPath := tmp.Name()
	if _, err := io.Copy(tmp, resp.Body); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return "", fmt.Errorf("write staged binary: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return "", fmt.Errorf("close staged binary: %w", err)
	}
	return tmpPath, nil
}

// swap replaces exePath with tmp. On unix a running binary can be renamed over in
// place. On Windows the running .exe is locked, so move it aside to a UNIQUE name —
// a fixed ".old" can still be locked by a previous update that hasn't been restarted
// yet, which made the rename fail with "Access is denied". Stale side-step files are
// swept best-effort (a still-locked one is skipped and removed on a later run).
func swap(tmp, exePath string) error {
	if runtime.GOOS == "windows" {
		old := fmt.Sprintf("%s.%d.old", exePath, time.Now().UnixNano())
		if err := os.Rename(exePath, old); err != nil {
			return fmt.Errorf("move running binary aside: %w", err)
		}
		if err := os.Rename(tmp, exePath); err != nil {
			// Roll back so the agent still has a working binary on disk.
			_ = os.Rename(old, exePath)
			return fmt.Errorf("install new binary: %w", err)
		}
		// Sweep leftovers (current unique scheme + the legacy fixed name); locked
		// ones (a not-yet-restarted prior update) fail silently and clear later.
		if matches, _ := filepath.Glob(exePath + ".*.old"); matches != nil {
			for _, m := range matches {
				_ = os.Remove(m)
			}
		}
		_ = os.Remove(exePath + ".old")
		return nil
	}
	if err := os.Rename(tmp, exePath); err != nil {
		return fmt.Errorf("install new binary: %w", err)
	}
	return nil
}

// validateURL rejects anything that is not a plain http/https download.
func validateURL(raw string) error {
	if raw == "" {
		return errors.New("update url is empty")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("parse update url: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("unsupported update url scheme %q (want http or https)", u.Scheme)
	}
	return nil
}
