import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseHlsPlayback,
  getTrailerSourceKey,
  isAppleWebKitBrowser,
  readVideoSample,
  resolveTrailerSource,
} from "@/lib/appleTrailerPlayback";

const HLS_URL = "https://play-edge.itunes.apple.com/hls/playlist.m3u8?id=1";

void test("Safari and iOS play the stream natively", () => {
  assert.equal(
    chooseHlsPlayback({
      nativeHls: true,
      mediaSource: true,
      appleWebKit: true,
    }),
    "native",
  );
  assert.equal(
    chooseHlsPlayback({
      nativeHls: true,
      mediaSource: false,
      appleWebKit: true,
    }),
    "native",
  );
  assert.equal(isAppleWebKitBrowser("Apple Computer, Inc."), true);
});

void test("Chrome uses hls.js even when it claims native HLS", () => {
  assert.equal(isAppleWebKitBrowser("Google Inc."), false);
  assert.equal(
    chooseHlsPlayback({
      nativeHls: true,
      mediaSource: true,
      appleWebKit: false,
    }),
    "hls.js",
  );
  assert.equal(
    chooseHlsPlayback({
      nativeHls: false,
      mediaSource: true,
      appleWebKit: false,
    }),
    "hls.js",
  );
  assert.equal(
    chooseHlsPlayback({
      nativeHls: false,
      mediaSource: false,
      appleWebKit: false,
    }),
    null,
  );
});

void test("waits for Apple before choosing a trailer", () => {
  assert.deepEqual(
    resolveTrailerSource({
      appleHlsUrl: undefined,
      appleFailed: false,
      youtubeId: "yt",
    }),
    { source: null, pending: true },
  );
});

void test("prefers Apple and keeps YouTube as the fallback", () => {
  assert.deepEqual(
    resolveTrailerSource({
      appleHlsUrl: HLS_URL,
      appleFailed: false,
      youtubeId: "yt",
    }).source,
    { kind: "apple", hlsUrl: HLS_URL },
  );
  assert.deepEqual(
    resolveTrailerSource({
      appleHlsUrl: HLS_URL,
      appleFailed: true,
      youtubeId: "yt",
    }).source,
    { kind: "youtube", youtubeId: "yt" },
  );
  assert.deepEqual(
    resolveTrailerSource({
      appleHlsUrl: null,
      appleFailed: false,
      youtubeId: "yt",
    }).source,
    { kind: "youtube", youtubeId: "yt" },
  );
  assert.deepEqual(
    resolveTrailerSource({
      appleHlsUrl: null,
      appleFailed: false,
      youtubeId: null,
    }),
    { source: null, pending: false },
  );
});

void test("source keys separate Apple and YouTube players", () => {
  assert.equal(
    getTrailerSourceKey({ kind: "apple", hlsUrl: HLS_URL }),
    `apple:${HLS_URL}`,
  );
  assert.equal(
    getTrailerSourceKey({ kind: "youtube", youtubeId: "yt" }),
    "youtube:yt",
  );
  assert.equal(getTrailerSourceKey(null), null);
});

const video = (
  overrides: Partial<Parameters<typeof readVideoSample>[0]> = {},
) => ({
  currentTime: 4,
  duration: 120,
  ended: false,
  paused: false,
  readyState: 4,
  ...overrides,
});

void test("reports video playback with YouTube's state numbers", () => {
  assert.deepEqual(readVideoSample(video(), true, false), {
    state: 1,
    currentTime: 4,
    duration: 120,
  });
  assert.equal(
    readVideoSample(video({ paused: true }), false, false)?.state,
    -1,
  );
  assert.equal(readVideoSample(video({ paused: true }), true, false)?.state, 2);
  assert.equal(readVideoSample(video(), true, true)?.state, 3);
  assert.equal(
    readVideoSample(video({ readyState: 2 }), true, false)?.state,
    3,
  );
  assert.equal(readVideoSample(video({ ended: true }), true, false)?.state, 0);
  assert.equal(
    readVideoSample(video({ duration: Number.NaN }), true, false)?.duration,
    0,
  );
  assert.equal(
    readVideoSample(video({ currentTime: Number.NaN }), true, false),
    null,
  );
});
