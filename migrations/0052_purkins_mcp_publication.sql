-- Owner-only, idempotent approval and hiding, with optimistic catalog versions.
-- Catalog revision advances on every Admin/MCP-sensitive change, INCLUDING
-- variant price/photo/intake changes. A stale publication snapshot cannot win.
ALTER TABLE products ADD COLUMN mcp_catalog_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN last_mcp_publication_nonce TEXT;

CREATE TABLE IF NOT EXISTS purkins_mcp_publication_receipts (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL CHECK(length(actor) BETWEEN 1 AND 254),
  action TEXT NOT NULL CHECK(action IN ('publish','unpublish')),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  nonce TEXT NOT NULL UNIQUE,
  product_public_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK(expected_revision>=0),
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  cache_purged INTEGER NOT NULL DEFAULT 0 CHECK(cache_purged IN (0,1)),
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_purkins_mcp_publication_created
 ON purkins_mcp_publication_receipts(created_at);

CREATE TRIGGER IF NOT EXISTS purkins_catalog_product_update
AFTER UPDATE OF name,slug,description,price_cents,currency,image_key,active,stock,variant_label,weight_grams,requires_shipping ON products
WHEN OLD.name IS NOT NEW.name OR OLD.slug IS NOT NEW.slug
  OR OLD.description IS NOT NEW.description OR OLD.price_cents IS NOT NEW.price_cents
  OR OLD.currency IS NOT NEW.currency OR OLD.image_key IS NOT NEW.image_key
  OR OLD.active IS NOT NEW.active OR OLD.stock IS NOT NEW.stock
  OR OLD.variant_label IS NOT NEW.variant_label OR OLD.weight_grams IS NOT NEW.weight_grams
  OR OLD.requires_shipping IS NOT NEW.requires_shipping
BEGIN
 UPDATE products SET mcp_catalog_revision=mcp_catalog_revision+1 WHERE id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS purkins_catalog_variant_insert
AFTER INSERT ON product_variants
BEGIN
 UPDATE products SET mcp_catalog_revision=mcp_catalog_revision+1 WHERE id=NEW.product_id;
END;

CREATE TRIGGER IF NOT EXISTS purkins_catalog_variant_delete
AFTER DELETE ON product_variants
BEGIN
 UPDATE products SET mcp_catalog_revision=mcp_catalog_revision+1 WHERE id=OLD.product_id;
END;

CREATE TRIGGER IF NOT EXISTS purkins_catalog_variant_update
AFTER UPDATE OF label,price_cents,stock,active,image_id,weight_grams,sku ON product_variants
WHEN OLD.label IS NOT NEW.label OR OLD.price_cents IS NOT NEW.price_cents
 OR OLD.stock IS NOT NEW.stock OR OLD.active IS NOT NEW.active
 OR OLD.image_id IS NOT NEW.image_id OR OLD.weight_grams IS NOT NEW.weight_grams
 OR OLD.sku IS NOT NEW.sku
BEGIN
 UPDATE products SET mcp_catalog_revision=mcp_catalog_revision+1 WHERE id=NEW.product_id;
END;

CREATE TRIGGER IF NOT EXISTS purkins_catalog_intake_update
AFTER UPDATE OF status,condition_status,pricing_mode,purchase_cost_minor,purchase_currency,zar_to_zmw,overhead_zwm_cents,markup_percent ON purkins_intake
WHEN OLD.status IS NOT NEW.status OR OLD.condition_status IS NOT NEW.condition_status
 OR OLD.pricing_mode IS NOT NEW.pricing_mode OR OLD.purchase_cost_minor IS NOT NEW.purchase_cost_minor
 OR OLD.purchase_currency IS NOT NEW.purchase_currency OR OLD.zar_to_zmw IS NOT NEW.zar_to_zmw
 OR OLD.overhead_zwm_cents IS NOT NEW.overhead_zwm_cents OR OLD.markup_percent IS NOT NEW.markup_percent
BEGIN
 UPDATE products SET mcp_catalog_revision=mcp_catalog_revision+1 WHERE id=NEW.product_id;
END;

CREATE TRIGGER IF NOT EXISTS purkins_catalog_photo_insert
AFTER INSERT ON product_images
BEGIN
 UPDATE products SET mcp_catalog_revision=mcp_catalog_revision+1 WHERE id=NEW.product_id;
END;

CREATE TRIGGER IF NOT EXISTS purkins_catalog_photo_delete
AFTER DELETE ON product_images
BEGIN
 UPDATE products SET mcp_catalog_revision=mcp_catalog_revision+1 WHERE id=OLD.product_id;
END;

CREATE TRIGGER IF NOT EXISTS purkins_catalog_photo_update
AFTER UPDATE OF image_key,position,alt ON product_images
WHEN OLD.image_key IS NOT NEW.image_key OR OLD.position IS NOT NEW.position OR OLD.alt IS NOT NEW.alt
BEGIN
 UPDATE products SET mcp_catalog_revision=mcp_catalog_revision+1 WHERE id=NEW.product_id;
END;
