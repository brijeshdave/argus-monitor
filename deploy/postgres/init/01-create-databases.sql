-- Argus — Monitoring Platform · Author: Brijesh Dave <https://github.com/brijeshdave>
-- Runs once on first Postgres boot. POSTGRES_DB creates the master DB; here we
-- add the separate telemetry DB. Schema/migrations are applied by `./argus migrate`.
SELECT 'CREATE DATABASE argus_telemetry'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'argus_telemetry')\gexec
