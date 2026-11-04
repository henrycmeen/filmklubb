import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import search from '@/pages/api/tmdb/search';
import images from '@/pages/api/tmdb/images';
import covers from '@/pages/api/vhs/covers';
import movies from '@/pages/api/club/movies';
import vs from '@/pages/api/club/vs';

const handlers = [
  { handler: search, query: { query: 'api-error-test-987654321' } },
  { handler: images, query: { movieId: '987654321', cache: 'false' } },
  { handler: covers, query: { movieId: '987654321' } },
  { handler: movies, query: {} },
  { handler: vs, query: {}, method: 'POST', body: { movieAId: 987654321, movieBId: 987654322 } },
];

void test('API failures return stable JSON without upstream secrets or filesystem paths', async (t) => {
  const previous = process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY = 'api-error-test-only';
  t.after(() => {
    if (previous === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = previous;
  });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('secret-token /private/server/data upstream stack'); });
  for (const scenario of handlers) {
    let body: unknown;
    let status = 0;
    const res = {
      setHeader() { return this; },
      status(code: number) { status = code; return this; },
      json(value: unknown) { body = value; return this; },
    } as unknown as NextApiResponse;
    await scenario.handler({
      method: scenario.method ?? 'GET', query: scenario.query, body: scenario.body,
      headers: {}, socket: { remoteAddress: '127.0.0.1' },
    } as unknown as NextApiRequest, res);
    assert.equal(status, 500);
    assert.match(JSON.stringify(body), /temporarily unavailable/);
    assert.doesNotMatch(JSON.stringify(body), /secret-token|private|stack/);
  }
});
