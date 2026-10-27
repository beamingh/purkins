-- Owner-only MCP photo uploads use a retriable receipt, never public pages.
-- A failed R2->D1 transition may leave an unattached library object; no public
-- listing, sales or gallery mutation takes place in this operation.
CREATE TABLE IF NOT EXISTS purkins_mcp_photo_upload_receipts (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL CHECK(length(actor) BETWEEN 1 AND 254),
  product_public_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  media_public_id TEXT,
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
