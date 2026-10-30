import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import { applyRateLimit } from './rateLimit';

const request = (remote: string, forwarded?: string | string[]) => ({
  socket: { remoteAddress: remote },
  headers: { 'x-forwarded-for': forwarded },
}) as NextApiRequest;
const response = () => {
  const headers = new Map<string, string>();
  let status = 200;
  const res = {
    setHeader: (key: string, value: string) => headers.set(key, value),
    status: (code: number) => { status = code; return res; },
    json: () => res,
  };
  return { res: res as unknown as NextApiResponse, headers, status: () => status };
};

void test('forwarded IPs require trusted peers and cannot bypass the limit with forged prefixes', (t) => {
  const previous = process.env.FILMKLUBB_TRUSTED_PROXIES;
  t.after(() => {
    if (previous === undefined) delete process.env.FILMKLUBB_TRUSTED_PROXIES;
    else process.env.FILMKLUBB_TRUSTED_PROXIES = previous;
  });
  const options = { key: 'proxy-test', maxRequests: 1, windowMs: 60000 };
  delete process.env.FILMKLUBB_TRUSTED_PROXIES;
  assert.equal(applyRateLimit(request('::ffff:192.0.2.1', '1.1.1.1'), response().res, options), true);
  const denied = response();
  assert.equal(applyRateLimit(request('192.0.2.1', '8.8.8.8'), denied.res, options), false);
  assert.equal(denied.status(), 429);
  assert.equal(denied.headers.get('Retry-After'), '60');

  process.env.FILMKLUBB_TRUSTED_PROXIES = '127.0.0.1,192.0.2.10';
  const proxied = { ...options, key: 'trusted-proxy-test' };
  assert.equal(applyRateLimit(request('127.0.0.1', '1.1.1.1, 198.51.100.1, 192.0.2.10'), response().res, proxied), true);
  assert.equal(applyRateLimit(request('127.0.0.1', '8.8.8.8, 198.51.100.1, 192.0.2.10'), response().res, proxied), false);
  assert.equal(applyRateLimit(request('127.0.0.1', '198.51.100.2, 192.0.2.10'), response().res, proxied), true);
  // Malformed/ambiguous headers share the socket's bucket.
  assert.equal(applyRateLimit(request('127.0.0.1', ['1.1.1.1', '8.8.8.8']), response().res, proxied), true);
  assert.equal(applyRateLimit(request('127.0.0.1', 'invalid'), response().res, proxied), false);
});

void test('limits identifier cardinality without evicting active limits and recovers after expiry', (t) => {
  let now = 100_000;
  t.mock.method(Date, 'now', () => now);
  const options = { key: 'bounded-identifiers-test', maxRequests: 1, windowMs: 1000 };
  for (let index = 0; index < 10_000; index++) {
    const address = `198.18.${Math.floor(index / 256)}.${index % 256}`;
    assert.equal(applyRateLimit(request(address), response().res, options), true);
  }
  assert.equal(applyRateLimit(request('203.0.113.1'), response().res, options), false);
  assert.equal(applyRateLimit(request('198.18.0.0'), response().res, options), false);
  now += 1001;
  assert.equal(applyRateLimit(request('203.0.113.1'), response().res, options), true);
});
