-- Private manual courier itinerary and progress for unpaid or paid
-- Facebook / Marketplace / storefront orders. This ledger is deliberately
-- separate from canonical paid orders, stock holds, and actual money receipts.
CREATE TABLE IF NOT EXISTS purkins_request_deliveries (
  request_id INTEGER PRIMARY KEY REFERENCES purkins_order_requests(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  status TEXT NOT NULL CHECK(status IN
    ('planned','dispatched','delivered','delivery_failed','returned')),
  source_channel TEXT NOT NULL CHECK(source_channel IN
    ('facebook_page','facebook_marketplace','whatsapp','website','phone','other')),
  courier TEXT NOT NULL CHECK(courier IN ('yango_bike','other')),
  pickup_location TEXT NOT NULL CHECK(length(pickup_location) BETWEEN 5 AND 500),
  dropoff_location TEXT NOT NULL CHECK(length(dropoff_location) BETWEEN 5 AND 500),
  recipient_name TEXT NOT NULL CHECK(length(recipient_name) BETWEEN 2 AND 100),
  recipient_phone TEXT NOT NULL CHECK(length(recipient_phone) BETWEEN 9 AND 20),
  rider_name TEXT,
  rider_phone TEXT,
  booking_reference TEXT,
  courier_fee_cents INTEGER CHECK(courier_fee_cents >= 0),
  courier_fee_payer TEXT NOT NULL CHECK(courier_fee_payer IN
    ('customer_to_rider','purkins','not_agreed')),
  courier_fee_state TEXT NOT NULL DEFAULT 'unconfirmed' CHECK(courier_fee_state IN
    ('unconfirmed','customer_reports_paid','purkins_paid')),
  operator_note TEXT,
  change_nonce TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((courier_fee_state='unconfirmed') OR
    (courier_fee_state='customer_reports_paid' AND courier_fee_payer='customer_to_rider') OR
    (courier_fee_state='purkins_paid' AND courier_fee_payer='purkins'))
);

CREATE TABLE IF NOT EXISTS purkins_request_delivery_events (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES purkins_order_requests(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision > 0),
  status TEXT NOT NULL,
  source_channel TEXT NOT NULL,
  courier TEXT NOT NULL,
  pickup_location TEXT NOT NULL,
  dropoff_location TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  rider_name TEXT,
  rider_phone TEXT,
  booking_reference TEXT,
  courier_fee_cents INTEGER,
  courier_fee_payer TEXT NOT NULL,
  courier_fee_state TEXT NOT NULL,
  operator_note TEXT,
  changed_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(request_id,revision)
);
CREATE INDEX IF NOT EXISTS idx_purkins_delivery_events_request
  ON purkins_request_delivery_events(request_id,revision DESC);

-- Never return inventory to the available pool while it is on a bike, at
-- the customer's address, or unaccounted for after a failed delivery.
-- A physical return must first be recorded on the delivery log.
CREATE TRIGGER IF NOT EXISTS purkins_guard_release_dispatched_stock
BEFORE UPDATE OF status ON purkins_order_request_allocations
WHEN NEW.status='released' AND EXISTS (
  SELECT 1 FROM purkins_request_deliveries d
  WHERE d.request_id=OLD.request_id
    AND d.status IN ('dispatched','delivered','delivery_failed')
)
BEGIN
  SELECT RAISE(ABORT,'Confirm physical parcel return before releasing stock');
END;
