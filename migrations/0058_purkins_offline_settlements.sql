-- A one-to-one settlement receipt for an already-held offline customer request.
-- This is operator-attested money received, NOT provider API verification.
-- Canonical paid order and receipt commit in the same D1 transaction.
CREATE TABLE IF NOT EXISTS purkins_offline_settlements (
  request_id INTEGER PRIMARY KEY REFERENCES purkins_order_requests(id) ON DELETE RESTRICT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  confirmation_nonce TEXT NOT NULL UNIQUE,
  quote_revision INTEGER NOT NULL CHECK(quote_revision > 0),
  tender TEXT NOT NULL CHECK(tender IN
    ('cash','airtel_money','mtn_momo','zamtel_money','bank_transfer','other')),
  payment_reference TEXT,
  amount_received_cents INTEGER NOT NULL CHECK(amount_received_cents > 0),
  currency TEXT NOT NULL DEFAULT 'zmw' CHECK(currency='zmw'),
  fulfillment_status TEXT NOT NULL CHECK(fulfillment_status IN ('fulfilled','unfulfilled')),
  confirmation_note TEXT NOT NULL CHECK(length(confirmation_note) BETWEEN 8 AND 1000),
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((tender='cash' AND payment_reference IS NULL) OR
    (tender<>'cash' AND payment_reference IS NOT NULL AND length(payment_reference) BETWEEN 5 AND 120))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purkins_offline_payment_reference
  ON purkins_offline_settlements(tender,payment_reference)
  WHERE payment_reference IS NOT NULL;

-- Disallow allocating stock back to the catalog after it has been sold.
CREATE TRIGGER IF NOT EXISTS purkins_block_release_paid_allocation
BEFORE UPDATE OF status ON purkins_order_request_allocations
WHEN NEW.status='released' AND EXISTS (
  SELECT 1 FROM purkins_offline_settlements s WHERE s.request_id=OLD.request_id
)
BEGIN
  SELECT RAISE(ABORT,'Paid stock cannot be released as unsold');
END;

CREATE TRIGGER IF NOT EXISTS purkins_block_cancel_paid_request
BEFORE UPDATE OF status ON purkins_order_requests
WHEN EXISTS (
  SELECT 1 FROM purkins_offline_settlements s WHERE s.request_id=OLD.id
)
BEGIN
  SELECT RAISE(ABORT,'Paid request cannot be changed');
END;

-- The payment receipt is immutable. Refunds belong to the order refund ledger,
-- not a deletion or reversal of this historical money-received assertion.
CREATE TRIGGER IF NOT EXISTS purkins_block_modify_offline_settlement
BEFORE UPDATE ON purkins_offline_settlements
BEGIN
  SELECT RAISE(ABORT,'Offline settlement receipt is immutable');
END;
CREATE TRIGGER IF NOT EXISTS purkins_block_delete_offline_settlement
BEFORE DELETE ON purkins_offline_settlements
BEGIN
  SELECT RAISE(ABORT,'Offline settlement receipt is immutable');
END;

-- Defense in depth against an unlinked or mismatched paid receipt.
CREATE TRIGGER IF NOT EXISTS purkins_guard_offline_settlement
BEFORE INSERT ON purkins_offline_settlements
WHEN NOT EXISTS (
  SELECT 1
  FROM purkins_order_request_allocations a
  JOIN purkins_order_request_quotes q ON q.request_id=a.request_id
  JOIN purkins_order_requests r ON r.id=a.request_id
  JOIN orders o ON o.id=NEW.order_id
  WHERE a.request_id=NEW.request_id AND a.status='held'
    AND a.quote_revision=NEW.quote_revision AND q.revision=a.quote_revision
    AND q.total_cents=NEW.amount_received_cents
    AND o.amount_total_cents=NEW.amount_received_cents AND o.status='paid'
    AND lower(o.currency)='zmw' AND lower(r.currency)='zmw'
    AND o.provider_session_id='offline-req:'||r.public_id
)
BEGIN
  SELECT RAISE(ABORT,'Offline settlement does not match held quote and paid order');
END;
