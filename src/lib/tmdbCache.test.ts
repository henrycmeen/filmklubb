import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { getTmdbMovieList } from './tmdb';
import { TMDB_LIST_CACHE_DIRECTORY } from './storagePaths';

void test('invalid cache entries refresh; unavailable disk does not discard TMDB results', async (t) => {
  const key = process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY = 'cache-test-only';
  t.after(() => {
    if (key === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = key;
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ results: [] });
  });
  await fs.mkdir(TMDB_LIST_CACHE_DIRECTORY, { recursive: true });
  const cachePath = path.join(TMDB_LIST_CACHE_DIRECTORY, 'popular-page-987654321.json');
  t.after(() => fs.rm(cachePath, { force: true, recursive: true }));
  for (const content of [
    '{partial',
    JSON.stringify({ cachedAt: new Date().toISOString(), payload: { results: 'bad' } }),
    JSON.stringify({ cachedAt: 'invalid', payload: { results: [] } }),
    JSON.stringify({ cachedAt: '2999-01-01T00:00:00.000Z', payload: { results: [] } }),
  ]) {
    await fs.writeFile(cachePath, content);
    const before = calls;
    assert.deepEqual(await getTmdbMovieList('popular', 987654321), []);
    assert.equal(calls, before + 1);
    assert.deepEqual(await getTmdbMovieList('popular', 987654321), []);
    assert.equal(calls, before + 1, 'fresh cache is reused');
  }
  await fs.rm(cachePath);
  await fs.mkdir(cachePath);
  assert.deepEqual(await getTmdbMovieList('popular', 987654321), []);
  assert.equal((await fs.readdir(TMDB_LIST_CACHE_DIRECTORY)).some(name => name.startsWith('popular-page-987654321.json.')), false);
});
