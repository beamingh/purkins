-- Guarded correction of existing, unpublished multi-variant intake records.
-- One idempotent receipt, parent stock correction, variant correction and
-- private barcode association commit atomically. No public/sale writes.
CREATE TABLE IF NOT EXISTS purkins_mcp_variant_reconcile_receipts (
  request_id TEXT PRIMARY KEY,
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 254),
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  nonce TEXT NOT NULL UNIQUE,
  product_public_id TEXT NOT NULL,
  variant_public_id TEXT NOT NULL,
  expected_parent_stock INTEGER NOT NULL,
  expected_parent_revision INTEGER NOT NULL,
  expected_variant_stock INTEGER NOT NULL,
  expected_variant_revision INTEGER NOT NULL,
  new_variant_stock INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_purkins_mcp_variant_reconciled_at
  ON purkins_mcp_variant_reconcile_receipts(created_at);
