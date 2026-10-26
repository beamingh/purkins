-- Owner-prepared offline quote. NOT a customer acceptance, stock allocation,
-- payment receipt or fulfilled order. Request lines are an immutable snapshot.
-- This is additive and leaves all canonical paid-order accounting untouched.
CREATE TABLE IF NOT EXISTS purkins_order_request_quotes (
  request_id INTEGER PRIMARY KEY REFERENCES purkins_order_requests(id) ON DELETE RESTRICT,
  subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents > 0),
  delivery_fee_cents INTEGER NOT NULL CHECK(delivery_fee_cents >= 0),
  discount_cents INTEGER NOT NULL CHECK(discount_cents >= 0),
  total_cents INTEGER NOT NULL CHECK(total_cents > 0),
  fulfillment_method TEXT NOT NULL CHECK(fulfillment_method IN ('delivery','pickup')),
  delivery_details TEXT,
  owner_note TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  change_nonce TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(total_cents = subtotal_cents + delivery_fee_cents - discount_cents)
);

CREATE TABLE IF NOT EXISTS purkins_order_request_quote_events (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES purkins_order_requests(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  subtotal_cents INTEGER NOT NULL,
  delivery_fee_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  fulfillment_method TEXT NOT NULL CHECK(fulfillment_method IN ('delivery','pickup')),
  delivery_details TEXT,
  owner_note TEXT,
  changed_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(request_id, revision)
);
CREATE INDEX IF NOT EXISTS idx_purkins_order_request_quote_events
  ON purkins_order_request_quote_events(request_id, revision DESC);
