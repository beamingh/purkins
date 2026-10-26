-- Optional compare-at (previous) price for selected promotions.
-- Stored in the product currency's minor units; NULL means no displayed sale.
-- Only a genuinely higher previous price can be advertised.
ALTER TABLE products
  ADD COLUMN compare_at_price_cents INTEGER
    CHECK (compare_at_price_cents IS NULL OR
      (compare_at_price_cents > price_cents AND compare_at_price_cents > 0));

-- The guarded catalog publication flow must notice promotion changes,
-- including when a merchant changes only the former price.
CREATE TRIGGER IF NOT EXISTS purkins_catalog_compare_at_update
AFTER UPDATE OF compare_at_price_cents ON products
WHEN OLD.compare_at_price_cents IS NOT NEW.compare_at_price_cents
BEGIN
  UPDATE products SET mcp_catalog_revision=mcp_catalog_revision+1 WHERE id=NEW.id;
END;
