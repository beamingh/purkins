-- PR #16: guarded, idempotent private gallery operations.
-- Existing Admin gallery updates also advance the same product revision.
ALTER TABLE products ADD COLUMN mcp_gallery_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_images ADD COLUMN last_mcp_gallery_nonce TEXT;

CREATE TABLE IF NOT EXISTS purkins_mcp_gallery_receipts (
  request_id TEXT NOT NULL PRIMARY KEY,
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 254),
  action TEXT NOT NULL CHECK (action IN ('gallery.attach','gallery.alt','gallery.primary')),
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  nonce TEXT NOT NULL UNIQUE,
  product_public_id TEXT NOT NULL,
  image_public_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_purkins_mcp_gallery_created
  ON purkins_mcp_gallery_receipts(created_at);

CREATE TRIGGER IF NOT EXISTS purkins_gallery_version_insert
AFTER INSERT ON product_images
BEGIN
  UPDATE products SET mcp_gallery_revision = mcp_gallery_revision + 1
  WHERE id = NEW.product_id;
END;

CREATE TRIGGER IF NOT EXISTS purkins_gallery_version_delete
AFTER DELETE ON product_images
BEGIN
  UPDATE products SET mcp_gallery_revision = mcp_gallery_revision + 1
  WHERE id = OLD.product_id;
END;

CREATE TRIGGER IF NOT EXISTS purkins_gallery_version_update
AFTER UPDATE OF position, alt, image_key ON product_images
WHEN OLD.position <> NEW.position OR OLD.alt IS NOT NEW.alt OR OLD.image_key <> NEW.image_key
BEGIN
  UPDATE products SET mcp_gallery_revision = mcp_gallery_revision + 1
  WHERE id = NEW.product_id;
END;
