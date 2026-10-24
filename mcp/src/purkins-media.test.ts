import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { safeImageUrl, downloadImage, registerPurkinsMediaTools } from './purkins-media';

const tinyGif = Uint8Array.from([
  0x47,0x49,0x46,0x38,0x39,0x61,0x01,0x00,0x01,0x00,
  0x80,0x00,0x00,0xff,0xff,0xff,0x00,0x00,0x00,
  0x21,0xf9,0x04,0x01,0,0,0,0,0x2c,0,0,0,0,
  0x01,0x00,0x01,0x00,0,0x02,0x02,0x44,0x01,0,0x3b,
]);

describe('Purkins MCP image URL boundary', () => {
  it('accepts only an explicit public HTTPS hostname', () => {
    expect(safeImageUrl('https://example.com/a.png')?.href).toBe('https://example.com/a.png');
    for (const blocked of [
      'http://example.com/x.jpg',
      'https://localhost/image.png',
      'https://10.0.0.1/x.jpg',
      'https://127.0.0.1/x.jpg',
      'https://[::1]/x.jpg',
      'https://metadata.internal/x.jpg',
      'https://a.local/x.jpg',
      'https://example.com:8443/x.jpg',
      'https://user:pass@example.com/x.jpg',
      'file:///etc/passwd',
      'https://example.com.evil.invalid/x.png',
    ]) expect(safeImageUrl(blocked), blocked).toBeNull();
  });

  it('downloads a bounded, supported raster image without redirects', async () => {
    const load = vi.fn(async () => new Response(tinyGif, {
      status: 200, headers: { 'content-type': 'image/gif' },
    }));
    const file = await downloadImage('https://photos.example.org/example.gif', load as unknown as typeof fetch);
    expect(file.type).toBe('image/gif');
    expect(file.size).toBe(tinyGif.length);
    expect(load).toHaveBeenCalledOnce();
    expect(load.mock.calls[0]?.[0]).toBe('https://photos.example.org/example.gif');
    expect(load.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  it('rejects a disguised HTML response and oversized image before storing it', async () => {
    await expect(downloadImage('https://example.org/fake.png', async () => new Response(
      '<script>alert(1)</script>', { headers: { 'content-type': 'image/png' } },
    ))).rejects.toThrow('valid supported image');

    await expect(downloadImage('https://example.org/big.png', async () => new Response(
      tinyGif, { headers: { 'content-type': 'image/gif', 'content-length': '6000000' } },
    ))).rejects.toThrow('larger than 5 MB');

    await expect(downloadImage('https://127.0.0.1/secret', vi.fn() as unknown as typeof fetch))
      .rejects.toThrow('public HTTPS image URL');
  });
});

describe('MCP tool tier split', () => {
  function names(allowWrites: boolean) {
    const seen: string[] = [];
    const server = { registerTool(name: string) { seen.push(name); } } as unknown as McpServer;
    registerPurkinsMediaTools(server, {} as never, {} as never, allowWrites);
    return seen;
  }

  it('gives a bearer-token-only operator session read access but not write access', () => {
    expect(names(false)).toEqual(['list_purkins_media', 'get_purkins_gallery']);
  });

  it('requires the independent write flag to register image mutators', () => {
    expect(names(true)).toEqual([
      'list_purkins_media', 'get_purkins_gallery', 'attach_purkins_media',
      'import_purkins_image', 'set_purkins_photo_alt',
    ]);
  });
});
