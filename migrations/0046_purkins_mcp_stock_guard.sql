-- Transaction receipts for guarded owner draft creation and inventory corrections.
-- This ledger is separate from 0045's location-only action constraint. Never
-- store customers, bearer tokens, JWTs or raw product-intake payloads here.
CREATE TABLE IF NOT EXISTS purkins_mcp_stock_mutations (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 254),
  action TEXT NOT NULL CHECK (action IN ('product.create_draft','stock.adjust')),
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  nonce TEXT NOT NULL UNIQUE,
  target_id TEXT NOT NULL,
  before_stock INTEGER,
  after_stock INTEGER,
  outcome TEXT NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending','applied','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_purkins_mcp_stock_mutations_created
  ON purkins_mcp_stock_mutations(created_at);

-- Revision tracking includes all stock-changing paths (checkout, manual sales,
-- Admin, MCP). Matching quantity alone is NOT enough: stock can change from
-- 5 -> 4 -> 5 between operator reads, otherwise defeating optimistic checks.
ALTER TABLE products ADD COLUMN mcp_stock_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN last_mcp_stock_request TEXT;
ALTER TABLE product_variants ADD COLUMN mcp_stock_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN last_mcp_stock_request TEXT;

CREATE TRIGGER IF NOT EXISTS purkins_product_stock_revision
AFTER UPDATE OF stock ON products
WHEN NEW.stock <> OLD.stock
BEGIN
  UPDATE products SET mcp_stock_revision = mcp_stock_revision + 1
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS purkins_variant_stock_revision
AFTER UPDATE OF stock ON product_variants
WHEN NEW.stock <> OLD.stock
BEGIN
  UPDATE product_variants SET mcp_stock_revision = mcp_stock_revision + 1
  WHERE id = NEW.id;
END;
