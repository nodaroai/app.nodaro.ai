-- Re-label MCP jobs that were recorded as `internal`.
--
-- deriveJobSource (backend/src/lib/job-source.ts) checked the internal-
-- orchestrator secret before `mcp_client`, and every MCP verb reaches our
-- routes by inject() WITH that secret, so from the column's first day
-- (2026-07-29) every MCP job was stored as source = 'internal'. The order is
-- fixed in the same change; this moves the rows already written, using the
-- `mcp_client` they carry (the same value the fixed code writes as the detail).
UPDATE jobs
SET source = 'mcp',
    source_detail = left(mcp_client, 80)
WHERE source = 'internal'
  AND mcp_client IS NOT NULL
  AND mcp_client <> '';
