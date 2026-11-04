import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';

await fs.mkdir('.cache', { recursive: true });
const directory = await fs.mkdtemp(path.resolve('.cache/storage-error-api-'));
// A directory cannot be opened as a SQLite database.
process.env.CLUB_DB_PATH = directory;
const { default: floor } = await import('@/pages/api/club/floor');
const { default: next } = await import('@/pages/api/club/next');

void test('floor and next APIs hide database failure details', async (t) => {
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const handler of [floor, next]) {
    let status = 0;
    let body: unknown;
    const res = {
      status(code: number) { status = code; return this; },
      json(value: unknown) { body = value; return this; },
    } as unknown as NextApiResponse;
    await handler({ method: 'GET', query: {} } as unknown as NextApiRequest, res);
    assert.equal(status, 500);
    assert.match(JSON.stringify(body), /temporarily unavailable/);
    assert.doesNotMatch(JSON.stringify(body), /sqlite|storage-error-api|unable to open|SQLITE/);
  }
});
