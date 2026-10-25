import {describe,it,expect,vi} from 'vitest';
import { publicStorefrontCachePurger } from './publicCachePurge';
import { verifyDeployPurgeAuthorization } from '../cache/deployPurgeAuth';

describe('Purkins publication cache invalidation',()=>{
  it('fails closed until URL and shared secret are configured',()=>{
    expect(publicStorefrontCachePurger(undefined,'secret')).toBeNull();
    expect(publicStorefrontCachePurger('https://purkins.ulwimbo.com',undefined)).toBeNull();
    expect(()=>publicStorefrontCachePurger('http://purkins.ulwimbo.com','secret')).toThrow();
    expect(()=>publicStorefrontCachePurger('https://purkins.ulwimbo.com/other','secret')).toThrow();
  });
  it('sends a scoped signed request to the public Worker and confirms success',async()=>{
    const secret='local-only-test-secret';
    const send=vi.fn(async (_url:URL, init:RequestInit)=>{
      expect(init.method).toBe('POST');
      expect(await verifyDeployPurgeAuthorization(
        (init.headers as Record<string,string>).authorization,secret,Date.now()/1000,
      )).toBe(true);
      return Response.json({success:true});
    });
    const purge=publicStorefrontCachePurger('https://purkins.ulwimbo.com',secret,
      send as unknown as typeof fetch);
    await expect(purge!()).resolves.toBeUndefined();
    expect(String(send.mock.calls[0]![0])).toBe(
      'https://purkins.ulwimbo.com/api/internal/cache-purge');
  });
  it('never treats a failed HTTP response as a confirmed purge',async()=>{
    const purge=publicStorefrontCachePurger('https://purkins.ulwimbo.com','secret',
      (async()=>Response.json({error:'rate-limited'},{status:503})) as typeof fetch);
    await expect(purge!()).rejects.toThrow('cache purge failed');
  });
});
