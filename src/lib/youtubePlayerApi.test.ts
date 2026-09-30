import assert from "node:assert/strict";
import test from "node:test";
import {
  createYoutubeApiLoader,
  createMutedYoutubePlayback,
  observeYoutubeProgress,
  readYoutubePlayerSample,
  shouldRecoverYoutubePoster,
  type YoutubeIframeApi,
} from "./youtubePlayerApi";

const fakeLoader = () => {
  let api: YoutubeIframeApi | undefined;
  let ready: (() => void) | undefined;
  let fail: (() => void) | undefined;
  let timeout: (() => void) | undefined;
  let scripts = 0;
  let subscriptions = 0;
  const load = createYoutubeApiLoader({
    getApi: () => api,
    subscribeReady: (callback) => {
      ready = callback;
      subscriptions += 1;
      return () => {
        subscriptions -= 1;
      };
    },
    loadScript: (callback) => {
      scripts += 1;
      fail = callback;
      return () => {
        fail = undefined;
      };
    },
    schedule: (callback) => {
      timeout = callback;
      return 1;
    },
    cancel: () => {
      timeout = undefined;
    },
  });
  return {
    load,
    scripts: () => scripts,
    subscriptions: () => subscriptions,
    resolve: () => {
      api = { Player: class {} } as unknown as YoutubeIframeApi;
      ready?.();
      return api;
    },
    fail: () => fail?.(),
    timeout: () => timeout?.(),
  };
};

void test("concurrent mounts and a StrictMode remount share the delayed official API load", async () => {
  const loader = fakeLoader();
  const first = loader.load();
  const remount = loader.load();
  assert.equal(first, remount);
  assert.equal(loader.scripts(), 1);
  const api = loader.resolve();
  assert.equal(await first, api);
  assert.equal(await remount, api);
  assert.equal(loader.subscriptions(), 0);
  assert.equal(await loader.load(), api);
  assert.equal(loader.scripts(), 1);
});

void test("API script failure releases subscribers and permits an explicit later load", async () => {
  const loader = fakeLoader();
  const failed = loader.load();
  loader.fail();
  await assert.rejects(failed, /could not load/);
  assert.equal(loader.subscriptions(), 0);
  const retry = loader.load();
  assert.equal(loader.scripts(), 2);
  loader.resolve();
  await retry;
});

void test("a missing API readiness callback rejects after its bounded timeout", async () => {
  const loader = fakeLoader();
  const pending = loader.load();
  loader.timeout();
  await assert.rejects(pending, /could not load/);
  assert.equal(loader.subscriptions(), 0);
});

void test("play waits for the public muted state rather than racing the mute command", () => {
  let muted = false;
  const commands: string[] = [];
  const playback = createMutedYoutubePlayback({
    setVolume: (volume) => {
      commands.push(`volume:${volume}`);
    },
    mute: () => {
      commands.push("mute");
    },
    isMuted: () => muted,
    playVideo: () => {
      commands.push("play");
    },
  });
  playback.request();
  playback.flush();
  assert.deepEqual(commands, ["volume:0", "mute"]);
  muted = true;
  playback.flush();
  playback.flush();
  assert.deepEqual(commands, ["volume:0", "mute", "play"]);
  playback.request();
  assert.deepEqual(commands.slice(-3), ["volume:0", "mute", "play"]);
});

void test("autoplay block or unmount cancels pending play before delayed mute acknowledgment", () => {
  let muted = false;
  let plays = 0;
  const playback = createMutedYoutubePlayback({
    setVolume: () => undefined,
    mute: () => undefined,
    isMuted: () => muted,
    playVideo: () => {
      plays += 1;
    },
  });
  playback.request();
  playback.cancel();
  muted = true;
  playback.flush();
  assert.equal(plays, 0);
});

void test("official getter samples reveal advancing playback without private messages or duration", () => {
  let time = 3;
  const player = {
    getPlayerState: () => 1,
    getCurrentTime: () => time,
    getDuration: () => 0,
  };
  const first = readYoutubePlayerSample(player);
  assert.deepEqual(first, { state: 1, currentTime: 3, duration: 0 });
  const baseline = observeYoutubeProgress(null, null, first.currentTime, 0);
  assert.equal(baseline.advanced, false);
  time = 3.25;
  const second = readYoutubePlayerSample(player);
  assert.ok(second);
  assert.deepEqual(
    observeYoutubeProgress(
      first.currentTime,
      baseline.lastAdvancedAt,
      second.currentTime,
      250,
    ),
    {
      advanced: true,
      lastAdvancedAt: 250,
    },
  );
});

void test("repeated samples of a frozen frame cannot renew the playback watchdog", () => {
  let progress = observeYoutubeProgress(3, 0, 3.25, 250);
  assert.equal(progress.lastAdvancedAt, 250);
  for (let now = 500; now <= 5_000; now += 250) {
    progress = observeYoutubeProgress(3.25, progress.lastAdvancedAt, 3.25, now);
  }
  assert.equal(progress.advanced, false);
  assert.equal(progress.lastAdvancedAt, 250);
});

void test("invalid getter values do not manufacture stable playback", () => {
  assert.equal(
    readYoutubePlayerSample({
      getPlayerState: () => 1,
      getCurrentTime: () => Number.NaN,
      getDuration: () => 90,
    }),
    null,
  );
});

void test("a frozen PLAYING frame stays on the poster until playback actually resumes", () => {
  let previousTime: number | null = 3.25;
  let posterVisible = true;
  let recoveries = 0;
  // After the watchdog and fallback deadline, cached PLAYING samples continue.
  // They must not clear the poster and restart the seven-second tuning cycle.
  for (let elapsed = 0; elapsed <= 21_000; elapsed += 250) {
    if (shouldRecoverYoutubePoster(1, previousTime, 3.25, true)) {
      posterVisible = false;
      recoveries += 1;
    }
    previousTime = 3.25;
  }
  assert.equal(posterVisible, true);
  assert.equal(recoveries, 0);
  assert.equal(shouldRecoverYoutubePoster(1, previousTime, 3.5, true), true);
  assert.equal(shouldRecoverYoutubePoster(2, previousTime, 3.5, true), false);
  assert.equal(shouldRecoverYoutubePoster(1, null, 3.5, true), false);
  assert.equal(shouldRecoverYoutubePoster(1, previousTime, 0, true), false);
});

void test("failed trailer stays on static until a gesture and advancing playback", () => {
  assert.equal(shouldRecoverYoutubePoster(2, 3, 3, false), false);
  // Focus recovery may start the hidden player, but must not replace static
  // until the person explicitly activates the TV.
  assert.equal(shouldRecoverYoutubePoster(1, 3, 3.25, false), false);
  assert.equal(shouldRecoverYoutubePoster(1, 3.25, 3.25, true), false);
  assert.equal(shouldRecoverYoutubePoster(1, 3.25, 3.5, true), true);
});
