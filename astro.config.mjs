import { writeFileSync as writeSplitRouteFile, mkdirSync as mkdirSplitRouteDirectory } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import { resolveTheme } from './scripts/themes.mjs';
import { themeCssPath, writeThemeArtifacts } from './scripts/theme-css.mjs';

// SSR on Cloudflare Workers. platformProxy lets `astro dev` read bindings
// (D1, R2, vars) from wrangler.jsonc locally.
// Tailwind v4 is wired via its Vite plugin (the old @astrojs/tailwind
// integration is deprecated).

// Which theme this build compiles. Resolved once, here, and shared
// with Tailwind through the #theme-css alias below — the template alias
// and the CSS scope must never disagree, or the build succeeds while shipping
// an unstyled or wrongly styled site. The generated files are written for ALL
// themes and are byte-identical no matter which theme this process selected, so a
// concurrent build for another theme cannot fight a running dev server over
// them (see the design rule in scripts/theme-css.mjs).
const theme = resolveTheme();
writeThemeArtifacts();

// An explicit split build uses a generated, route-filtered Astro srcDir.
// Ordinary npm run build/dev/check retain the original source layout.
const workerTarget = process.env.PURKINS_WORKER_TARGET;
if (workerTarget && !['public', 'admin'].includes(workerTarget)) {
  throw new Error('Invalid PURKINS_WORKER_TARGET (expected public or admin).');
}
const splitSrc = workerTarget
  ? new URL(`./.instances/split-build/${workerTarget}/src/`, import.meta.url)
  : undefined;
const splitOutput = workerTarget
  ? new URL(`./dist/${workerTarget}/`, import.meta.url)
  : undefined;

// Stamp every build with the theme it was compiled for. The deploy scripts
// refuse to ship an artifact whose stamp disagrees with the current
// selection — without this, `deploy --skip-build` happily deploys whatever
// design happened to be in dist/, and nothing ever knows.
const themeStamp = {
  name: 'minshop:theme-stamp',
  hooks: {
    'astro:build:done': async () => {
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const stampDir = splitOutput ?? new URL('./dist/', import.meta.url);
      mkdirSync(stampDir, { recursive: true });
      writeFileSync(
        new URL('./theme.json', stampDir),
        `${JSON.stringify({ theme: theme.id }, null, 2)}\n`,
      );
    },
  },
};

// Validate the *resolved* Astro route manifest, not just the source copy.
// A wrong srcDir, plugin-injected route, or accidentally included checkout/API
// is a hard build failure instead of a security regression at deployment.
const splitRouteBoundary = {
  name: 'purkins:worker-route-boundary',
  hooks: {
    'astro:routes:resolved': ({ routes }) => {
      if (!workerTarget) return;
      const paths = routes.filter((r) => r.origin === 'project').map((r) => r.pattern);
      const hasAdmin = (p) => p === '/admin' || p.startsWith('/admin/') ||
        p === '/api/admin' || p.startsWith('/api/admin/');
      const adminShared = (p) => p === '/404' || p === '/images' ||
        p.startsWith('/images/') || p === '/api/health';
      const bad = paths.filter((p) => workerTarget === 'public'
        ? hasAdmin(p)
        : !hasAdmin(p) && !adminShared(p));
      if (bad.length > 0) {
        throw new Error('Purkins ' + workerTarget + ' build crossed route boundary: ' + bad.join(', '));
      }
      if (workerTarget === 'admin' && !paths.some((p) => p === '/admin') ||
          workerTarget === 'public' && !paths.some((p) => p === '/api/checkout')) {
        throw new Error('Purkins ' + workerTarget + ' Worker lost its expected routes.');
      }
      const output = join(process.cwd(), '.instances', 'split-build', workerTarget);
      mkdirSplitRouteDirectory(output, { recursive: true });
      writeSplitRouteFile(join(output, 'routes.json'), JSON.stringify(paths.sort(), null, 2) + '\n');
    },
  },
};

export default defineConfig({
  ...(splitSrc ? { srcDir: splitSrc } : {}),
  ...(splitOutput ? { outDir: splitOutput } : {}),
  output: 'server',
  integrations: [themeStamp, splitRouteBoundary],
  // Replaced by the equivalent middleware guard so the bearer-capability
  // /pay/otk_… form can support clients that omit Origin without weakening
  // cookie-authenticated Admin/account forms.
  security: { checkOrigin: false },
  adapter: cloudflare({
    // Keep Cloudflare Images opt-in. The adapter otherwise auto-provisions an
    // IMAGES binding even though minshop stores and serves originals from R2.
    imageService: 'passthrough',
    platformProxy: { enabled: true },
  }),
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '#theme': theme.dir,
        // The per-theme stylesheet this process compiles. Selection by alias is
        // the point: the files on disk never change per process, only which
        // one global.css's @import resolves to. Tailwind v4's plugin follows
        // Vite aliases in CSS @import (probed before relying on it).
        '#theme-css': themeCssPath(theme.id),
      },
    },
  },
});
