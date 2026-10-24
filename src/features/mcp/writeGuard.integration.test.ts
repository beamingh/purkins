import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { splitPurkinsMigrationSql } from '../purkins/migration-test-sql';
import { createGuardedLocation, moveGuardedLocation } from './writeGuard';
import { getLocation, listLocationTree, moveLocation } from '../purkins/locations';

const actor = 'owner:access:owner@example.com';
const uuid = () => crypto.randomUUID();

describe('MCP location write guard against real isolated D1', () => {
  let mf: Miniflare;
  let db: D1Database;

  async function apply(name: string) {
    const source = readFileSync(new URL('../../../migrations/' + name, import.meta.url), 'utf8');
    for (const statement of splitPurkinsMigrationSql(source)) {
      await db.prepare(statement).run();
    }
  }

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-07-20',
      d1Databases: ['DB'],
    });
    db = await mf.getD1Database('DB');
    await db.exec('CREATE TABLE purkins_intake (product_id INTEGER PRIMARY KEY, storage_location TEXT)');
    await apply('0043_purkins_location_tree.sql');
    await apply('0045_purkins_mcp_write_guard.sql');
  });

  afterAll(async () => { await mf?.dispose(); });

  async function create(name: string, parent_id: string | null = null, request_id = uuid()) {
    return createGuardedLocation(db, actor, {request_id, name, kind: 'bag', parent_id});
  }

  it('creates one location, audits it in D1, and returns the same location on retry', async () => {
    const key = uuid();
    const first = await create('Guard Test Sack', null, key);
    expect(first).toMatchObject({ok: true, version: 0, replayed: false});
    if (!first.ok) return;
    const again = await create('Guard Test Sack', null, key);
    expect(again).toMatchObject({ok: true, id: first.id, replayed: true});
    const locations = await listLocationTree(db);
    expect(locations.filter(l => l.id === first.id)).toHaveLength(1);
    const audit = await db.prepare(
      'SELECT action, outcome, actor, target_id FROM purkins_mcp_mutations WHERE request_id = ?',
    ).bind(key).first<{action: string; outcome: string; actor: string; target_id: string}>();
    expect(audit).toEqual({
      action: 'location.create', outcome: 'applied', actor, target_id: first.id,
    });
  });

  it('rejects reused request ids with different input or actor', async () => {
    const key = uuid();
    const first = await create('Guard Test Parent', null, key);
    expect(first.ok).toBe(true);
    const changed = await create('Another Parent', null, key);
    expect(changed).toMatchObject({ok: false, conflict: true});
    const actorChanged = await createGuardedLocation(db, 'owner:bearer', {
      request_id: key, name: 'Guard Test Parent', kind: 'bag', parent_id: null,
    });
    expect(actorChanged).toMatchObject({ok: false, conflict: true});
  });

  it('requires the parent and revision expected by the reader; replay is harmless', async () => {
    const first = await create('Guard Move A');
    const second = await create('Guard Move B');
    if (!first.ok || !second.ok) throw Error('Fixture location create failed');
    const key = uuid();
    const input = {
      request_id: key, id: first.id, parent_id: second.id,
      expected_parent_id: null, expected_version: 0,
    };
    const moved = await moveGuardedLocation(db, actor, input);
    expect(moved).toMatchObject({ok:true, version:1, replayed:false});
    const replayed = await moveGuardedLocation(db, actor, input);
    expect(replayed).toMatchObject({ok:true, id:first.id, replayed:true});
    expect((await getLocation(db, first.id))?.mcp_version).toBe(1);
    const stale = await moveGuardedLocation(db, actor, {...input, request_id: uuid()});
    expect(stale).toMatchObject({ok:false, conflict:true});
    expect((await getLocation(db, first.id))?.parent_id).toBe(second.id);
    const back = await moveGuardedLocation(db, actor, {
      request_id: uuid(), id:first.id, parent_id:null,
      expected_parent_id:second.id, expected_version:1,
    });
    expect(back).toMatchObject({ok:true, version:2});
  });

  it('rejects hierarchy cycles and keeps the existing ancestry unchanged', async () => {
    const parent = await create('Guard Cycle Root');
    if (!parent.ok) throw Error('Fixture location create failed');
    const child = await create('Guard Cycle Child', parent.id);
    if (!child.ok) throw Error('Fixture location create failed');
    const cycle = await moveGuardedLocation(db, actor, {
      request_id: uuid(), id:parent.id, parent_id:child.id,
      expected_parent_id:null, expected_version:0,
    });
    expect(cycle).toMatchObject({ok:false, conflict:true});
    expect((await getLocation(db, parent.id))?.parent_id).toBe(null);
  });

  it('uses the unique sibling constraint and rolls back failed audit inserts', async () => {
    const first = await create('Guard Duplicate Name');
    expect(first.ok).toBe(true);
    const secondKey = uuid();
    const second = await create('Guard Duplicate Name', null, secondKey);
    expect(second).toMatchObject({ok:false, conflict:true});
    const receipt = await db.prepare(
      'SELECT request_id FROM purkins_mcp_mutations WHERE request_id = ?',
    ).bind(secondKey).first();
    expect(receipt).toBeNull(); // D1.batch rolled back the audit and duplicate INSERT together.
  });

  it('increments location revision on ordinary Admin moves too', async () => {
    const root = await create('Guard Admin Edit');
    const parent = await create('Guard Admin Parent');
    if (!root.ok || !parent.ok) throw Error('Fixture location create failed');
    await moveLocation(db, root.id, parent.id); // unchanged shared Admin domain function
    expect((await getLocation(db, root.id))?.mcp_version).toBe(1);
    const stale = await moveGuardedLocation(db, actor, {
      request_id: uuid(), id:root.id, parent_id:null,
      expected_parent_id:null, expected_version:0,
    });
    expect(stale).toMatchObject({ok:false, conflict:true});
  });
});
