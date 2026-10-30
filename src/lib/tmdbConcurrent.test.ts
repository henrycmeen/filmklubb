import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { getTmdbMovieList, getTmdbMovieById, getTmdbMovieImages } from './tmdb';
import { TMDB_LIST_CACHE_DIRECTORY } from './storagePaths';

void test('concurrent list and image misses share upstream work and failures can be retried', async (t) => {
  const key = process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY = 'concurrency-test-only';
  t.after(() => {
    if (key === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = key;
  });
  const cache = path.join(TMDB_LIST_CACHE_DIRECTORY, 'popular-page-987654320.json');
  await fs.rm(cache, { force: true });
  t.after(() => fs.rm(cache, { force: true }));
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 5));
    return Response.json({ results: [] });
  });
  assert.deepEqual(await Promise.all(Array.from({ length: 10 }, () => getTmdbMovieList('popular', 987654320))), Array(10).fill([]));
  assert.equal(calls, 1);
  await Promise.all(Array.from({ length: 10 }, () => getTmdbMovieImages(987654320, 24, { useCache: false })));
  assert.equal(calls, 2);

  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('stubbed failure'); });
  const failed = await Promise.allSettled(Array.from({ length: 10 }, () => getTmdbMovieById(987654320)));
  assert.equal(failed.every(result => result.status === 'rejected'), true);
  assert.equal(calls, 3);
  await assert.rejects(getTmdbMovieById(987654320));
  assert.equal(calls, 4);
});
