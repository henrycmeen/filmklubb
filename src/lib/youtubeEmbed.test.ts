import assert from "node:assert/strict";
import test from "node:test";
import {
  buildYoutubeTrailerEmbedUrl,
  getYoutubeDuration,
  getYoutubePlaybackProgress,
  getYoutubeTrailerCutoffSeconds,
  isYoutubeAutoplayBlockedMessage,
  isYoutubeBufferingMessage,
  isYoutubeEndedMessage,
  isYoutubeErrorMessage,
  isYoutubePausedMessage,
  isYoutubePlayingMessage,
  isYoutubeReadyMessage,
  shouldRestartYoutubeTrailer,
  YOUTUBE_TRAILER_INITIAL_START_SECONDS,
  YOUTUBE_TRAILER_LOOP_START_SECONDS,
} from "./youtubeEmbed";

void test("starts the first trailer play slightly in before loops restart from zero", () => {
  const result = new URL(buildYoutubeTrailerEmbedUrl("sVwH0hIvV5k"));

  assert.equal(result.origin, "https://www.youtube-nocookie.com");
  assert.equal(result.pathname, "/embed/sVwH0hIvV5k");
  assert.equal(result.searchParams.get("autoplay"), "1");
  assert.equal(result.searchParams.get("mute"), "1");
  assert.equal(result.searchParams.get("controls"), "0");
  assert.equal(result.searchParams.get("loop"), "1");
  assert.equal(result.searchParams.get("playlist"), "sVwH0hIvV5k");
  assert.equal(result.searchParams.get("playsinline"), "1");
  assert.equal(result.searchParams.get("disablekb"), "1");
  assert.equal(result.searchParams.get("fs"), "0");
  assert.equal(result.searchParams.get("cc_load_policy"), "0");
  assert.equal(result.searchParams.get("enablejsapi"), "1");
  assert.equal(
    result.searchParams.get("start"),
    String(YOUTUBE_TRAILER_INITIAL_START_SECONDS),
  );
  assert.equal(YOUTUBE_TRAILER_INITIAL_START_SECONDS, 3);
  assert.equal(YOUTUBE_TRAILER_LOOP_START_SECONDS, 0);
  assert.ok(
    YOUTUBE_TRAILER_INITIAL_START_SECONDS > YOUTUBE_TRAILER_LOOP_START_SECONDS,
  );
  assert.equal(result.searchParams.has("modestbranding"), false);
  assert.equal(result.searchParams.has("showinfo"), false);
  assert.equal(result.searchParams.has("autohide"), false);
});

void test("recognizes YouTube playback messages before revealing the TV", () => {
  assert.equal(
    isYoutubePlayingMessage({ event: "onStateChange", info: 1 }),
    true,
  );
  assert.equal(
    isYoutubePlayingMessage({
      event: "infoDelivery",
      info: { playerState: 1 },
    }),
    true,
  );
  assert.equal(
    isYoutubePlayingMessage({ event: "onStateChange", info: 2 }),
    false,
  );
  assert.equal(isYoutubePlayingMessage("playing"), false);
});

void test("recognizes YouTube's ended state so the trailer can restart", () => {
  assert.equal(
    isYoutubeEndedMessage({ event: "onStateChange", info: 0 }),
    true,
  );
  assert.equal(
    isYoutubeEndedMessage({
      event: "infoDelivery",
      info: { playerState: 0 },
    }),
    true,
  );
  assert.equal(
    isYoutubeEndedMessage({ event: "onStateChange", info: 1 }),
    false,
  );
  assert.equal(isYoutubeEndedMessage("ended"), false);
});

void test("recognizes a trailer that pauses before the TV picture is revealed", () => {
  assert.equal(
    isYoutubePausedMessage({ event: "onStateChange", info: 2 }),
    true,
  );
  assert.equal(
    isYoutubePausedMessage({
      event: "infoDelivery",
      info: { playerState: 2 },
    }),
    true,
  );
  assert.equal(
    isYoutubePausedMessage({ event: "onStateChange", info: 1 }),
    false,
  );
  assert.equal(isYoutubePausedMessage("paused"), false);
});

void test("recognizes buffering so a half-started trailer stays hidden", () => {
  assert.equal(
    isYoutubeBufferingMessage({ event: "onStateChange", info: 3 }),
    true,
  );
  assert.equal(
    isYoutubeBufferingMessage({
      event: "infoDelivery",
      info: { playerState: 3 },
    }),
    true,
  );
  assert.equal(
    isYoutubeBufferingMessage({ event: "onStateChange", info: 1 }),
    false,
  );
  assert.equal(isYoutubeBufferingMessage("buffering"), false);
});

void test("recognizes explicit autoplay blocks and player errors", () => {
  assert.equal(
    isYoutubeAutoplayBlockedMessage({ event: "onAutoplayBlocked" }),
    true,
  );
  assert.equal(
    isYoutubeAutoplayBlockedMessage({ event: "onStateChange", info: 2 }),
    false,
  );
  assert.equal(isYoutubeErrorMessage({ event: "onError", info: 150 }), true);
  assert.equal(
    isYoutubeErrorMessage({ event: "onStateChange", info: 3 }),
    false,
  );
});

void test("recognizes when YouTube is ready for mute and play commands", () => {
  assert.equal(isYoutubeReadyMessage({ event: "onReady" }), true);
  assert.equal(
    isYoutubeReadyMessage({ event: "onStateChange", info: 1 }),
    false,
  );
  assert.equal(isYoutubeReadyMessage("ready"), false);
});

void test("restarts a trailer before its final outro", () => {
  assert.equal(
    shouldRestartYoutubeTrailer({
      event: "infoDelivery",
      info: { currentTime: 77.9, duration: 100 },
    }),
    false,
  );
  assert.equal(
    shouldRestartYoutubeTrailer({
      event: "infoDelivery",
      info: { currentTime: 78, duration: 100 },
    }),
    true,
  );
  assert.equal(
    shouldRestartYoutubeTrailer({
      event: "infoDelivery",
      info: { currentTime: 177.9, duration: 200 },
    }),
    false,
  );
  assert.equal(
    shouldRestartYoutubeTrailer({
      event: "infoDelivery",
      info: { currentTime: 178, duration: 200 },
    }),
    true,
  );
  assert.equal(
    shouldRestartYoutubeTrailer({
      event: "infoDelivery",
      info: {
        currentTime: 80.2,
        progressState: { current: 80.2, duration: 89 },
      },
    }),
    true,
  );
});

void test("ignores incomplete YouTube progress messages", () => {
  assert.equal(
    shouldRestartYoutubeTrailer({
      event: "infoDelivery",
      info: { currentTime: 90 },
    }),
    false,
  );
  assert.equal(
    shouldRestartYoutubeTrailer({
      event: "infoDelivery",
      info: { currentTime: 0, duration: 0 },
    }),
    false,
  );
  assert.equal(shouldRestartYoutubeTrailer("90 percent"), false);
});

void test("uses a cached duration when YouTube sends current time separately", () => {
  assert.deepEqual(
    getYoutubePlaybackProgress(
      { event: "infoDelivery", info: { currentTime: 44 } },
      120,
    ),
    { currentTime: 44, duration: 120 },
  );
  assert.deepEqual(
    getYoutubePlaybackProgress(
      {
        event: "infoDelivery",
        info: { progressState: { current: 18 } },
      },
      120,
    ),
    { currentTime: 18, duration: 120 },
  );
  assert.equal(
    getYoutubePlaybackProgress({
      event: "infoDelivery",
      info: { duration: 120 },
    }),
    null,
  );
});

void test("reads valid durations from info and initial delivery messages", () => {
  assert.equal(
    getYoutubeDuration({ event: "infoDelivery", info: { duration: 120 } }),
    120,
  );
  assert.equal(
    getYoutubeDuration({
      event: "infoDelivery",
      info: { progressState: { duration: 95 } },
    }),
    95,
  );
  assert.equal(
    getYoutubeDuration({
      event: "initialDelivery",
      info: { progressState: { duration: 80 } },
    }),
    80,
  );
  assert.equal(
    getYoutubeDuration({ event: "infoDelivery", info: { duration: 0 } }),
    null,
  );
  assert.equal(
    getYoutubeDuration({ event: "infoDelivery", info: { duration: Infinity } }),
    null,
  );
  assert.equal(getYoutubeDuration("duration"), null);
});

void test("cuts off short and long trailers before their outro", () => {
  assert.equal(getYoutubeTrailerCutoffSeconds(20), 10);
  assert.equal(getYoutubeTrailerCutoffSeconds(60), 38);
  assert.equal(getYoutubeTrailerCutoffSeconds(100), 78);
  assert.equal(getYoutubeTrailerCutoffSeconds(200), 178);
  assert.equal(getYoutubeTrailerCutoffSeconds(0), null);
  assert.equal(getYoutubeTrailerCutoffSeconds(-1), null);
  assert.equal(getYoutubeTrailerCutoffSeconds(Number.NaN), null);
  assert.equal(getYoutubeTrailerCutoffSeconds(Number.POSITIVE_INFINITY), null);
});

void test("official API player starts silent after ready, with its actual host origin", () => {
  const result = new URL(
    buildYoutubeTrailerEmbedUrl(
      "trailer-a",
      "https://filmklubb.example",
      false,
    ),
  );
  assert.equal(result.searchParams.get("autoplay"), "0");
  assert.equal(result.searchParams.get("mute"), "1");
  assert.equal(result.searchParams.get("origin"), "https://filmklubb.example");
  assert.equal(result.origin, "https://www.youtube-nocookie.com");
});
