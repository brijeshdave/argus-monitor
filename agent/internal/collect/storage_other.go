// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Storage capacity for non-Windows agents. A LOCAL path (e.g. the agent running
// inside a NAS via Container Station, with the share bind-mounted) is measured with
// statfs — fast and exact. A UNC path (\\host\share) is not supported off Windows
// (use the server-side SMB probe or a Windows agent for that).
//go:build !windows

package collect

import (
	"strings"
	"syscall"
)

// storageCapacity stats a local filesystem path. UNC paths → unreachable here.
func storageCapacity(path, _ /*user*/, _ /*pass*/ string) (total, free uint64, ok bool) {
	if path == "" || strings.HasPrefix(path, `\\`) {
		return 0, 0, false
	}
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0, false
	}
	bs := uint64(st.Bsize)
	return st.Blocks * bs, st.Bavail * bs, true
}
