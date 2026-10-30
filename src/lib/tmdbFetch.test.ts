import assert from 'node:assert/strict';
import test from 'node:test';
import { getTmdbMovieById } from './tmdb';

void test('TMDB deadlines cover stalled bodies, retries are bounded and zero disables retry', async (t) => {
  const values = { TMDB_API_KEY: 'fetch-test-only', TMDB_FETCH_TIMEOUT_MS: '15', TMDB_FETCH_RETRIES: '0', TMDB_FETCH_RETRY_BASE_MS: '1' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    calls++;
    return new Response(new ReadableStream({
      start(controller) {
        init.signal!.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
      },
    }));
  });
  await assert.rejects(getTmdbMovieById(987654321), { name: 'AbortError' });
  assert.equal(calls, 1);

  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(null, { status: 503 }); });
  calls = 0;
  process.env.TMDB_FETCH_RETRIES = '2';
  await assert.rejects(getTmdbMovieById(987654321), /503/);
  assert.equal(calls, 3);

  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(null, { status: 401 }); });
  calls = 0;
  await assert.rejects(getTmdbMovieById(987654321), /401/);
  assert.equal(calls, 1);
});

void test('oversized TMDB responses stop streaming without retrying', async (t) => {
  const key = process.env.TMDB_API_KEY;
  process.env.TMDB_API_KEY = 'fetch-size-test-only';
  t.after(() => {
    if (key === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = key;
  });
  let cancelled = false;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(17 * 1024 * 1024)); },
      cancel() { cancelled = true; },
    }));
  });
  await assert.rejects(getTmdbMovieById(987654321), /too large/);
  assert.equal(cancelled, true);
  assert.equal(calls, 1);
});
