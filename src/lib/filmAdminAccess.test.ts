import assert from "node:assert/strict";
import { test } from "node:test";
import type { IncomingMessage } from "node:http";
import {
  isLocalFilmAdminRequest,
  isSameOriginAdminWrite,
} from "./filmAdminAccess";

void test("local admin rejects public, forwarded, missing flag and cross-origin access", () => {
  const previous = process.env.FILMKLUBB_LOCAL_ADMIN;
  const request = (headers = {}, address = "127.0.0.1") =>
    ({
      headers: { host: "127.0.0.1:3058", ...headers },
      socket: { remoteAddress: address },
    }) as unknown as IncomingMessage;
  try {
    delete process.env.FILMKLUBB_LOCAL_ADMIN;
    assert.equal(isLocalFilmAdminRequest(request()), false);
    process.env.FILMKLUBB_LOCAL_ADMIN = "1";
    assert.equal(isLocalFilmAdminRequest(request()), true);
    assert.equal(isLocalFilmAdminRequest(request({}, "192.0.2.4")), false);
    assert.equal(
      isLocalFilmAdminRequest(request({ host: "evil.test" })),
      false,
    );
    assert.equal(
      isLocalFilmAdminRequest(request({ "x-forwarded-for": "127.0.0.1" })),
      false,
    );
    assert.equal(
      isLocalFilmAdminRequest(request({ "cf-connecting-ip": "192.0.2.4" })),
      false,
    );
    assert.equal(isSameOriginAdminWrite(request()), false);
    assert.equal(
      isSameOriginAdminWrite(
        request({
          origin: "https://evil.test",
          "content-type": "application/json",
        }),
      ),
      false,
    );
    assert.equal(
      isSameOriginAdminWrite(
        request({
          origin: "http://127.0.0.1:3058",
          "content-type": "application/json",
        }),
      ),
      true,
    );
  } finally {
    if (previous === undefined) delete process.env.FILMKLUBB_LOCAL_ADMIN;
    else process.env.FILMKLUBB_LOCAL_ADMIN = previous;
  }
});
