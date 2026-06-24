// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// Wire types for the agent↔backend HTTP control plane. These marshal to the exact
// JSON shapes defined in packages/shared (camelCase keys), so the Go agent and the
// TypeScript backend speak the same contract.
package model

// RegisterRequest is sent to /api/agent/register on first contact and refresh.
type RegisterRequest struct {
	Name      string `json:"name,omitempty"`
	Hostname  string `json:"hostname,omitempty"`
	Platform  string `json:"platform,omitempty"`
	Version   string `json:"version,omitempty"`
	Address   string `json:"address,omitempty"`
	BuildTime string `json:"buildTime,omitempty"`
}

// RegisterResponse is the backend's reply: the bound agent id and its status.
type RegisterResponse struct {
	AgentID string `json:"agentId"`
	Status  string `json:"status"`
}

// Metrics is a host metrics sample. Pointers distinguish "absent" from zero.
type Metrics struct {
	CPUPct    *float64       `json:"cpuPct,omitempty"`
	MemPct    *float64       `json:"memPct,omitempty"`
	MemUsedMB *int           `json:"memUsedMb,omitempty"`
	Extra     map[string]any `json:"extra,omitempty"`
}

// LogLine is a categorized log entry.
type LogLine struct {
	Category string         `json:"category"`
	Level    string         `json:"level"`
	Message  string         `json:"message"`
	Context  map[string]any `json:"context,omitempty"`
}

// MonitorConfig is one monitor the agent must collect for, as delivered by
// GET /api/agent/config. Config holds type-specific knobs (e.g. host/port/match).
type MonitorConfig struct {
	ID     string         `json:"id"`
	Type   string         `json:"type"`
	Name   string         `json:"name"`
	Config map[string]any `json:"config"`
}

// ConfigResponse is the backend's reply for GET /api/agent/config.
type ConfigResponse struct {
	Monitors []MonitorConfig `json:"monitors"`
	// PushIntervalSec is the effective collect/push cadence the agent should run
	// at (0 = unspecified; keep current). Applied live, no restart.
	PushIntervalSec int `json:"pushIntervalSec"`
	// Timezone is the server's IANA timezone for log timestamps (e.g. "Asia/Kolkata").
	// Applied unless the agent has a local timezone override in its config.
	Timezone string `json:"timezone,omitempty"`
	// IngestHosts are ADDITIONAL backends (base URLs) the agent should also push
	// telemetry to, beyond this master. The master delivers + controls this list;
	// the agent uses its existing connection key for each target.
	IngestHosts []string `json:"ingestHosts,omitempty"`
	// Debug turns on verbose agent logging (server-controlled, applied live).
	Debug bool `json:"debug,omitempty"`
}

// InvItem is one discoverable thing on the host the operator can pick to monitor.
// Detail carries the executable path (process) or display name (service).
type InvItem struct {
	Name   string `json:"name"`
	Detail string `json:"detail,omitempty"`
}

// Inventory is the host's discoverable services + processes, pushed to the backend
// so the UI can offer a pick-list instead of a hand-typed match string.
type Inventory struct {
	Services  []InvItem `json:"services"`
	Processes []InvItem `json:"processes"`
}

// ClientSample is one ESTABLISHED remote client on a monitored service port.
type ClientSample struct {
	IP             string `json:"ip"`
	Port           int    `json:"port"`
	LocalPort      int    `json:"localPort,omitempty"`
	Hostname       string `json:"hostname,omitempty"`
	HostnameSource string `json:"hostnameSource,omitempty"`
	MAC            string `json:"mac,omitempty"`
}

// DbWait is one wait type's accumulated wait (top-waits list).
type DbWait struct {
	Type   string  `json:"type"`
	WaitMs float64 `json:"waitMs"`
}

// DbSession is one currently-running SQL Server request; statement normalized.
type DbSession struct {
	SessionID int      `json:"sessionId"`
	Login     string   `json:"login,omitempty"`
	Host      string   `json:"host,omitempty"`
	Program   string   `json:"program,omitempty"`
	Status    string   `json:"status,omitempty"`
	WaitType  string   `json:"waitType,omitempty"`
	BlockedBy *int     `json:"blockedBy,omitempty"`
	CPUMs     *float64 `json:"cpuMs,omitempty"`
	ElapsedMs *float64 `json:"elapsedMs,omitempty"`
	Statement string   `json:"statement,omitempty"`
}

// FolderNode is one folder on a share with its recursive size + file/subfolder counts.
type FolderNode struct {
	Name        string `json:"name"`
	SizeBytes   int64  `json:"sizeBytes"`
	FileCount   int    `json:"fileCount"`
	FolderCount int    `json:"folderCount,omitempty"`
}

// StorageSample is a NAS/SMB share capacity sample.
type StorageSample struct {
	Reachable  bool         `json:"reachable"`
	TotalBytes *int64       `json:"totalBytes,omitempty"`
	FreeBytes  *int64       `json:"freeBytes,omitempty"`
	UsedBytes  *int64       `json:"usedBytes,omitempty"`
	UsedPct    *float64     `json:"usedPct,omitempty"`
	Folders    []FolderNode `json:"folders,omitempty"`
}

// QueryStat is aggregate stats for one normalized query template.
type QueryStat struct {
	QueryHash       string  `json:"queryHash"`
	NormalizedText  string  `json:"normalizedText"`
	ExecCount       int     `json:"execCount"`
	TotalDurationMs float64 `json:"totalDurationMs"`
	AvgDurationMs   float64 `json:"avgDurationMs"`
	LogicalReads    int     `json:"logicalReads"`
}

// DbSample is SQL Server health + performance detail (core subset).
type DbSample struct {
	UptimeMin           *float64    `json:"uptimeMin,omitempty"`
	CPUPercent          *float64    `json:"cpuPercent,omitempty"`
	ActiveSessions      *int        `json:"activeSessions,omitempty"`
	Connections         *int        `json:"connections,omitempty"`
	BlockedSessions     *int        `json:"blockedSessions,omitempty"`
	Deadlocks           *int        `json:"deadlocks,omitempty"`
	BatchReqPerSec      *float64    `json:"batchReqPerSec,omitempty"`
	BufferCacheHitPct   *float64    `json:"bufferCacheHitPct,omitempty"`
	PLESeconds          *int        `json:"pleSeconds,omitempty"`
	TotalServerMemoryMB *float64    `json:"totalServerMemoryMB,omitempty"`
	IOReadLatencyMs     *float64    `json:"ioReadLatencyMs,omitempty"`
	IOWriteLatencyMs    *float64    `json:"ioWriteLatencyMs,omitempty"`
	TopWaits            []DbWait    `json:"topWaits,omitempty"`
	Sessions            []DbSession `json:"sessions,omitempty"`
	Queries             []QueryStat `json:"queries,omitempty"`
}

// UnitMeta is rich service/process detail. Pointers/omitempty
// so absent fields serialize away. Matches shared UnitMeta (camelCase JSON).
type UnitMeta struct {
	User        string         `json:"user,omitempty"`
	ExePath     string         `json:"exePath,omitempty"`
	CPUPercent  *float64       `json:"cpuPercent,omitempty"`
	MemMB       *float64       `json:"memMB,omitempty"`
	UptimeSec   *int64         `json:"uptimeSec,omitempty"`
	Threads     *int           `json:"threads,omitempty"`
	ListenPorts []int          `json:"listenPorts,omitempty"`
	ClientCount *int           `json:"clientCount,omitempty"`
	Clients     []ClientSample `json:"clients,omitempty"`
	DB          *DbSample      `json:"db,omitempty"`
	Storage     *StorageSample `json:"storage,omitempty"`
}

// Unit is one monitored entity's current health, as reported by the agent. PID is
// a pointer so "no pid" serializes as absent rather than zero.
type Unit struct {
	Entity   string    `json:"entity"`
	Status   string    `json:"status"`
	PID      *int      `json:"pid,omitempty"`
	Critical bool      `json:"critical,omitempty"`
	Meta     *UnitMeta `json:"meta,omitempty"`
}

// IngestRequest is the telemetry snapshot pushed to /api/agent/ingest.
type IngestRequest struct {
	Metrics *Metrics  `json:"metrics,omitempty"`
	Units   []Unit    `json:"units,omitempty"`
	Logs    []LogLine `json:"logs,omitempty"`
}
