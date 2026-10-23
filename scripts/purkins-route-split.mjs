/**
 * Route partition for Purkins' two deployable Workers.
 *
 * During a split build, only whitelisted Astro page files are copied into the
 * generated srcDir. This removes the excluded routes from the SSR manifest and
 * bundle instead of relying on runtime auth to hide them.
 *
 * Public-only: customer pages, cart, checkout, payments, webhooks, public JSON.
 * Admin-only: /admin, /api/admin, plus shared image/health endpoints.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const adminRoute = (r) => r === 'admin' || r.startsWith('admin/') ||
  r === 'api/admin' || r.startsWith('api/admin/');
const sharedAdmin = (r) => r === '404.astro' ||
  r === 'images' || r.startsWith('images/') ||
  r === 'api' || r === 'api/health.ts';

export function routeBelongsToWorker(target, route) {
  if (target !== 'public' && target !== 'admin') {
    throw new Error('Unknown Purkins Worker build target: ' + target);
  }
  const r = route.split('\\').join('/').replace(/^\/+/, '');
  return target === 'public' ? !adminRoute(r) : adminRoute(r) || sharedAdmin(r);
}

export function prepareWorkerSource(root, target) {
  if (!['public', 'admin'].includes(target)) throw new Error('Bad Purkins build target.');
  const source = join(root, 'src');
  const destination = join(root, '.instances', 'split-build', target, 'src');
  if (!existsSync(join(source, 'pages'))) throw new Error('Missing Purkins src/pages.');
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });

  cpSync(source, destination, {
    recursive: true,
    filter(path) {
      const rel = relative(source, path).split(sep).join('/');
      if (!rel.startsWith('pages/')) return true;
      return routeBelongsToWorker(target, rel.slice('pages/'.length));
    },
  });
  // Astro's resolved route manifest must be checked again after each build.
  return destination;
}
