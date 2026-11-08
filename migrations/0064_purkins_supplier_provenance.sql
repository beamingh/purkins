-- Original supplier labels stay private and are never assumed from selling names.
-- Existing stock is NULL until the operator supplies authentic source details.
ALTER TABLE purkins_intake ADD COLUMN original_supplier_name TEXT
  CHECK (original_supplier_name IS NULL OR length(original_supplier_name) <= 200);
ALTER TABLE purkins_intake ADD COLUMN supplier_reference TEXT
  CHECK (supplier_reference IS NULL OR length(supplier_reference) <= 250);
