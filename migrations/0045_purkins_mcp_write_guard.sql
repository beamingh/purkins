-- Owner MCP mutation receipts: one durable receipt per client request.
-- The receipt and the guarded location change MUST be in the same D1.batch.
-- This intentionally contains no customer personal data or bearer/JWT credentials.
CREATE TABLE IF NOT EXISTS purkins_mcp_mutations (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 254),
  action TEXT NOT NULL CHECK (action IN ('location.create','location.move')),
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  nonce TEXT NOT NULL UNIQUE,
  target_id TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','applied','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_purkins_mcp_mutations_created
  ON purkins_mcp_mutations(created_at);

-- Admin's existing location writes do not change this MCP fencing marker;
-- they still take effect and cause stale MCP version checks to fail when
-- handled by the guarded path. Existing Admin location moves now increment
-- mcp_version in the shared moveLocation service. The MCP write guard checks
-- BOTH expected parent and version, with a SQLite cycle trigger as fallback.
ALTER TABLE purkins_locations ADD COLUMN mcp_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purkins_locations ADD COLUMN last_mcp_request TEXT;
