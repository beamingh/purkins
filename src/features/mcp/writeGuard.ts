import type { D1Database } from '@cloudflare/workers-types';
import {
  getLocation, listLocationTree, locationIdValid, locationKind,
  locationName, type StockLocation,
} from '../purkins/locations';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MutationAction = 'location.create' | 'location.move';
type Receipt = {
  request_id: string;
  actor: string;
  action: MutationAction;
  payload_sha256: string;
  nonce: string;
  target_id: string;
  outcome: 'pending' | 'applied' | 'rejected';
};

export type GuardedLocationResult =
  | { ok: true; id: string; version: number; replayed: boolean }
  | { ok: false; error: string; conflict: boolean };

/** A stable, non-credential actor label; never accept identity from MCP tool args. */
function ownerActor(actor: string): string {
  if (!actor || actor.length > 254 ||
      !(actor === 'owner:bearer' || /^owner:access:[^\s@]+@[^\s@]+$/.test(actor))) {
    throw new Error('Authenticated owner identity is required for guarded writes.');
  }
  return actor;
}

function requestId(raw: string): string {
  if (!UUID_V4.test(raw)) throw new Error('A new UUIDv4 request_id is required.');
  return raw.toLowerCase();
}

async function payloadHash(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function receipt(db: D1Database, key: string): Promise<Receipt | null> {
  return db.prepare(
    'SELECT request_id, actor, action, payload_sha256, nonce, target_id, outcome ' +
    'FROM purkins_mcp_mutations WHERE request_id = ?',
  ).bind(key).first<Receipt>();
}

async function replay(
  db: D1Database, key: string, actor: string, action: MutationAction, hash: string,
): Promise<GuardedLocationResult | null> {
  const prior = await receipt(db, key);
  if (!prior) return null;
  if (prior.actor !== actor || prior.action !== action || prior.payload_sha256 !== hash) {
    return { ok: false, conflict: true, error: 'This request_id was already used for a different operation.' };
  }
  if (prior.outcome === 'applied') {
    const loc = await getLocation(db, prior.target_id);
    // A receipt proves the write happened. Current location may have moved later.
    return { ok: true, id: prior.target_id, version: loc?.mcp_version ?? 0, replayed: true };
  }
  return { ok: false, conflict: true, error: 'This request was previously rejected; retry with a new request_id after refreshing.' };
}

function guardInsert(db: D1Database, r: Receipt) {
  return db.prepare(
    'INSERT INTO purkins_mcp_mutations (request_id, actor, action, payload_sha256, nonce, target_id) ' +
    'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(request_id) DO NOTHING RETURNING request_id',
  ).bind(r.request_id, r.actor, r.action, r.payload_sha256, r.nonce, r.target_id);
}

/** Each outcome is settled in the SAME D1 transaction as the attempted write. */
function guardOutcome(db: D1Database, r: Receipt) {
  return db.prepare(
    "UPDATE purkins_mcp_mutations SET outcome = CASE WHEN EXISTS (" +
    'SELECT 1 FROM purkins_locations WHERE id = ? AND last_mcp_request = ?' +
    ") THEN 'applied' ELSE 'rejected' END WHERE request_id = ? AND nonce = ?",
  ).bind(r.target_id, r.nonce, r.request_id, r.nonce);
}

function safeFailure(error: unknown): GuardedLocationResult {
  const message = String(error);
  if (/UNIQUE|constraint/i.test(message)) {
    return { ok: false, conflict: true, error: 'The location changed or a sibling name already exists. Refresh before retrying.' };
  }
  // Infrastructure failures are not validation errors, and must not be
  // described as a successful write. Let the caller report/observe them.
  throw error;
}

/**
 * Atomic create with a durable response receipt. A request reused with a
 * different payload/actor is denied; two concurrent requests cannot create
 * two physical locations, even when the client times out and retries.
 */
export async function createGuardedLocation(
  db: D1Database, actorInput: string, input: {
    request_id: string; name: string; kind: string; parent_id: string | null;
  },
): Promise<GuardedLocationResult> {
  const actor = ownerActor(actorInput);
  const key = requestId(input.request_id);
  const name = locationName(input.name);
  const kind = locationKind(input.kind);
  const parent = input.parent_id;
  if (parent !== null && !locationIdValid(parent)) throw new Error('Invalid loc_ parent.');
  const hash = await payloadHash({ action: 'location.create', name, kind, parent });
  const existing = await replay(db, key, actor, 'location.create', hash);
  if (existing) return existing;
  if (parent && !(await getLocation(db, parent))) {
    return { ok: false, conflict: true, error: 'Parent location was not found.' };
  }
  const id = 'loc_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24);
  const r: Receipt = {
    request_id: key, actor, action: 'location.create',
    payload_sha256: hash, nonce: crypto.randomUUID(),
    target_id: id, outcome: 'pending',
  };
  try {
    const result = await db.batch([
      guardInsert(db, r),
      db.prepare(
        'INSERT INTO purkins_locations (id, name, kind, parent_id, last_mcp_request) ' +
        'SELECT ?, ?, ?, ?, ? WHERE EXISTS (' +
        'SELECT 1 FROM purkins_mcp_mutations WHERE request_id = ? AND nonce = ?) RETURNING id',
      ).bind(id, name, kind, parent, r.nonce, key, r.nonce),
      guardOutcome(db, r),
    ]);
    if (result[1]?.results?.length) return { ok: true, id, version: 0, replayed: false };
    const concurrent = await replay(db, key, actor, 'location.create', hash);
    if (concurrent) return concurrent;
    return { ok: false, conflict: true, error: 'The location could not be created; refresh and retry.' };
  } catch (error) {
    return safeFailure(error);
  }
}

/**
 * Compare-and-swap on the location's current parent AND MCP revision.
 * The database's existing cycle trigger and sibling unique index remain
 * authoritative. Clients must read the current version before each move.
 */
export async function moveGuardedLocation(
  db: D1Database, actorInput: string, input: {
    request_id: string; id: string; parent_id: string | null;
    expected_parent_id: string | null; expected_version: number;
  },
): Promise<GuardedLocationResult> {
  const actor = ownerActor(actorInput);
  const key = requestId(input.request_id);
  if (!locationIdValid(input.id) ||
      (input.parent_id !== null && !locationIdValid(input.parent_id)) ||
      (input.expected_parent_id !== null && !locationIdValid(input.expected_parent_id)) ||
      !Number.isSafeInteger(input.expected_version) || input.expected_version < 0) {
    throw new Error('Invalid location identity or expected revision.');
  }
  const hash = await payloadHash({
    action: 'location.move', id: input.id, parent: input.parent_id,
    expectedParent: input.expected_parent_id, expectedVersion: input.expected_version,
  });
  const existing = await replay(db, key, actor, 'location.move', hash);
  if (existing) return existing;
  const tree = await listLocationTree(db);
  const current = tree.find(loc => loc.id === input.id);
  if (!current) return { ok: false, conflict: true, error: 'Location not found.' };
  if (current.parent_id !== input.expected_parent_id ||
      current.mcp_version !== input.expected_version) {
    return { ok: false, conflict: true, error: 'Location changed. Refresh the hierarchy and retry with a new request_id.' };
  }
  if (input.parent_id === input.id) return { ok: false, conflict: true, error: 'Cannot move a location into itself.' };
  let ancestor = tree.find(loc => loc.id === input.parent_id);
  if (input.parent_id && !ancestor) return { ok: false, conflict: true, error: 'New parent not found.' };
  while (ancestor) {
    if (ancestor.id === input.id) return { ok: false, conflict: true, error: 'Cannot move a location inside a descendant.' };
    ancestor = tree.find(loc => loc.id === ancestor!.parent_id);
  }
  const r: Receipt = {
    request_id: key, actor, action: 'location.move',
    payload_sha256: hash, nonce: crypto.randomUUID(),
    target_id: input.id, outcome: 'pending',
  };
  try {
    const result = await db.batch([
      guardInsert(db, r),
      db.prepare(
        'UPDATE purkins_locations SET parent_id = ?, mcp_version = mcp_version + 1, ' +
        'last_mcp_request = ? WHERE id = ? AND mcp_version = ? ' +
        "AND COALESCE(parent_id, '') = COALESCE(?, '') " +
        'AND EXISTS (SELECT 1 FROM purkins_mcp_mutations WHERE request_id = ? AND nonce = ?) ' +
        'RETURNING id, mcp_version',
      ).bind(input.parent_id, r.nonce, input.id, input.expected_version,
        input.expected_parent_id, key, r.nonce),
      guardOutcome(db, r),
    ]);
    const row = result[1]?.results?.[0] as { id?: string; mcp_version?: number } | undefined;
    if (row?.id === input.id) {
      return { ok: true, id: input.id, version: row.mcp_version ?? input.expected_version + 1, replayed: false };
    }
    const concurrent = await replay(db, key, actor, 'location.move', hash);
    if (concurrent) return concurrent;
    return { ok: false, conflict: true, error: 'Stale location version. Refresh and retry with a new request_id.' };
  } catch (error) {
    return safeFailure(error);
  }
}
