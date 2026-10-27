-- Dedicated idempotency receipts for owner MCP payment and courier actions.
-- Pending receipts may be retried ONLY with the same request ID and payload.
-- Existing Admin sale/courier services remain authoritative for stock and status.
CREATE TABLE IF NOT EXISTS purkins_mcp_paid_sale_receipts (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL CHECK(length(actor) BETWEEN 1 AND 254),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  order_public_id TEXT,
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE IF NOT EXISTS purkins_mcp_dispatch_receipts (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL CHECK(length(actor) BETWEEN 1 AND 254),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  request_public_id TEXT NOT NULL,
  applied_revision INTEGER,
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE IF NOT EXISTS purkins_mcp_settlement_receipts (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL CHECK(length(actor) BETWEEN 1 AND 254),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  request_public_id TEXT NOT NULL,
  order_public_id TEXT,
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
