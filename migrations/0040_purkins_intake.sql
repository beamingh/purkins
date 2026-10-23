-- Purkins private stock intake and pricing data.
-- Public storefront and cart queries must never include this table.
CREATE TABLE IF NOT EXISTS purkins_intake (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT NOT NULL UNIQUE,
  size_label TEXT,
  colour TEXT,
  age_range TEXT,
  storage_location TEXT,
  purchase_currency TEXT NOT NULL DEFAULT 'ZMW' CHECK (purchase_currency IN ('ZMW', 'ZAR')),
  purchase_cost_minor INTEGER CHECK (purchase_cost_minor IS NULL OR purchase_cost_minor >= 0),
  zar_to_zmw REAL CHECK (zar_to_zmw IS NULL OR zar_to_zmw > 0),
  overhead_zwm_cents INTEGER NOT NULL DEFAULT 0 CHECK (overhead_zwm_cents >= 0),
  markup_percent INTEGER CHECK (markup_percent IS NULL OR markup_percent BETWEEN 0 AND 500),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_purkins_intake_status ON purkins_intake(status);
CREATE INDEX IF NOT EXISTS idx_purkins_intake_location ON purkins_intake(storage_location);
