-- Guarded fulfillment of an existing, fully paid canonical order.
-- No stock deduction, payment-state change or courier payment assumption.
CREATE TABLE IF NOT EXISTS purkins_mcp_fulfillment_receipts (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL CHECK(length(actor) BETWEEN 1 AND 254),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  order_public_id TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
