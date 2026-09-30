export const YOUTUBE_TRAILER_INITIAL_START_SECONDS = 3;
export const YOUTUBE_TRAILER_LOOP_START_SECONDS = 0;

export const buildYoutubeTrailerEmbedUrl = (
  youtubeId: string,
  origin?: string,
  autoplay = true,
): string => {
  const params = new URLSearchParams({
    autoplay: autoplay ? "1" : "0",
    mute: "1",
    start: String(YOUTUBE_TRAILER_INITIAL_START_SECONDS),
    controls: "0",
    loop: "1",
    playlist: youtubeId,
    playsinline: "1",
    rel: "0",
    disablekb: "1",
    fs: "0",
    cc_load_policy: "0",
    iv_load_policy: "3",
    enablejsapi: "1",
  });

  if (origin) params.set("origin", origin);

  return `https://www.youtube-nocookie.com/embed/${youtubeId}?${params.toString()}`;
};

export const isYoutubePlayingMessage = (value: unknown): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as { event?: unknown; info?: unknown };
  if (message.event === "onStateChange") {
    return message.info === 1;
  }

  if (message.event !== "infoDelivery") {
    return false;
  }

  return (
    !!message.info &&
    typeof message.info === "object" &&
    (message.info as { playerState?: unknown }).playerState === 1
  );
};

export const isYoutubePausedMessage = (value: unknown): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as { event?: unknown; info?: unknown };
  if (message.event === "onStateChange") {
    return message.info === 2;
  }

  if (message.event !== "infoDelivery") {
    return false;
  }

  return (
    !!message.info &&
    typeof message.info === "object" &&
    (message.info as { playerState?: unknown }).playerState === 2
  );
};

export const isYoutubeBufferingMessage = (value: unknown): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as { event?: unknown; info?: unknown };
  if (message.event === "onStateChange") {
    return message.info === 3;
  }

  if (message.event !== "infoDelivery") {
    return false;
  }

  return (
    !!message.info &&
    typeof message.info === "object" &&
    (message.info as { playerState?: unknown }).playerState === 3
  );
};

export const isYoutubeAutoplayBlockedMessage = (value: unknown): boolean =>
  !!value &&
  typeof value === "object" &&
  (value as { event?: unknown }).event === "onAutoplayBlocked";

export const isYoutubeErrorMessage = (value: unknown): boolean =>
  !!value &&
  typeof value === "object" &&
  (value as { event?: unknown }).event === "onError";

export const isYoutubeReadyMessage = (value: unknown): boolean =>
  !!value &&
  typeof value === "object" &&
  (value as { event?: unknown }).event === "onReady";

export const isYoutubeEndedMessage = (value: unknown): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as { event?: unknown; info?: unknown };
  if (message.event === "onStateChange") {
    return message.info === 0;
  }

  if (message.event !== "infoDelivery") {
    return false;
  }

  return (
    !!message.info &&
    typeof message.info === "object" &&
    (message.info as { playerState?: unknown }).playerState === 0
  );
};

export interface YoutubePlaybackProgress {
  currentTime: number;
  duration: number;
}

type YoutubeInfo = Record<string, unknown>;

const isYoutubeInfo = (value: unknown): value is YoutubeInfo =>
  !!value && typeof value === "object" && !Array.isArray(value);

const getYoutubeInfo = (
  value: unknown,
  events: readonly string[],
): YoutubeInfo | null => {
  if (!isYoutubeInfo(value) || !events.includes(value.event as string)) {
    return null;
  }

  return isYoutubeInfo(value.info) ? value.info : null;
};

const isValidYoutubeCurrentTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isValidYoutubeDuration = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const firstValidYoutubeNumber = (
  values: readonly unknown[],
  isValid: (value: unknown) => value is number,
): number | null => {
  for (const value of values) {
    if (isValid(value)) {
      return value;
    }
  }

  return null;
};

const getYoutubeProgressFields = (
  value: unknown,
): { currentTime: number | null; duration: number | null } | null => {
  const info = getYoutubeInfo(value, ["infoDelivery"]);
  if (info === null) {
    return null;
  }

  const progressState = isYoutubeInfo(info.progressState)
    ? info.progressState
    : null;

  return {
    currentTime: firstValidYoutubeNumber(
      [info.currentTime, progressState?.current, progressState?.currentTime],
      isValidYoutubeCurrentTime,
    ),
    duration: firstValidYoutubeNumber(
      [info.duration, progressState?.duration],
      isValidYoutubeDuration,
    ),
  };
};

export const getYoutubeDuration = (value: unknown): number | null => {
  const info = getYoutubeInfo(value, ["infoDelivery", "initialDelivery"]);
  if (info === null) {
    return null;
  }

  const progressState = isYoutubeInfo(info.progressState)
    ? info.progressState
    : null;
  return firstValidYoutubeNumber(
    [info.duration, progressState?.duration],
    isValidYoutubeDuration,
  );
};

export const getYoutubePlaybackProgress = (
  value: unknown,
  knownDuration?: number | null,
): YoutubePlaybackProgress | null => {
  const fields = getYoutubeProgressFields(value);
  const currentTime = fields?.currentTime;
  if (currentTime === null || currentTime === undefined) {
    return null;
  }

  const duration =
    fields?.duration ??
    (isValidYoutubeDuration(knownDuration) ? knownDuration : null);
  if (duration === null) {
    return null;
  }

  return { currentTime, duration };
};

export const getYoutubeTrailerCutoffSeconds = (
  duration: number,
): number | null => {
  if (!isValidYoutubeDuration(duration)) {
    return null;
  }

  return Math.min(duration * 0.9, Math.max(duration * 0.5, duration - 22));
};

export const shouldRestartYoutubeTrailer = (
  value: unknown,
  cutoffRatio = 0.9,
): boolean => {
  const progress = getYoutubePlaybackProgress(value);
  if (progress === null) {
    return false;
  }

  const cutoff =
    cutoffRatio === 0.9
      ? getYoutubeTrailerCutoffSeconds(progress.duration)
      : typeof cutoffRatio === "number" &&
          Number.isFinite(cutoffRatio) &&
          cutoffRatio > 0
        ? progress.duration * cutoffRatio
        : null;
  return cutoff !== null && progress.currentTime >= cutoff;
};
