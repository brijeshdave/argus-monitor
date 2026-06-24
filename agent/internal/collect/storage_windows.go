// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Windows-native SMB share capacity. Optionally
// authenticates to the UNC path with explicit credentials (WNetAddConnection2) so the
// query works even when the agent's service account has no NAS rights; otherwise the
// ambient identity is used. GetDiskFreeSpaceExW returns total/free bytes. Read-only.
//go:build windows

package collect

import (
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	kernel32               = windows.NewLazySystemDLL("kernel32.dll")
	procGetDiskFreeSpaceEx = kernel32.NewProc("GetDiskFreeSpaceExW")
	mpr                    = windows.NewLazySystemDLL("mpr.dll")
	procWNetAddConnection2 = mpr.NewProc("WNetAddConnection2W")
)

type netResource struct {
	Scope       uint32
	Type        uint32
	DisplayType uint32
	Usage       uint32
	LocalName   *uint16
	RemoteName  *uint16
	Comment     *uint16
	Provider    *uint16
}

const (
	resourcetypeDisk             = 0x00000001
	errAlreadyAssigned           = 85
	errSessionCredentialConflict = 1219
)

// connectShare authenticates to a UNC path with explicit creds (no-op when user is
// empty → ambient creds). Idempotent across cycles; the connection is left open.
func connectShare(remote, user, pass string) {
	if user == "" {
		return
	}
	remP, err := windows.UTF16PtrFromString(remote)
	if err != nil {
		return
	}
	nr := netResource{Type: resourcetypeDisk, RemoteName: remP}
	var userP, passP *uint16
	if userP, err = windows.UTF16PtrFromString(user); err != nil {
		return
	}
	if passP, err = windows.UTF16PtrFromString(pass); err != nil {
		return
	}
	_, _, _ = procWNetAddConnection2.Call(
		uintptr(unsafe.Pointer(&nr)),
		uintptr(unsafe.Pointer(passP)),
		uintptr(unsafe.Pointer(userP)),
		0,
	)
}

// storageCapacity returns (totalBytes, freeBytes, ok) for a UNC share.
func storageCapacity(path, user, pass string) (total, free uint64, ok bool) {
	connectShare(path, user, pass)
	dir := path
	if !strings.HasSuffix(dir, `\`) {
		dir += `\`
	}
	p, err := windows.UTF16PtrFromString(dir)
	if err != nil {
		return 0, 0, false
	}
	var freeAvail, totalBytes, totalFree uint64
	r1, _, _ := procGetDiskFreeSpaceEx.Call(
		uintptr(unsafe.Pointer(p)),
		uintptr(unsafe.Pointer(&freeAvail)),
		uintptr(unsafe.Pointer(&totalBytes)),
		uintptr(unsafe.Pointer(&totalFree)),
	)
	if r1 == 0 {
		return 0, 0, false
	}
	return totalBytes, totalFree, true
}
