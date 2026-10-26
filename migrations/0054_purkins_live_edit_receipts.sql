-- Audit and replay protection for OWNER live-copy changes to already published
-- Purkins products. No customer data or raw description text is stored here.
-- A receipt is committed atomically with the product CAS update.
ALTER TABLE products ADD COLUMN last_purkins_live_edit_nonce TEXT;

CREATE TABLE IF NOT EXISTS purkins_live_edit_receipts (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL CHECK(length(actor) BETWEEN 1 AND 254),
  product_public_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  nonce TEXT NOT NULL UNIQUE,
  expected_revision INTEGER NOT NULL CHECK(expected_revision>=0),
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  cache_purged INTEGER NOT NULL DEFAULT 0 CHECK(cache_purged IN (0,1)),
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_purkins_live_edit_created
  ON purkins_live_edit_receipts(created_at);
