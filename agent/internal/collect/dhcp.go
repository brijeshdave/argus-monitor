// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// DHCP-lease hostname fallback. Asks a Windows DHCP server for the lease hostname of
// an IP via Get-DhcpServerv4Lease. This resolves clients on OTHER subnets (the DHCP
// server knows every scope it serves) where reverse-DNS/NetBIOS can't reach. Opt-in:
// only used when a DHCP server is configured (ARGUS_DHCP_SERVER); needs the DHCP RSAT
// cmdlets + read rights on the agent host. Best-effort — "" on any failure.
package collect

import (
	"context"
	"errors"
	"net"
	"os/exec"
	"strings"
)

func dhcpName(ctx context.Context, dhcpServer, ip string) (string, error) {
	if dhcpServer == "" {
		return "", nil
	}
	// Guard against command injection: only ever pass a validated literal IP.
	if net.ParseIP(ip) == nil {
		return "", errors.New("invalid ip")
	}
	// dhcpServer comes from trusted local config; still keep it to a sane charset.
	if strings.ContainsAny(dhcpServer, "'\";`$|&<>") {
		return "", errors.New("invalid dhcp server")
	}
	script := "$ErrorActionPreference='SilentlyContinue'; " +
		"(Get-DhcpServerv4Lease -ComputerName '" + dhcpServer + "' -IPAddress '" + ip + "').HostName"
	out, err := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", script).Output()
	if err != nil {
		return "", err
	}
	name := strings.TrimSpace(string(out))
	// DHCP often returns an FQDN (PC01.plant.local) — keep the short name.
	if i := strings.IndexByte(name, '.'); i > 0 {
		name = name[:i]
	}
	return name, nil
}
