-- Unpaid enquiries/order requests made on the public Purkins cart.
-- Deliberately separate from canonical ORDERS, which currently means settled
-- money. Request submissions DO NOT reserve/deduct stock or count as sales.
CREATE TABLE IF NOT EXISTS purkins_order_requests (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL UNIQUE,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  nonce TEXT NOT NULL UNIQUE,
  buyer_name TEXT NOT NULL CHECK(length(buyer_name) BETWEEN 2 AND 100),
  phone TEXT NOT NULL CHECK(length(phone) BETWEEN 9 AND 20),
  email TEXT,
  fulfillment_preference TEXT NOT NULL
    CHECK(fulfillment_preference IN ('delivery','pickup','discuss')),
  payment_preference TEXT NOT NULL
    CHECK(payment_preference IN ('pay_on_delivery','pay_after_instructions','contact_me')),
  area TEXT,
  address_notes TEXT,
  customer_note TEXT,
  subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'zmw' CHECK(currency='zmw'),
  status TEXT NOT NULL DEFAULT 'new'
    CHECK(status IN ('new','contacted','awaiting_payment','cancelled')),
  operator_note TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_purkins_order_requests_queue
  ON purkins_order_requests(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purkins_order_requests_phone
  ON purkins_order_requests(phone,created_at DESC);

CREATE TABLE IF NOT EXISTS purkins_order_request_items (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES purkins_order_requests(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id INTEGER REFERENCES product_variants(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99)
);
CREATE INDEX IF NOT EXISTS idx_purkins_order_request_items
  ON purkins_order_request_items(request_id);
