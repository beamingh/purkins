import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { publicOrigin } from '../features/http/origin';
import { isPrelaunchNoindex, publicRobotsTxt } from '../features/seo/prelaunch';

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  const origin = publicOrigin(url.origin, env.CANONICAL_ORIGIN);
  const body = publicRobotsTxt(origin, isPrelaunchNoindex(env.PRELAUNCH_NOINDEX));
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' },
  });
};
