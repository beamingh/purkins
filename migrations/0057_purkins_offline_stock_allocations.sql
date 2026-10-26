-- Confirmed, owner-controlled allocation for an agreed unpaid offline quote.
-- Held units leave visible catalog stock exactly once and can be returned exactly
-- once. There is NO automatic expiry: COD appointment dates may exceed 48 hours.
-- Never imply that a hold has been paid for or handed over.
CREATE TABLE IF NOT EXISTS purkins_order_request_allocations (
  request_id INTEGER PRIMARY KEY REFERENCES purkins_order_requests(id) ON DELETE RESTRICT,
  quote_revision INTEGER NOT NULL CHECK(quote_revision > 0),
  lines_json TEXT NOT NULL CHECK(length(lines_json) > 2),
  status TEXT NOT NULL CHECK(status IN ('held','released')),
  hold_nonce TEXT NOT NULL UNIQUE,
  held_by TEXT NOT NULL,
  held_at TEXT NOT NULL DEFAULT (datetime('now')),
  released_by TEXT,
  released_at TEXT,
  release_reason TEXT,
  CHECK ((status='held' AND released_at IS NULL) OR (status='released' AND released_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_purkins_request_allocations_status
  ON purkins_order_request_allocations(status,held_at);

-- Held inventory must be released before a request can be cancelled.
CREATE TRIGGER IF NOT EXISTS purkins_block_cancel_held_request
BEFORE UPDATE OF status ON purkins_order_requests
WHEN NEW.status='cancelled' AND EXISTS (
  SELECT 1 FROM purkins_order_request_allocations
  WHERE request_id=OLD.id AND status='held'
)
BEGIN
  SELECT RAISE(ABORT,'Release allocated stock before cancelling request');
END;

-- A hold represents the customer's agreement to THIS quote revision.
-- No pricing/fulfillment edits while its stock is still held.
CREATE TRIGGER IF NOT EXISTS purkins_block_quote_edit_with_hold
BEFORE UPDATE ON purkins_order_request_quotes
WHEN EXISTS (
  SELECT 1 FROM purkins_order_request_allocations
  WHERE request_id=OLD.request_id AND status='held'
)
BEGIN
  SELECT RAISE(ABORT,'Release allocated stock before revising quote');
END;

-- Preserve the rows required to restore held stock if a product is retired.
-- The JSON contains the full typed item snapshot; only active holds block deletion.
CREATE TRIGGER IF NOT EXISTS purkins_block_delete_product_with_hold
BEFORE DELETE ON products
WHEN EXISTS (
  SELECT 1 FROM purkins_order_request_allocations a, json_each(a.lines_json) item
  WHERE a.status='held' AND json_extract(item.value,'$.product_id')=OLD.id
)
BEGIN
  SELECT RAISE(ABORT,'Release allocated stock before deleting product');
END;

CREATE TRIGGER IF NOT EXISTS purkins_block_delete_variant_with_hold
BEFORE DELETE ON product_variants
WHEN EXISTS (
  SELECT 1 FROM purkins_order_request_allocations a, json_each(a.lines_json) item
  WHERE a.status='held' AND json_extract(item.value,'$.variant_id')=OLD.id
)
BEGIN
  SELECT RAISE(ABORT,'Release allocated stock before deleting variant');
END;
