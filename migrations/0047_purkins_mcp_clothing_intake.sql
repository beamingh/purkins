-- PR #15: independently auditable, replay-safe clothing intake.
-- Each product draft and ALL of its variants commit in one D1.batch.
-- Bulk requests are resumable per item: no ambiguous partial product rows.
CREATE TABLE IF NOT EXISTS purkins_mcp_clothing_receipts (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 254),
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  nonce TEXT NOT NULL UNIQUE,
  product_public_id TEXT NOT NULL UNIQUE,
  total_units INTEGER NOT NULL CHECK (total_units BETWEEN 0 AND 1000000),
  variant_count INTEGER NOT NULL CHECK (variant_count BETWEEN 1 AND 20),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_purkins_mcp_clothing_created
  ON purkins_mcp_clothing_receipts(created_at);

-- Brand/retailer tags vary by size. These are private to the operator;
-- they are not offered in shopper-facing product/variant projections.
CREATE TABLE IF NOT EXISTS purkins_variant_intake_details (
  variant_id INTEGER PRIMARY KEY REFERENCES product_variants(id) ON DELETE CASCADE,
  size_label TEXT,
  colour TEXT,
  retail_tag_minor INTEGER CHECK (retail_tag_minor IS NULL OR retail_tag_minor >= 0),
  retail_tag_currency TEXT NOT NULL DEFAULT 'ZAR' CHECK (retail_tag_currency IN ('ZAR', 'ZMW')),
  pack_count INTEGER CHECK (pack_count IS NULL OR pack_count BETWEEN 1 AND 999)
);
