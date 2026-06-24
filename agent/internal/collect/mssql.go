// Argus — Monitoring Platform
// Author: Brijesh Dave <https://github.com/brijeshdave>
//
// SQL Server collection. Connects to a database monitor's instance with a
// least-privilege read-only login (VIEW SERVER STATE) and samples health +
// performance from DMVs. Statement text is NORMALIZED (literals stripped) so no
// PII/secrets leave the box. Every metric query is best-effort: a failure yields a
// null field, never a crash; a failed connection yields status DOWN. Never writes.
// Queries for SQL Server health and performance.
package collect

import (
	"context"
	"database/sql"
	"math"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "github.com/microsoft/go-mssqldb"

	"github.com/brijeshdave/argus-monitor/agent/internal/model"
)

// buildMSSQLDSN assembles a go-mssqldb connection URL from discrete config fields
// (host/port/database/user/password, encrypt). Empty host → "" (not configured).
func buildMSSQLDSN(cfg map[string]any) string {
	host := stringField(cfg, "host")
	if host == "" {
		return ""
	}
	q := url.Values{}
	if db := stringField(cfg, "database"); db != "" {
		q.Set("database", db)
	}
	q.Set("connection timeout", "5")
	q.Set("dial timeout", "5")
	q.Set("app name", "argus-agent")
	if enc, _ := cfg["encrypt"].(bool); !enc {
		q.Set("encrypt", "disable") // default off unless explicitly enabled
	}
	hostport := host
	if p := intField(cfg, "port"); p > 0 {
		hostport = net.JoinHostPort(host, strconv.Itoa(p))
	}
	u := &url.URL{
		Scheme:   "sqlserver",
		User:     url.UserPassword(stringField(cfg, "user"), stringField(cfg, "password")),
		Host:     hostport,
		RawQuery: q.Encode(),
	}
	return u.String()
}

const dbQueryTimeout = 8 * time.Second

// dbRates holds previous cumulative counters per (monitor|counter) for rate math.
var (
	dbRateMu sync.Mutex
	dbRates  = map[string]struct {
		total float64
		ts    time.Time
	}{}
)

// Database probes one SQL Server target via its connection string and returns a unit
// (UP/DOWN) carrying a rich DbSample in meta. Empty connStr → UNKNOWN (not configured).
// When collectQueries is set, the top-N normalized queries are included.
func Database(name, connStr string, collectQueries bool, topN int) model.Unit {
	if connStr == "" {
		return model.Unit{Entity: name, Status: statusUNKNOWN}
	}
	now := time.Now()
	db, err := sql.Open("sqlserver", connStr)
	if err != nil {
		return model.Unit{Entity: name, Status: statusDOWN}
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	db.SetConnMaxLifetime(time.Minute)

	pingCtx, cancel := context.WithTimeout(context.Background(), dbQueryTimeout)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		return model.Unit{Entity: name, Status: statusDOWN}
	}

	ctx, qcancel := context.WithTimeout(context.Background(), dbQueryTimeout)
	defer qcancel()

	s := &model.DbSample{}
	s.UptimeMin = queryFloat(ctx, db, `SELECT DATEDIFF(MINUTE, sqlserver_start_time, GETDATE()) FROM sys.dm_os_sys_info`)
	s.ActiveSessions = queryInt(ctx, db, `SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1`)
	s.BlockedSessions = queryInt(ctx, db, `SELECT COUNT(*) FROM sys.dm_exec_requests WHERE blocking_session_id <> 0`)
	s.BufferCacheHitPct = queryFloat(ctx, db,
		`SELECT CONVERT(FLOAT, a.cntr_value) * 100.0 / NULLIF(b.cntr_value, 0)
		 FROM sys.dm_os_performance_counters a
		 JOIN sys.dm_os_performance_counters b ON a.object_name = b.object_name
		 WHERE a.counter_name = 'Buffer cache hit ratio' AND b.counter_name = 'Buffer cache hit ratio base'`)
	s.Deadlocks = queryInt(ctx, db,
		`SELECT CONVERT(INT, cntr_value) FROM sys.dm_os_performance_counters
		 WHERE counter_name LIKE 'Number of Deadlocks/sec%' AND instance_name = '_Total'`)
	s.PLESeconds = queryInt(ctx, db,
		`SELECT TOP 1 CONVERT(INT, cntr_value) FROM sys.dm_os_performance_counters
		 WHERE counter_name = 'Page life expectancy' AND object_name LIKE '%Buffer Manager%'`)
	s.Connections = queryInt(ctx, db,
		`SELECT CONVERT(INT, cntr_value) FROM sys.dm_os_performance_counters WHERE counter_name = 'User Connections'`)
	if kb := queryFloat(ctx, db,
		`SELECT CONVERT(FLOAT, cntr_value) FROM sys.dm_os_performance_counters WHERE counter_name = 'Total Server Memory (KB)'`); kb != nil {
		mb := round2(*kb / 1024)
		s.TotalServerMemoryMB = &mb
	}
	s.CPUPercent = queryFloat(ctx, db,
		`SELECT TOP 1 CONVERT(FLOAT, record.value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int'))
		 FROM (SELECT timestamp, CONVERT(xml, record) AS record FROM sys.dm_os_ring_buffers
		       WHERE ring_buffer_type = 'RING_BUFFER_SCHEDULER_MONITOR' AND record LIKE '%<SystemHealth>%') AS t
		 ORDER BY timestamp DESC`)
	s.IOReadLatencyMs = queryFloat(ctx, db,
		`SELECT CONVERT(FLOAT, SUM(io_stall_read_ms)) / NULLIF(SUM(num_of_reads), 0) FROM sys.dm_io_virtual_file_stats(NULL, NULL)`)
	s.IOWriteLatencyMs = queryFloat(ctx, db,
		`SELECT CONVERT(FLOAT, SUM(io_stall_write_ms)) / NULLIF(SUM(num_of_writes), 0) FROM sys.dm_io_virtual_file_stats(NULL, NULL)`)
	if total := queryFloat(ctx, db,
		`SELECT CONVERT(FLOAT, cntr_value) FROM sys.dm_os_performance_counters WHERE counter_name = 'Batch Requests/sec'`); total != nil {
		s.BatchReqPerSec = counterRate(name+"|batch", *total, now)
	}
	s.TopWaits = queryWaits(ctx, db)
	s.Sessions = querySessions(ctx, db)
	if collectQueries {
		s.Queries = queryTopQueries(ctx, db, topN)
	}

	return model.Unit{Entity: name, Status: statusUP, Meta: &model.UnitMeta{DB: s}}
}

// counterRate converts a cumulative perf counter into a per-second rate using the
// previous sample for that key. Returns nil on the first sample / counter reset.
func counterRate(key string, total float64, now time.Time) *float64 {
	dbRateMu.Lock()
	defer dbRateMu.Unlock()
	prev, ok := dbRates[key]
	dbRates[key] = struct {
		total float64
		ts    time.Time
	}{total, now}
	if !ok {
		return nil
	}
	dt := now.Sub(prev.ts).Seconds()
	if dt <= 0 {
		return nil
	}
	rate := (total - prev.total) / dt
	if rate < 0 {
		rate = 0
	}
	r := round2(rate)
	return &r
}

func queryFloat(ctx context.Context, db *sql.DB, q string) *float64 {
	var v sql.NullFloat64
	if err := db.QueryRowContext(ctx, q).Scan(&v); err != nil || !v.Valid {
		return nil
	}
	r := round2(v.Float64)
	return &r
}

func queryInt(ctx context.Context, db *sql.DB, q string) *int {
	var v sql.NullInt64
	if err := db.QueryRowContext(ctx, q).Scan(&v); err != nil || !v.Valid {
		return nil
	}
	n := int(v.Int64)
	return &n
}

func queryWaits(ctx context.Context, db *sql.DB) []model.DbWait {
	out := []model.DbWait{}
	rows, err := db.QueryContext(ctx,
		`SELECT TOP 5 wait_type, wait_time_ms FROM sys.dm_os_wait_stats
		 WHERE wait_time_ms > 0 AND wait_type NOT IN (
		   'CLR_SEMAPHORE','LAZYWRITER_SLEEP','RESOURCE_QUEUE','SLEEP_TASK','SLEEP_SYSTEMTASK',
		   'SQLTRACE_BUFFER_FLUSH','WAITFOR','LOGMGR_QUEUE','CHECKPOINT_QUEUE','REQUEST_FOR_DEADLOCK_SEARCH',
		   'XE_TIMER_EVENT','BROKER_TO_FLUSH','BROKER_TASK_STOP','CLR_MANUAL_EVENT','CLR_AUTO_EVENT',
		   'DISPATCHER_QUEUE_SEMAPHORE','FT_IFTS_SCHEDULER_IDLE_WAIT','XE_DISPATCHER_WAIT','XE_DISPATCHER_JOIN',
		   'SQLTRACE_INCREMENTAL_FLUSH_SLEEP','ONDEMAND_TASK_QUEUE','BROKER_EVENTHANDLER','SLEEP_BPOOL_FLUSH',
		   'SOS_SCHEDULER_YIELD')
		 ORDER BY wait_time_ms DESC`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var wt string
		var ms float64
		if rows.Scan(&wt, &ms) == nil {
			out = append(out, model.DbWait{Type: wt, WaitMs: round2(ms)})
		}
	}
	return out
}

func querySessions(ctx context.Context, db *sql.DB) []model.DbSession {
	out := []model.DbSession{}
	rows, err := db.QueryContext(ctx,
		`SELECT TOP 25 s.session_id, s.login_name, s.host_name, s.program_name,
		   r.status, r.wait_type, r.blocking_session_id, r.cpu_time, r.total_elapsed_time,
		   SUBSTRING(t.text, (r.statement_start_offset/2)+1,
		     ((CASE r.statement_end_offset WHEN -1 THEN DATALENGTH(t.text)
		       ELSE r.statement_end_offset END - r.statement_start_offset)/2)+1) AS stmt
		 FROM sys.dm_exec_requests r
		 JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
		 OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
		 WHERE s.is_user_process = 1 AND s.session_id <> @@SPID
		 ORDER BY r.total_elapsed_time DESC`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var sid int
		var login, host, program, status, waitType, stmt sql.NullString
		var blockedBy, cpu, elapsed sql.NullInt64
		if rows.Scan(&sid, &login, &host, &program, &status, &waitType, &blockedBy, &cpu, &elapsed, &stmt) != nil {
			continue
		}
		sess := model.DbSession{SessionID: sid, Login: login.String, Host: host.String, Program: program.String, Status: status.String, WaitType: waitType.String}
		if blockedBy.Valid && blockedBy.Int64 != 0 {
			b := int(blockedBy.Int64)
			sess.BlockedBy = &b
		}
		if cpu.Valid {
			c := float64(cpu.Int64)
			sess.CPUMs = &c
		}
		if elapsed.Valid {
			e := float64(elapsed.Int64)
			sess.ElapsedMs = &e
		}
		if stmt.Valid && stmt.String != "" {
			sess.Statement = stripLiterals(stmt.String)
		}
		out = append(out, sess)
	}
	return out
}

// queryTopQueries returns the top-N queries by total elapsed time, statement text
// NORMALIZED (literals stripped) — no raw values leave the box.
func queryTopQueries(ctx context.Context, db *sql.DB, n int) []model.QueryStat {
	if n <= 0 {
		n = 10
	}
	out := []model.QueryStat{}
	rows, err := db.QueryContext(ctx,
		`SELECT TOP (@n)
		   CONVERT(VARCHAR(34), qs.query_hash, 1) AS query_hash,
		   SUBSTRING(st.text, (qs.statement_start_offset/2)+1,
		     ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(st.text)
		       ELSE qs.statement_end_offset END - qs.statement_start_offset)/2)+1) AS query_text,
		   qs.execution_count, qs.total_elapsed_time/1000.0 AS total_ms, qs.total_logical_reads
		 FROM sys.dm_exec_query_stats qs
		 CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
		 ORDER BY qs.total_elapsed_time DESC`,
		sql.Named("n", n))
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var hash, text string
		var execs, reads int64
		var totalMs float64
		if rows.Scan(&hash, &text, &execs, &totalMs, &reads) != nil {
			continue
		}
		avg := 0.0
		if execs > 0 {
			avg = totalMs / float64(execs)
		}
		out = append(out, model.QueryStat{
			QueryHash:       hash,
			NormalizedText:  stripLiterals(text),
			ExecCount:       int(execs),
			TotalDurationMs: round2(totalMs),
			AvgDurationMs:   round2(avg),
			LogicalReads:    int(reads),
		})
	}
	return out
}

var (
	reStringLit  = regexp.MustCompile(`'(?:[^']|'')*'`)
	reNumberLit  = regexp.MustCompile(`\b\d+(\.\d+)?\b`)
	reWhitespace = regexp.MustCompile(`\s+`)
)

// stripLiterals replaces string/numeric literals with "?" and collapses whitespace,
// turning a concrete statement into a safe-to-display template.
func stripLiterals(s string) string {
	s = reStringLit.ReplaceAllString(s, "?")
	s = reNumberLit.ReplaceAllString(s, "?")
	s = reWhitespace.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

func round2(f float64) float64 { return math.Round(f*100) / 100 }
