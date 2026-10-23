-- Purkins PRIVATE physical location tree and stable item placement identifiers.
-- Do not expose either table/column in shopper-facing queries.
-- Existing free-text paths become standalone root locations; never guess the
-- meaning of '/' in old paths. Operators can organize those nodes later.
CREATE TABLE IF NOT EXISTS purkins_locations (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  kind TEXT NOT NULL DEFAULT 'other'
    CHECK (kind IN ('site', 'room', 'shelf', 'sack', 'bag', 'bin', 'other')),
  parent_id TEXT REFERENCES purkins_locations(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (id <> parent_id)
);

-- SQLite UNIQUE(parent_id,name) permits duplicate roots because NULL != NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_purkins_locations_siblings
  ON purkins_locations(COALESCE(parent_id, ''), name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_purkins_locations_parent
  ON purkins_locations(parent_id);

-- Defence-in-depth: a direct SQL writer cannot create an ancestry cycle.
CREATE TRIGGER IF NOT EXISTS purkins_locations_no_cycle
BEFORE UPDATE OF parent_id ON purkins_locations
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Location cannot be placed inside itself or a descendant')
   WHERE EXISTS (
     WITH RECURSIVE descendants(id) AS (
       SELECT id FROM purkins_locations WHERE id = NEW.id
       UNION
       SELECT c.id FROM purkins_locations c JOIN descendants d ON c.parent_id = d.id
     )
     SELECT 1 FROM descendants WHERE id = NEW.parent_id
   );
END;

ALTER TABLE purkins_intake
  ADD COLUMN location_id TEXT REFERENCES purkins_locations(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_purkins_intake_location_id ON purkins_intake(location_id);

INSERT INTO purkins_locations (id, name, kind, parent_id)
SELECT 'loc_' || lower(hex(randomblob(12))), trim(storage_location), 'other', NULL
FROM purkins_intake
WHERE storage_location IS NOT NULL AND trim(storage_location) <> ''
GROUP BY trim(storage_location) COLLATE NOCASE;

UPDATE purkins_intake
SET location_id = (
  SELECT loc.id FROM purkins_locations loc
  WHERE loc.parent_id IS NULL AND loc.name = trim(purkins_intake.storage_location) COLLATE NOCASE
  LIMIT 1
)
WHERE storage_location IS NOT NULL AND trim(storage_location) <> '';
