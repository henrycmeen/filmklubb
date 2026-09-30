export const YOUTUBE_HANDSHAKE_INTERVAL_MS = 250;
export const YOUTUBE_HANDSHAKE_TIMEOUT_MS = 7_000;
export const MAX_YOUTUBE_AUTOMATIC_RETRIES = 2;

export const shouldRetryYoutubeAutomatically = (
  automaticRetries: number,
  autoplayBlocked: boolean,
): boolean =>
  !autoplayBlocked && automaticRetries < MAX_YOUTUBE_AUTOMATIC_RETRIES;

// iframe load is not the player API's ready signal. Repeat the listening
// handshake until the player acknowledges it, without an unbounded timer.
export const startYoutubeHandshake = ({
  send,
  isReady,
  schedule,
  cancel,
}: {
  send: () => void;
  isReady: () => boolean;
  schedule: (callback: () => void, delay: number) => number;
  cancel: (timer: number) => void;
}): (() => void) => {
  let timer: number | null = null;
  let attempts = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
    if (timer !== null) cancel(timer);
    timer = null;
  };
  const attempt = () => {
    timer = null;
    if (stopped || isReady()) return;
    send();
    attempts += 1;
    if (
      attempts * YOUTUBE_HANDSHAKE_INTERVAL_MS <
      YOUTUBE_HANDSHAKE_TIMEOUT_MS
    ) {
      timer = schedule(attempt, YOUTUBE_HANDSHAKE_INTERVAL_MS);
    }
  };
  attempt();
  return stop;
};

// Playing may arrive during the power-on animation, before tuning is allowed
// to create a candidate. A later playing signal must still start that clock.
export const getYoutubePlaybackCandidateStart = (
  previousSignal: string | null,
  startedAt: number | null,
  now: number,
): number =>
  previousSignal === "playing" && startedAt !== null ? startedAt : now;

export const scheduleYoutubeRetry = ({
  isEligible,
  retry,
  schedule,
  cancel,
  delay,
}: {
  isEligible: () => boolean;
  retry: () => void;
  schedule: (callback: () => void, delay: number) => number;
  cancel: (timer: number) => void;
  delay: number;
}): (() => void) => {
  if (!isEligible()) return () => undefined;
  const timer = schedule(() => {
    // Browser policy or a gesture can change while the poster is visible.
    if (isEligible()) retry();
  }, delay);
  return () => cancel(timer);
};
