import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { D1Database } from '@cloudflare/workers-types';
import { getLocation, listLocationTree, locationIdValid } from '../../src/features/purkins/locations';

/**
 * Private storage-location inspection. Shared domain functions ensure the
 * same hierarchy and validation as Admin. No mutation tools are registered
 * until operator write authorization, audit and retry safety are complete.
 */
export function registerLocationTools(server: McpServer, db: D1Database): void {
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
}
