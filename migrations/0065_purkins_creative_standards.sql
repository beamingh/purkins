-- Private owner-managed creative policy documents. One rule per (domain,scope,target).
-- References store public med_ IDs in JSON and are checked on every write.
CREATE TABLE IF NOT EXISTS purkins_creative_standards (
  domain TEXT NOT NULL CHECK(domain IN ('photography','naming','descriptions','social')),
  scope TEXT NOT NULL CHECK(scope IN ('global','preset','category','product')),
  target_id TEXT NOT NULL DEFAULT '' CHECK(length(target_id) <= 120),
  rules_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(rules_json) AND json_type(rules_json)='object'),
  reference_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(reference_ids) AND json_type(reference_ids)='array'),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  updated_by TEXT NOT NULL CHECK(length(updated_by) BETWEEN 1 AND 254),
  last_request_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(domain,scope,target_id),
  CHECK((scope='global' AND target_id='') OR (scope<>'global' AND target_id<>''))
);
CREATE TABLE IF NOT EXISTS purkins_creative_versions (
  domain TEXT NOT NULL,
  scope TEXT NOT NULL,
  target_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  rules_json TEXT NOT NULL,
  reference_ids TEXT NOT NULL,
  active INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(domain,scope,target_id,revision)
);
CREATE TRIGGER IF NOT EXISTS purkins_creative_version_insert AFTER INSERT ON purkins_creative_standards
BEGIN
  INSERT INTO purkins_creative_versions
    (domain,scope,target_id,revision,rules_json,reference_ids,active,updated_by)
  VALUES (new.domain,new.scope,new.target_id,new.revision,new.rules_json,new.reference_ids,new.active,new.updated_by);
END;
CREATE TRIGGER IF NOT EXISTS purkins_creative_version_update AFTER UPDATE ON purkins_creative_standards
BEGIN
  INSERT INTO purkins_creative_versions
    (domain,scope,target_id,revision,rules_json,reference_ids,active,updated_by)
  VALUES (new.domain,new.scope,new.target_id,new.revision,new.rules_json,new.reference_ids,new.active,new.updated_by);
END;
CREATE TABLE IF NOT EXISTS purkins_creative_write_receipts (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  domain TEXT NOT NULL,
  scope TEXT NOT NULL,
  target_id TEXT NOT NULL,
  saved_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO purkins_creative_standards
  (domain,scope,target_id,rules_json,reference_ids,active,updated_by)
VALUES
('photography','global','',
 '{"aspect_ratio":"4:5","target_width":1080,"target_height":1350,"background":"White studio","composite_allowed":true,"preferred_preset":"studio-product","instructions":"Use 4:5 portrait photographs. Show the true product, colours, labels and physical features accurately. Keep the complete item in frame. Use well-lit, clean commercial photography, no invented controls, logos or specifications. Composite primary photos are allowed when useful and truthful.","required_shots":["Primary full product","Detail or features","In-use or scale when appropriate"]}',
 '[]',1,'system:seed'),
('photography','preset','studio-product',
 '{"title":"Studio Product","background":"Clean white studio","instructions":"Isolated or naturally grounded product, soft directional light, minimal shadows, accurate scale and no clutter."}',
 '[]',1,'system:seed'),
('photography','preset','feature-composite',
 '{"title":"Feature Composite","background":"Clean neutral studio","composite_allowed":true,"instructions":"Combine authentic views or features into one balanced 4:5 image. Do not suggest any item or accessory is included unless verified."}',
 '[]',1,'system:seed'),
('photography','preset','purkins-kitchen',
 '{"title":"Purkins Kitchen","background":"Approved Purkins kitchen","instructions":"Use the approved kitchen reference from the media library. High-gloss white handleless cabinets, solid white upper wall, black-framed sink window with pale grey roller blind, white subway tiles and quartz-style surfaces. No switches or invented signage."}',
 '[]',1,'system:seed'),
('photography','preset','lifestyle',
 '{"title":"Lifestyle","background":"Authentic everyday home or travel setting","instructions":"Show realistic use with suitable scale and believable interaction. Do not invent manufacturer functions, fittings or included accessories."}',
 '[]',1,'system:seed');
