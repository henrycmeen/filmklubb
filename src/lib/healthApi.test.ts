import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';

await fs.mkdir('.cache', { recursive: true });
const directory = await fs.mkdtemp(path.resolve('.cache/health-api-test-'));
process.env.CLUB_DB_PATH = path.join(directory, 'health.sqlite');
const { default: handler } = await import('@/pages/api/health');

void test('health reports unwritable storage without exposing secrets or caching the result', async (t) => {
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  t.mock.method(fs, 'access', async () => { throw new Error('secret /private/storage'); });
  let status = 0;
  let body: unknown;
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string) { headers[name] = value; },
    status(code: number) { status = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as NextApiResponse;
  await handler({ method: 'GET' } as NextApiRequest, res);
  assert.equal(status, 500);
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal((body as { checks: { cacheDirectories: boolean } }).checks.cacheDirectories, false);
  assert.doesNotMatch(JSON.stringify(body), /secret|private|health-api-test/);
});
