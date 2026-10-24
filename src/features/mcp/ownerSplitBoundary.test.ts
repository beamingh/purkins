import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Production Astro split-build copies src/ into .instances/split-build/admin/src.
 * Relative imports from an Admin Astro page or its source helpers must stay in
 * that tree. A ../../../mcp/src dependency works in astro check, but breaks
 * the deployed Admin build after the source is copied.
 */
describe('Purkins Admin MCP owner source-split boundary', () => {
  const srcRoot = fileURLToPath(new URL('../../', import.meta.url));
  const files = [
    new URL('./ownerGate.ts', import.meta.url),
    new URL('../../pages/admin/mcp.astro', import.meta.url),
  ];

  it('keeps Admin page and owner gate relative imports inside copied src/', () => {
    for (const file of files) {
      const filename = fileURLToPath(file);
      const source = readFileSync(filename, 'utf8');
      const imports = [...source.matchAll(/\bfrom\s*['"]((?:\.\.?\/)[^'"]+)['"]/g)];
      for (const [, request] of imports) {
        const destination = resolve(dirname(filename), request);
        const pathFromSrc = relative(srcRoot, destination);
        expect(
          pathFromSrc !== '..' &&
          !pathFromSrc.startsWith('..' + sep) &&
          !isAbsolute(pathFromSrc),
          filename + ' imports ' + request + ' outside the split src/ tree',
        ).toBe(true);
      }
    }
  });
});
