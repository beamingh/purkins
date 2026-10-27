-- Receipt-backed editing of unpublished Purkins product details and categories.
-- Publication stays a separate explicit owner operation.
ALTER TABLE products ADD COLUMN last_mcp_draft_edit_nonce TEXT;
CREATE TABLE IF NOT EXISTS purkins_mcp_draft_edit_receipts (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL CHECK(length(actor) BETWEEN 1 AND 254),
  product_public_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  nonce TEXT NOT NULL UNIQUE,
  expected_revision INTEGER NOT NULL CHECK(expected_revision>=0),
  applied_revision INTEGER,
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_purkins_mcp_draft_edit_created ON purkins_mcp_draft_edit_receipts(created_at);
