-- Owner-managed, reusable rules registry. One authoritative store for all Purkins rule categories.
-- This draft migration replaces the earlier creative-only 0065 proposal before production rollout.
CREATE TABLE IF NOT EXISTS purkins_rule_categories (
  slug TEXT PRIMARY KEY NOT NULL CHECK(length(slug) BETWEEN 2 AND 60),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 100),
  group_name TEXT NOT NULL DEFAULT 'Custom' CHECK(length(group_name) BETWEEN 2 AND 100),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 600),
  builtin INTEGER NOT NULL DEFAULT 0 CHECK(builtin IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  position INTEGER NOT NULL DEFAULT 999,
  last_request_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
  updated_by TEXT NOT NULL DEFAULT 'system:seed' CHECK(length(updated_by) BETWEEN 1 AND 254),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purkins_rule_category_name ON purkins_rule_categories(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_purkins_rule_category_group ON purkins_rule_categories(group_name,position,name);
CREATE TABLE IF NOT EXISTS purkins_rule_category_versions (
  slug TEXT NOT NULL,
  revision INTEGER NOT NULL,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL,
  description TEXT NOT NULL,
  active INTEGER NOT NULL,
  builtin INTEGER NOT NULL,
  position INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(slug,revision)
);
CREATE TRIGGER IF NOT EXISTS purkins_rule_category_version_insert AFTER INSERT ON purkins_rule_categories
BEGIN
  INSERT INTO purkins_rule_category_versions
    (slug,revision,name,group_name,description,active,builtin,position,updated_by)
  VALUES(new.slug,new.revision,new.name,new.group_name,new.description,new.active,new.builtin,new.position,new.updated_by);
END;
CREATE TRIGGER IF NOT EXISTS purkins_rule_category_version_update AFTER UPDATE ON purkins_rule_categories
BEGIN
  INSERT INTO purkins_rule_category_versions
    (slug,revision,name,group_name,description,active,builtin,position,updated_by)
  VALUES(new.slug,new.revision,new.name,new.group_name,new.description,new.active,new.builtin,new.position,new.updated_by);
END;

-- rule_slug identifies a rule across global/preset/product-category/product override layers.
-- A category can contain many rules, and newly created categories require no schema update.
CREATE TABLE IF NOT EXISTS purkins_rules (
  category_slug TEXT NOT NULL,
  rule_slug TEXT NOT NULL CHECK(length(rule_slug) BETWEEN 2 AND 60),
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
  PRIMARY KEY(category_slug,rule_slug,scope,target_id),
  CHECK((scope='global' AND target_id='') OR (scope<>'global' AND target_id<>''))
);
CREATE INDEX IF NOT EXISTS idx_purkins_rules_lookup ON purkins_rules(category_slug,rule_slug,active);
CREATE TABLE IF NOT EXISTS purkins_rule_versions (
  category_slug TEXT NOT NULL,
  rule_slug TEXT NOT NULL,
  scope TEXT NOT NULL,
  target_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  rules_json TEXT NOT NULL,
  reference_ids TEXT NOT NULL,
  active INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(category_slug,rule_slug,scope,target_id,revision)
);
CREATE TRIGGER IF NOT EXISTS purkins_rule_version_insert AFTER INSERT ON purkins_rules
BEGIN
  INSERT INTO purkins_rule_versions
    (category_slug,rule_slug,scope,target_id,revision,rules_json,reference_ids,active,updated_by)
  VALUES (new.category_slug,new.rule_slug,new.scope,new.target_id,new.revision,new.rules_json,new.reference_ids,new.active,new.updated_by);
END;
CREATE TRIGGER IF NOT EXISTS purkins_rule_version_update AFTER UPDATE ON purkins_rules
BEGIN
  INSERT INTO purkins_rule_versions
    (category_slug,rule_slug,scope,target_id,revision,rules_json,reference_ids,active,updated_by)
  VALUES (new.category_slug,new.rule_slug,new.scope,new.target_id,new.revision,new.rules_json,new.reference_ids,new.active,new.updated_by);
END;
CREATE TABLE IF NOT EXISTS purkins_rule_write_receipts (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  category_slug TEXT NOT NULL,
  rule_slug TEXT NOT NULL,
  scope TEXT NOT NULL,
  target_id TEXT NOT NULL,
  saved_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS purkins_rule_category_receipts (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  category_slug TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS purkins_rule_category_update_receipts (
  request_id TEXT PRIMARY KEY NOT NULL,
  actor TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  category_slug TEXT NOT NULL,
  saved_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO purkins_rule_categories
  (slug,name,group_name,description,builtin,active,position)
VALUES
('photography','Product Photography','Creative & Branding','Image ratios, lighting, accurate product views and references',1,1,1),
('branding','Brand Identity','Creative & Branding','Logos, typography, colours and visual identity',1,1,2),
('product-naming','Product Naming','Product Management','Product titles, variants and naming conventions',1,1,3),
('product-descriptions','Product Descriptions','Product Management','Specification accuracy and description format',1,1,4),
('product-listings','Product Listings','Product Management','Required product fields, merchandising and publishing checks',1,1,5),
('pricing','Pricing Guidelines','Pricing & Sales','Markup, rounding and value positioning guidance',1,1,6),
('discounts','Discount Guidelines','Pricing & Sales','Promotions, compare-at prices and approval guidance',1,1,7),
('stock-intake','Inventory Intake','Inventory & Operations','Stock intake and condition standards',1,1,8),
('restocking','Restocking','Inventory & Operations','Replenishment planning and sourcing guidelines',1,1,9),
('social-posts','Social Posts','Marketing','Facebook and other social media copy rules',1,1,10),
('promotions','Promotions','Marketing','Campaigns, launches and advertising language',1,1,11),
('customer-service','Customer Service','Customer Experience','Replies, complaints and service tone',1,1,12),
('returns','Returns & Exchanges','Customer Experience','Returns and exchange policy guidance',1,1,13),
('pickup-delivery','Pickup & Delivery','Fulfilment','Delivery messaging and pickup process',1,1,14),
('packaging','Packaging','Fulfilment','Parcel presentation and shipment preparation',1,1,15),
('ai-automation','AI & Automation','Technology & Automation','Assistant instructions and operating policies',1,1,16);

INSERT OR IGNORE INTO purkins_rules
  (category_slug,rule_slug,scope,target_id,rules_json,reference_ids,active,updated_by)
VALUES
('photography','product-photography','global','','{"title":"Product Photography","kind":"guidance","aspect_ratio":"4:5","target_width":1080,"target_height":1350,"background":"White studio","composite_allowed":true,"preferred_preset":"studio-product","instructions":"Create accurate 4:5 portraits of the real item. Preserve colours, labels, controls and accessories. Keep the product fully visible and use clean commercial lighting. Never invent details or specifications.","required_shots":["Main product photo","Features or details","Realistic use where appropriate"]}','[]',1,"system:seed"),
('photography','product-photography','preset','studio-product','{"title":"Studio Product","background":"Clean white studio","instructions":"Isolate the product with natural contact shadows and soft directional light, with no unnecessary objects."}','[]',1,"system:seed"),
('photography','product-photography','preset','feature-composite','{"title":"Feature Composite","background":"Clean neutral studio","composite_allowed":true,"instructions":"Combine verified details and authentic product views in one balanced 4:5 image. Never imply an unverified accessory is included."}','[]',1,"system:seed"),
('photography','product-photography','preset','purkins-kitchen','{"title":"Purkins Kitchen","background":"Approved Purkins kitchen","instructions":"Use the approved kitchen reference: glossy white handleless cabinets, plain upper wall, black-framed sink window with pale grey roller blind, white subway backsplash and white quartz counters."}','[]',1,"system:seed"),
('photography','product-photography','preset','lifestyle','{"title":"Lifestyle","background":"Believable home or travel scene","instructions":"Demonstrate realistic use and scale without inventing functions, settings, attachments or branding."}','[]',1,"system:seed");
