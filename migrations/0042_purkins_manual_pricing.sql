-- Explicit pricing strategy for Purkins intake.
-- Existing records keep their cost-recovery approval policy by default.
-- 'manual' means the owner selected a selling price without requiring
-- purchase cost, foreign exchange rate, overhead or markup.
ALTER TABLE purkins_intake
  ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'cost_based'
  CHECK (pricing_mode IN ('cost_based', 'manual'));
