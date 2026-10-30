import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import search from '@/pages/api/tmdb/search';
import images from '@/pages/api/tmdb/images';
import covers from '@/pages/api/vhs/covers';
import movies from '@/pages/api/club/movies';
import floor from '@/pages/api/club/floor';
import next from '@/pages/api/club/next';
import render from '@/pages/api/vhs/render';
import custom from '@/pages/api/vhs/custom-cover';
import templates from '@/pages/api/vhs/templates';

type Handler = (req: NextApiRequest, res: NextApiResponse) => unknown;
void test('rejects malformed, ambiguous and oversized params before TMDB or storage work', async (t) => {
  const previous = process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY = 'validation-test-only';
  t.after(() => {
    if (previous === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = previous;
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('should not fetch'); });
  const cases: Array<[Handler, Record<string, string | string[]>, string?]> = [
    [search, { query: 'test', limit: 'NaN' }],
    [search, { query: ['test', 'other'] }],
    [search, { query: 'x'.repeat(257) }],
    [images, { movieId: '1', cache: 'maybe' }],
    [images, { movieId: ['1', '2'] }],
    [images, { movieId: '9007199254740993' }],
    [covers, { movieId: 'bad' }],
    [covers, { titles: Array(21).fill('Test::2020').join('|') }],
    [covers, { titles: 'Test::NaN' }],
    [covers, { force: 'maybe' }],
    [movies, { limit: ['1', '2'] }],
    [next, { boardId: ['one', 'two'] }],
    [floor, { boardId: 'x'.repeat(65) }],
    [floor, { expectedVersion: ['0', '1'] }, 'DELETE'],
  ];
  for (const [handler, query, method = 'GET'] of cases) {
    let status = 0;
    const res = {
      setHeader() { return this; },
      status(code: number) { status = code; return this; },
      json() { return this; },
    } as unknown as NextApiResponse;
    await handler({ method, query, headers: {}, socket: { remoteAddress: '127.0.0.1' } } as unknown as NextApiRequest, res);
    assert.equal(status, 400, `${handler.name}: ${JSON.stringify(query)}`);
  }
  assert.equal(calls, 0);
});

void test('unsupported methods include Allow on scoped APIs', async () => {
  for (const [handler, allowed] of [[search, 'GET'], [images, 'GET'], [covers, 'GET'], [movies, 'GET'], [render, 'POST'], [custom, 'POST'], [templates, 'GET']] as const) {
    let status = 0;
    let allow = '';
    const res = {
      setHeader(name: string, value: string) { if (name === 'Allow') allow = value; },
      status(code: number) { status = code; return this; },
      json() { return this; },
    } as unknown as NextApiResponse;
    await handler({ method: 'PATCH' } as NextApiRequest, res);
    assert.equal(status, 405);
    assert.equal(allow, allowed);
  }
});

void test('render rejects oversized overlay allocations before loading images', async () => {
  for (const overlays of [
    [{ publicPath: '/own-test.png', width: 1000000, height: 1000000 }],
    Array.from({ length: 17 }, () => ({ publicPath: '/own-test.png' })),
  ]) {
    let status = 0;
    const res = {
      setHeader() { return this; },
      status(code: number) { status = code; return this; },
      json() { return this; },
    } as unknown as NextApiResponse;
    await render({
      method: 'POST', body: { sourcePath: '/own-test.png', overlays },
      headers: {}, socket: { remoteAddress: '127.0.0.1' },
    } as unknown as NextApiRequest, res);
    assert.equal(status, 400);
  }
});
