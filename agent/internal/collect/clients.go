// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Client enrichment: resolve a remote IP's hostname (cached reverse-DNS, never
// blocking the collect loop for long) and look up its MAC from the host ARP cache
// (LAN clients only). Read-only and best-effort — failures yield empty fields.
// NetBIOS/DHCP hostname fallbacks can layer in here later behind the same cache.
package collect

import (
	"bufio"
	"context"
	"net"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

// hostnameCache memoises name resolution (including misses) so we never re-query
// the same IP and never block the cycle repeatedly.
type resolvedName struct {
	name   string
	source string // "dns" | "netbios" | ""
}

var (
	hostnameMu    sync.Mutex
	hostnameCache = map[string]resolvedName{}
	dhcpServer    string // optional Windows DHCP server for the cross-subnet lease fallback
)

// SetDhcpServer enables the DHCP-lease hostname fallback against the given Windows
// DHCP server (empty disables it). Set from ARGUS_DHCP_SERVER at startup.
func SetDhcpServer(s string) { dhcpServer = s }

// resolveHostname returns a cached name + source for ip. It tries reverse-DNS first,
// then falls back to NetBIOS (Windows LAN machine names that have no DNS PTR record).
// New IPs get one bounded lookup; the result (hit or miss) is cached.
func resolveHostname(ip string) (string, string) {
	hostnameMu.Lock()
	if r, ok := hostnameCache[ip]; ok {
		hostnameMu.Unlock()
		return r.name, r.source
	}
	hostnameMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	r := resolvedName{}
	if names, err := net.DefaultResolver.LookupAddr(ctx, ip); err == nil && len(names) > 0 {
		r = resolvedName{name: strings.TrimSuffix(names[0], "."), source: "dns"}
	} else if nb := netbiosName(ip); nb != "" {
		r = resolvedName{name: nb, source: "netbios"}
	} else if dhcpServer != "" {
		// Cross-subnet fallback: ask the DHCP server for the lease hostname.
		dctx, dcancel := context.WithTimeout(context.Background(), 6*time.Second)
		if n, err := dhcpName(dctx, dhcpServer, ip); err == nil && n != "" {
			r = resolvedName{name: n, source: "dhcp"}
		}
		dcancel()
	}
	hostnameMu.Lock()
	hostnameCache[ip] = r
	hostnameMu.Unlock()
	return r.name, r.source
}

// netbiosName best-effort resolves a LAN IP's machine name via NetBIOS — `nbtstat -A`
// on Windows, `nmblookup -A` (Samba) elsewhere. Returns the <00> UNIQUE workstation
// name, or "" on any failure / non-LAN host.
func netbiosName(ip string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var (
		out []byte
		err error
	)
	if runtime.GOOS == "windows" {
		out, err = exec.CommandContext(ctx, "nbtstat", "-A", ip).Output()
	} else {
		out, err = exec.CommandContext(ctx, "nmblookup", "-A", ip).Output()
	}
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		// e.g. "    DESKTOP-ABC    <00>  UNIQUE      Registered"
		if strings.Contains(line, "<00>") && strings.Contains(strings.ToUpper(line), "UNIQUE") {
			if fields := strings.Fields(line); len(fields) > 0 {
				return fields[0]
			}
		}
	}
	return ""
}

var macLine = regexp.MustCompile(`([0-9a-fA-F]{1,2}[:-]){5}[0-9a-fA-F]{1,2}`)
var ipLine = regexp.MustCompile(`\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b`)

// arpTable returns a best-effort map of IP → MAC from the host ARP cache. Linux reads
// /proc/net/arp; other platforms parse `arp -a`. Empty on any failure.
func arpTable() map[string]string {
	if runtime.GOOS == "linux" {
		if t := arpFromProc(); len(t) > 0 {
			return t
		}
	}
	return arpFromCmd()
}

func arpFromProc() map[string]string {
	f, err := os.Open("/proc/net/arp")
	if err != nil {
		return nil
	}
	defer f.Close()
	out := map[string]string{}
	sc := bufio.NewScanner(f)
	sc.Scan() // header
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) >= 4 && fields[3] != "00:00:00:00:00:00" {
			out[fields[0]] = strings.ToLower(fields[3])
		}
	}
	return out
}

func arpFromCmd() map[string]string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "arp", "-a").Output()
	if err != nil {
		return nil
	}
	table := map[string]string{}
	for _, line := range strings.Split(string(out), "\n") {
		ip := ipLine.FindString(line)
		mac := macLine.FindString(line)
		if ip != "" && mac != "" {
			table[ip] = strings.ToLower(strings.ReplaceAll(mac, "-", ":"))
		}
	}
	return table
}
