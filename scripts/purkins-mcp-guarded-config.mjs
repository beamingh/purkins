/**
 * Upgrade an existing (locally generated, gitignored) Purkins Admin Wrangler
 * config when the owner explicitly opts into guarded MCP writes.
 *
 * New installers get these bindings from wrangler.admin.template.jsonc.
 * This helper also upgrades installations provisioned before those flags.
 * It deliberately never activates legacy product/media/order writers.
 */
export const PURKINS_STOREFRONT_URL = 'https://purkins.ulwimbo.com';

export const PURKINS_GUARDED_MCP_SCOPE_FLAGS = [
  'PURKINS_MCP_STOCK_WRITES_ENABLED',
  'PURKINS_MCP_CLOTHING_WRITES_ENABLED',
  'PURKINS_MCP_LOCATION_WRITES_ENABLED',
  'PURKINS_MCP_GALLERY_WRITES_ENABLED',
];

function setStringVar(source, name, desired, checkPrevious = null) {
  const re = new RegExp('("'+name+'"\\s*:\\s*")([^"]*)(")', 'g');
  const matches = [...source.matchAll(re)];
  if (matches.length > 1) throw new Error('Duplicate Admin MCP variable: ' + name);
  if (matches.length === 1) {
    const previous = matches[0][2];
    if (checkPrevious && !checkPrevious(previous)) {
      throw new Error('Unexpected ' + name + ' value; refusing MCP configuration.');
    }
    return source.replace(re, (_full, before, _previous, after) => before + desired + after);
  }
  // Some original permanent configurations end the vars object with the
  // global write flag: its line has NO trailing comma. Insert new variables
  // BEFORE that line rather than requiring a comma after its value. This also
  // preserves the original property order, indentation and trailing comments.
  const anchor = /^([ \t]*)("PURKINS_MCP_WRITES_ENABLED"[ \t]*:[ \t]*"true")(?=[ \t]*(?:,|\/\/|[\r\n}]|$))/m;
  if (!anchor.test(source)) throw new Error('Missing global MCP write variable insertion point.');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return source.replace(anchor, (_whole, indent, setting) =>
    indent + '"' + name + '": "' + desired + '",' + newline + indent + setting);
}

export function configureGuardedMcpWrites(source) {
  const globals = [...source.matchAll(/"PURKINS_MCP_WRITES_ENABLED"\s*:\s*"([^"]*)"/g)];
  if (globals.length !== 1 || globals[0][1] !== 'true') {
    throw new Error('Enable the global MCP write switch through its existing confirmation gate first.');
  }

  let next = setStringVar(source, 'STOREFRONT_URL', PURKINS_STOREFRONT_URL,
    previous => previous === PURKINS_STOREFRONT_URL);
  // Do not elevate the old non-receipted publication, price, image import
  // and order-fulfillment writers just because guarded draft writes are on.
  next = setStringVar(next, 'PURKINS_MCP_LEGACY_WRITES_ENABLED', 'false',
    previous => previous === 'false');
  for (const name of PURKINS_GUARDED_MCP_SCOPE_FLAGS) {
    next = setStringVar(next, name, 'true',
      previous => previous === 'false' || previous === 'true');
  }
  return next;
}

/**
 * Publication has its OWN explicitly confirmed local kill switch. Never
 * silently enable it when ordinary draft/photo/location writes are enabled.
 * Full MCP token permissions are not sufficient to bypass this gate.
 */
export function configurePublicationMcpWrite(source, enabled) {
  const globals = [...source.matchAll(/"PURKINS_MCP_WRITES_ENABLED"\s*:\s*"([^"]*)"/g)];
  if(globals.length!==1 || globals[0][1]!=='true'){
    throw new Error('Global MCP writes must be explicitly enabled before publication.');
  }
  return setStringVar(source,'PURKINS_MCP_PUBLICATION_WRITES_ENABLED',
    enabled ? 'true' : 'false',previous=>previous==='true'||previous==='false');
}
