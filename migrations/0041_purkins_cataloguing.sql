-- Purkins-only inventory identification and supplier reference data.
-- Supplier shelf/tag prices are NOT actual purchase costs.
ALTER TABLE purkins_intake ADD COLUMN brand TEXT;
ALTER TABLE purkins_intake ADD COLUMN supplier_barcode TEXT;
ALTER TABLE purkins_intake ADD COLUMN retail_tag_minor INTEGER CHECK (retail_tag_minor IS NULL OR retail_tag_minor >= 0);
ALTER TABLE purkins_intake ADD COLUMN retail_tag_currency TEXT NOT NULL DEFAULT 'ZAR' CHECK (retail_tag_currency IN ('ZAR','ZMW'));
ALTER TABLE purkins_intake ADD COLUMN pack_count INTEGER CHECK (pack_count IS NULL OR pack_count >= 1);
ALTER TABLE purkins_intake ADD COLUMN condition_status TEXT NOT NULL DEFAULT 'complete' CHECK (condition_status IN ('complete','incomplete','review'));
ALTER TABLE purkins_intake ADD COLUMN internal_notes TEXT;
-- Variant barcodes are private operator data. No assumption that barcode is a GTIN.
CREATE TABLE IF NOT EXISTS purkins_variant_identifiers (
  variant_id INTEGER PRIMARY KEY REFERENCES product_variants(id) ON DELETE CASCADE,
  supplier_barcode TEXT
);
CREATE INDEX IF NOT EXISTS idx_purkins_variant_barcode ON purkins_variant_identifiers(supplier_barcode);
