import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '@/pages/api/vhs/generated/[fileName]';
import { VHS_RENDER_CACHE_DIRECTORY } from './storagePaths';

void test('generated images reject traversal, symlinks and non-images and revalidate replaceable URLs', async (t) => {
  await fs.mkdir(VHS_RENDER_CACHE_DIRECTORY, { recursive: true });
  const name = 'hardening-test-image.png';
  const link = 'hardening-test-link.png';
  const target = path.join(VHS_RENDER_CACHE_DIRECTORY, name);
  await fs.writeFile(target, Buffer.from('own test image'));
  await fs.symlink(target, path.join(VHS_RENDER_CACHE_DIRECTORY, link));
  t.after(async () => {
    await fs.rm(target, { force: true });
    await fs.rm(path.join(VHS_RENDER_CACHE_DIRECTORY, link), { force: true });
  });
  const invoke = async (fileName: string | string[]) => {
    let status = 0;
    let body: unknown;
    const headers: Record<string, string> = {};
    const res = {
      status(code: number) { status = code; return this; },
      json(value: unknown) { body = value; return this; },
      send(value: unknown) { body = value; return this; },
      setHeader(key: string, value: string) { headers[key] = value; },
    } as unknown as NextApiResponse;
    await handler({ method: 'GET', query: { fileName } } as unknown as NextApiRequest, res);
    return { status, body, headers };
  };
  for (const input of ['../secret.png', '%2e%2e%2fsecret.png', 'secret.json', 'a'.repeat(256) + '.png', [name, link]]) {
    assert.equal((await invoke(input)).status, 400);
  }
  assert.equal((await invoke(link)).status, 404);
  assert.equal((await invoke('hardening-test-missing.png')).status, 404);
  const result = await invoke(name);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, Buffer.from('own test image'));
  assert.equal(result.headers['Content-Type'], 'image/png');
  assert.equal(result.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(result.headers['Cache-Control'], 'public, max-age=0, must-revalidate');
});
