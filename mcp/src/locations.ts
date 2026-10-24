import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { D1Database } from '@cloudflare/workers-types';
import { createLocation, getLocation, listLocationTree, locationIdValid, moveLocation, LOCATION_KINDS } from '../../src/features/purkins/locations';

/**
 * Private storage-location inspection. Shared domain functions ensure the
 * same hierarchy and validation as Admin. Mutation tools require a distinct location-write flag, in addition to the
 * global operator write flag. Leave both disabled in production until
 * authentication, audit, idempotency and concurrency are verified.
 */
export function registerLocationTools(server: McpServer, db: D1Database, allowWrites = false): void {
  server.registerTool('list_purkins_locations', {
    description: 'Operator-only list of private, hierarchical Purkins storage locations. Returns immutable loc_ IDs and current full paths; never accessible to buyers.',
    inputSchema: {},
  }, async () => {
    const locations = await listLocationTree(db);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ locations }) }] };
  });

  server.registerTool('get_purkins_location', {
    description: 'Operator-only details for one storage-location ID. Use list_purkins_locations for its resolved full path.',
    inputSchema: { id: z.string().refine(locationIdValid, 'Invalid loc_ reference.') },
  }, async ({ id }) => {
    const location = await getLocation(db, id);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ location: location ?? null }) }] };
  });

  // This tool registration requires BOTH the general operator write switch and
  // the more narrowly scoped location-write switch. It is not production-ready.
  if (!allowWrites) return;

  server.registerTool('create_purkins_location', {
    description: 'Operator-only create a private stock container. Duplicate sibling names are rejected. Never guesses hierarchy from text paths.',
    inputSchema: {
      name: z.string().trim().min(1).max(100),
      kind: z.enum(LOCATION_KINDS),
      parent_id: z.string().refine(locationIdValid, 'Invalid loc_ parent reference.').nullable().default(null),
    },
  }, async ({ name, kind, parent_id }) => {
    const id = await createLocation(db, name, kind, parent_id);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ created: id }) }] };
  });

  server.registerTool('move_purkins_location', {
    description: 'Operator-only move a private container under another parent/root. Preserves immutable location IDs and prevents cycles.',
    inputSchema: {
      id: z.string().refine(locationIdValid, 'Invalid loc_ reference.'),
      parent_id: z.string().refine(locationIdValid, 'Invalid loc_ parent reference.').nullable(),
    },
  }, async ({ id, parent_id }) => {
    await moveLocation(db, id, parent_id);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ moved: id, parent_id }) }] };
  });
}
