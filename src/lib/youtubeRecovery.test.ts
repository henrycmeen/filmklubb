import assert from "node:assert/strict";
import test from "node:test";
import {
  getYoutubePlaybackCandidateStart,
  MAX_YOUTUBE_AUTOMATIC_RETRIES,
  scheduleYoutubeRetry,
  shouldRetryYoutubeAutomatically,
  startYoutubeHandshake,
  YOUTUBE_HANDSHAKE_TIMEOUT_MS,
} from "./youtubeRecovery";

const fakeClock = () => {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => now,
    pending: () => timers.size,
    schedule: (callback: () => void, delay: number) => {
      const id = ++nextId;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    cancel: (id: number) => {
      timers.delete(id);
    },
    advance: (target: number) => {
      for (;;) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = target;
    },
  };
};

void test("a player whose API starts after iframe load receives a later handshake", () => {
  const clock = fakeClock();
  let ready = false;
  const acceptedAt: number[] = [];
  startYoutubeHandshake({
    ...clock,
    isReady: () => ready,
    send: () => {
      // Reproduce YouTube ignoring onLoad's message while its API starts.
      if (clock.now() < 900) return;
      acceptedAt.push(clock.now());
      ready = true;
    },
  });
  clock.advance(2_000);
  assert.deepEqual(acceptedAt, [1_000]);
  assert.equal(clock.pending(), 0);
});

void test("a failed iframe cannot keep handshaking forever", () => {
  const clock = fakeClock();
  const sentAt: number[] = [];
  startYoutubeHandshake({
    ...clock,
    isReady: () => false,
    send: () => {
      sentAt.push(clock.now());
    },
  });
  clock.advance(YOUTUBE_HANDSHAKE_TIMEOUT_MS * 2);
  assert.ok(sentAt.length > 1);
  assert.ok(sentAt.every((time) => time < YOUTUBE_HANDSHAKE_TIMEOUT_MS));
  assert.equal(clock.pending(), 0);
});

void test("changing movie or unmounting cancels stale handshakes", () => {
  const clock = fakeClock();
  let attempts = 0;
  const stop = startYoutubeHandshake({
    ...clock,
    isReady: () => false,
    send: () => {
      attempts += 1;
    },
  });
  stop();
  clock.advance(10_000);
  assert.equal(attempts, 1);
  assert.equal(clock.pending(), 0);
});

void test("transient failures get bounded retries and autoplay blocks wait for a gesture", () => {
  let generations = 1;
  for (let attempts = 0; attempts < 100; attempts += 1) {
    if (shouldRetryYoutubeAutomatically(attempts, false)) generations += 1;
  }
  assert.equal(generations, 1 + MAX_YOUTUBE_AUTOMATIC_RETRIES);
  assert.equal(shouldRetryYoutubeAutomatically(0, true), false);
  assert.equal(shouldRetryYoutubeAutomatically(1, true), false);
});

void test("playing during power-on can begin a stability check once tuning starts", () => {
  const duringPowerOn = { signal: "playing", startedAt: null };
  const start = getYoutubePlaybackCandidateStart(
    duringPowerOn.signal,
    duringPowerOn.startedAt,
    420,
  );
  assert.equal(start, 420);
  assert.equal(getYoutubePlaybackCandidateStart("playing", start, 620), 420);
  assert.equal(getYoutubePlaybackCandidateStart("buffering", start, 800), 800);
});

void test("an autoplay block arriving after retry scheduling prevents a remount", () => {
  const clock = fakeClock();
  let blocked = false;
  let remounts = 0;
  scheduleYoutubeRetry({
    ...clock,
    delay: 1_200,
    isEligible: () => shouldRetryYoutubeAutomatically(0, blocked),
    retry: () => {
      remounts += 1;
    },
  });
  clock.advance(600);
  blocked = true;
  clock.advance(1_500);
  assert.equal(remounts, 0);
});

void test("a gesture cancels the scheduled remount while existing-player playback starts", () => {
  const clock = fakeClock();
  let remounts = 0;
  const stop = scheduleYoutubeRetry({
    ...clock,
    delay: 1_200,
    isEligible: () => true,
    retry: () => {
      remounts += 1;
    },
  });
  clock.advance(600);
  stop();
  clock.advance(1_500);
  assert.equal(remounts, 0);
  assert.equal(clock.pending(), 0);
});
