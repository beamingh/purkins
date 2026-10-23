/**
 * Pure resource identifiers and collision/configuration validation. Shared
 * with unit tests, no network calls or Cloudflare mutations.
 */
export const TARGET = Object.freeze({
  worker: 'purkins-storefront',
  mcpWorker: 'purkins-storefront-mcp',
  db: 'purkins-storefront-db',
  images: 'purkins-storefront-images',
  files: 'purkins-storefront-files',
});

export function assertUuid(input) {
  return typeof input === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input);
}

export function parseAccounts(page) {
  const rows = page?.result;
  if (!Array.isArray(rows)) throw new Error('Cloudflare accounts list was incomplete.');
  if (page.result_info?.total_pages > 1 || page.result_info?.total_count > rows.length) {
    throw new Error('Cloudflare accounts list is paginated; refusing partial preflight.');
  }
  if (!rows.every((account) => typeof account.id === 'string' && typeof account.name === 'string')) {
    throw new Error('Cloudflare account metadata invalid.');
  }
  return rows;
}

export function assertApiList(page, kind) {
  let rows;
  if (kind === 'd1' || kind === 'workers') rows = page?.result;
  else if (kind === 'r2') rows = page?.result?.buckets;
  else throw new Error('Unsupported Cloudflare list type.');
  if (!Array.isArray(rows)) throw new Error('Cloudflare ' + kind + ' list invalid. Refusing provisioning.');
  if (page?.result_info?.total_pages > 1 || page?.result_info?.total_count > rows.length) {
    throw new Error('Cloudflare ' + kind + ' list paginated; refusing incomplete inventory.');
  }
  if (kind === 'r2' && (page.result?.cursor || page.result?.continuation_token)) {
    throw new Error('Cloudflare R2 list has more pages. Refusing incomplete inventory.');
  }
  // The Workers API's GET /workers/scripts returns Worker names as
  // result[].id, while D1 and R2 expose result[].name. Normalize to a
  // common name before checking collisions or approving any resource creation.
  // Fail closed if the API changes to an unknown shape.
  const normalized = kind === 'workers'
    ? rows.map((item) => ({ name: item.id ?? item.name }))
    : rows;
  if (!normalized.every((item) => typeof item.name === 'string' && item.name.length > 0)) {
    throw new Error('Cloudflare ' + kind + ' resource name missing.');
  }
  return normalized;
}

export function detectCollisions({ dbs, buckets, workers }) {
  const found = [];
  const groups = [
    ['D1', dbs, [TARGET.db]],
    ['R2', buckets, [TARGET.images, TARGET.files]],
    ['Worker', workers, [TARGET.worker, TARGET.mcpWorker]],
  ];
  for (const [kind, rows, targets] of groups) {
    const names = new Set(rows.map((item) => item.name.toLowerCase()));
    for (const name of targets) if (names.has(name)) found.push(kind + ': ' + name);
  }
  return found;
}

export function renderPermanentConfigs(storeTemplate, mcpTemplate, id) {
  if (!assertUuid(id)) throw new Error('Invalid permanent D1 UUID.');
  function replacePlaceholders(input) {
    const text = input
      .replaceAll('__NAME__', TARGET.worker)
      .replaceAll('__DB_NAME__', TARGET.db)
      .replaceAll('__DB_ID__', id)
      .replaceAll('__BUCKET__', TARGET.images)
      .replaceAll('__FILES_BUCKET__', TARGET.files);
    if (/__[A-Z_]+__/.test(text)) throw new Error('Unfilled Wrangler template token.');
    return text;
  }
  let storefront = replacePlaceholders(storeTemplate);
  let mcp = replacePlaceholders(mcpTemplate);
  if (!storefront.includes('"PRELAUNCH_NOINDEX": "true"')) {
    throw new Error('Prelaunch noindex missing from permanent template.');
  }
  // Provision the Worker as an inaccessible service. Routes are enabled only
  // after Cloudflare Access/admin protection and first-run setup are planned.
  function makeUnrouted(text, main) {
    const marker = '"main": "' + main + '",';
    if (!text.includes(marker)) throw new Error('Wrangler entrypoint changed: ' + main);
    return text.replace(marker, marker + '\n  "workers_dev": false,\n  "preview_urls": false,');
  }
  storefront = makeUnrouted(storefront, './src/worker.ts');
  mcp = makeUnrouted(mcp, 'src/index.ts');
  return { storefront, mcp };
}
