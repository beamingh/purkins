import type { D1Database } from '@cloudflare/workers-types';

export const LOCATION_KINDS = ['site', 'room', 'shelf', 'sack', 'bag', 'bin', 'other'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export interface StockLocation {
  id: string;
  name: string;
  kind: LocationKind;
  parent_id: string | null;
  mcp_version: number;
}
export interface LocationOption extends StockLocation {
  path: string;
  depth: number;
}

/** Stable location reference. Names and ancestry are changeable, IDs never are. */
export function locationIdValid(value: string): boolean {
  return /^loc_[0-9a-f]{24}$/.test(value);
}

export function locationName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 100 || name.includes('/')) {
    throw new Error('Location name must be 1–100 characters and cannot contain a slash.');
  }
  return name;
}

export function locationKind(raw: string): LocationKind {
  if (!LOCATION_KINDS.includes(raw as LocationKind)) throw new Error('Invalid location type.');
  return raw as LocationKind;
}

export async function getLocation(db: D1Database, id: string): Promise<StockLocation | null> {
  if (!locationIdValid(id)) return null;
  return db.prepare('SELECT id, name, kind, parent_id, mcp_version FROM purkins_locations WHERE id=?')
    .bind(id).first<StockLocation>();
}

/**
 * A bounded private tree, sorted by full path. Hierarchy is computed from
 * immutable IDs, never by splitting display paths.
 */
export async function listLocationTree(db: D1Database): Promise<LocationOption[]> {
  const { results } = await db.prepare(
    'SELECT id, name, kind, parent_id, mcp_version FROM purkins_locations ORDER BY name COLLATE NOCASE LIMIT 2001',
  ).all<StockLocation>();
  const rows = results ?? [];
  if (rows.length > 2000) throw new Error('Too many storage locations; use pagination.');
  const byId = new Map(rows.map((node) => [node.id, node]));
  const cache = new Map<string, LocationOption>();
  const visit = (id: string, visited: Set<string>): LocationOption => {
    const cached = cache.get(id);
    if (cached) return cached;
    const loc = byId.get(id);
    if (!loc || visited.has(id) || visited.size >= 32) {
      throw new Error('Broken or excessively deep storage hierarchy.');
    }
    let path = loc.name;
    let depth = 0;
    if (loc.parent_id) {
      const parent = visit(loc.parent_id, new Set([...visited, id]));
      path = parent.path + ' / ' + loc.name;
      depth = parent.depth + 1;
    }
    const option = { ...loc, path, depth };
    cache.set(id, option);
    return option;
  };
  return rows.map((r) => visit(r.id, new Set())).sort((a, b) => a.path.localeCompare(b.path));
}

/** Create a root or child. Root/sibling names are unique case-insensitively. */
export async function createLocation(
  db: D1Database,
  nameInput: string,
  kindInput: string,
  parentId: string | null,
): Promise<string> {
  const name = locationName(nameInput);
  const kind = locationKind(kindInput);
  if (parentId && !(await getLocation(db, parentId))) {
    throw new Error('Parent location no longer exists.');
  }
  const existing = await db.prepare(
    'SELECT id FROM purkins_locations WHERE COALESCE(parent_id,\'\') = COALESCE(?,\'\') AND name = ? COLLATE NOCASE',
  ).bind(parentId, name).first<{id: string}>();
  if (existing) throw new Error('A location with this name already exists inside that parent.');
  const id = 'loc_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24);
  try {
    await db.prepare(
      'INSERT INTO purkins_locations (id, name, kind, parent_id) VALUES (?, ?, ?, ?)',
    ).bind(id, name, kind, parentId).run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new Error('A location with this name already exists inside that parent.');
    throw error;
  }
  return id;
}

/** Move an entire container with no changes to descendant or item IDs. */
export async function moveLocation(
  db: D1Database,
  id: string,
  parentId: string | null,
): Promise<void> {
  const tree = await listLocationTree(db);
  const target = tree.find((node) => node.id === id);
  if (!target) throw new Error('Location not found.');
  if (parentId === id) throw new Error('Cannot move a location inside itself.');
  if (parentId) {
    const parent = tree.find((node) => node.id === parentId);
    if (!parent) throw new Error('New parent location not found.');
    let cursor: LocationOption | undefined = parent;
    while (cursor) {
      if (cursor.id === id) throw new Error('Cannot move a location inside its descendant.');
      cursor = cursor.parent_id ? tree.find((node) => node.id === cursor!.parent_id) : undefined;
    }
  }
  // SQLite sibling uniqueness and the cycle trigger defend against races/other writers.
  try {
    await db.prepare('UPDATE purkins_locations SET parent_id=?, mcp_version=mcp_version+1 WHERE id=?')
      .bind(parentId, id).run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new Error('The destination already contains that location name.');
    throw error;
  }
}

/** Resolve new/admin choice without trusting a free-text path as a stable key. */
export async function locationFromForm(db: D1Database, form: FormData): Promise<string | null> {
  const newName = String(form.get('storage_location_new') ?? '').trim();
  if (newName) {
    const parent = String(form.get('storage_location_parent_id') ?? '').trim() || null;
    const kind = String(form.get('storage_location_kind') ?? 'other');
    return createLocation(db, newName, kind, parent);
  }
  const id = String(form.get('location_id') ?? '').trim();
  if (!id) return null;
  if (!(await getLocation(db, id))) throw new Error('Selected storage location does not exist.');
  return id;
}

/** Attach a product to a stable location, storing a legacy snapshot as fallback.
 * The Admin and operator read helpers always derive the CURRENT full path. */
export async function assignIntakeLocation(db: D1Database, productId: number, locationId: string | null): Promise<void> {
  const tree = await listLocationTree(db);
  const current = locationId ? tree.find((l) => l.id === locationId) : null;
  if (locationId && !current) throw new Error('Storage location not found.');
  await db.prepare(
    'UPDATE purkins_intake SET location_id=?, storage_location=? WHERE product_id=?',
  ).bind(locationId, current?.path ?? null, productId).run();
}

export async function resolveLegacyLocation(
  db: D1Database,
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  // Older MCP and Admin writes can still pass a plain string. Treat it as ONE
  // root label; never split it into invented sacks/bags.
  const name = path.trim();
  if (!name || name.length > 100) throw new Error('Storage location is too long.');
  const existing = await db.prepare(
    'SELECT id FROM purkins_locations WHERE parent_id IS NULL AND name = ? COLLATE NOCASE',
  ).bind(name).first<{id: string}>();
  if (existing) return existing.id;
  const id = 'loc_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24);
  try {
    await db.prepare(
      "INSERT INTO purkins_locations (id,name,kind,parent_id) VALUES (?,?,'other',NULL)",
    ).bind(id, name).run();
  } catch (error) {
    if (!String(error).includes('UNIQUE')) throw error;
    return (await db.prepare(
      'SELECT id FROM purkins_locations WHERE parent_id IS NULL AND name=? COLLATE NOCASE',
    ).bind(name).first<{id: string}>())?.id ?? null;
  }
  return id;
}
