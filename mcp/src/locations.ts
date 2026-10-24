import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { D1Database } from '@cloudflare/workers-types';
import {
  getLocation, listLocationTree, locationIdValid, LOCATION_KINDS,
} from '../../src/features/purkins/locations';
import {
  createGuardedLocation, moveGuardedLocation,
} from '../../src/features/mcp/writeGuard';

const requestKey = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  'Provide a new UUIDv4 request_id; reuse it only to retry the same request.',
);
const locId = z.string().refine(locationIdValid, 'Invalid loc_ reference.');
const reply = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
});

/**
 * Private stock-location tools. The owner tier is checked before registration.
 * Mutators require BOTH explicit write gates, an authenticated actor, and a
 * unique request id. All writes go through atomic D1 receipts and revision
 * checks; a general write switch alone never enables them.
 */
export function registerLocationTools(
  server: McpServer, db: D1Database, allowWrites = false, actor?: string,
): void {
  server.registerTool('list_purkins_locations', {
    description: 'Owner-only private storage hierarchy with stable loc_ IDs, full paths and mcp_version for safe writes.',
    inputSchema: {},
  }, async () => reply({ locations: await listLocationTree(db) }));

  server.registerTool('get_purkins_location', {
    description: 'Owner-only details for a location, including mcp_version and its parent ID.',
    inputSchema: { id: locId },
  }, async ({ id }) => reply({ location: await getLocation(db, id) }));

  if (!allowWrites || !actor) return;

  server.registerTool('create_purkins_location', {
    description: 'Create one private storage container. Requires a fresh UUIDv4 request_id; retry with the SAME ID to avoid duplication. Never publishes a product.',
    inputSchema: {
      request_id: requestKey,
      name: z.string().trim().min(1).max(100),
      kind: z.enum(LOCATION_KINDS),
      parent_id: locId.nullable().default(null),
    },
  }, async ({ request_id, name, kind, parent_id }) => {
    try {
      const result = await createGuardedLocation(db, actor, { request_id, name, kind, parent_id });
      return reply(result.ok ? { created: result.id, version: result.version, replayed: result.replayed }
        : { error: result.error, conflict: result.conflict });
    } catch {
      return reply({ error: 'Location create failed. Check database migration and server logs; do not assume it was saved.' });
    }
  });

  server.registerTool('move_purkins_location', {
    description: 'Move a private storage container using its CURRENT mcp_version and expected_parent_id from a fresh read. Concurrency conflicts do not overwrite changes. Supply a unique request_id.',
    inputSchema: {
      request_id: requestKey,
      id: locId,
      parent_id: locId.nullable(),
      expected_parent_id: locId.nullable(),
      expected_version: z.number().int().nonnegative(),
    },
  }, async ({ request_id, id, parent_id, expected_parent_id, expected_version }) => {
    try {
      const result = await moveGuardedLocation(db, actor, {
        request_id, id, parent_id, expected_parent_id, expected_version,
      });
      return reply(result.ok ? { moved: result.id, version: result.version, replayed: result.replayed }
        : { error: result.error, conflict: result.conflict });
    } catch {
      return reply({ error: 'Location move failed. Check database migration and server logs; refresh before retrying.' });
    }
  });
}
