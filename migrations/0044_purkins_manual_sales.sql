-- Owner-entered, fully settled counter/WhatsApp/Facebook sales.
-- Orders and line items stay in the canonical orders/order_items tables;
-- this table stores only operator-entered metadata, never payment credentials.
CREATE TABLE IF NOT EXISTS purkins_manual_sales (
  order_id INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL CHECK (channel IN ('walk_in','whatsapp','facebook','phone','other')),
  tender TEXT NOT NULL CHECK (tender IN ('cash','airtel_money','mtn_momo','zamtel_money','bank_transfer','other')),
  customer_name TEXT,
  note TEXT,
  recorded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_purkins_manual_sales_channel
  ON purkins_manual_sales(channel, created_at);
