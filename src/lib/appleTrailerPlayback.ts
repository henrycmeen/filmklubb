import type { YoutubePlayerSample } from "@/lib/youtubePlayerApi";

export type HlsPlayback = "native" | "hls.js";

export type TrailerSource =
  | { kind: "apple"; hlsUrl: string }
  | { kind: "youtube"; youtubeId: string };

// A player that has not reported progress by then counts as unavailable, so
// YouTube can take over before the TV gives up on the trailer.
export const APPLE_TRAILER_STARTUP_TIMEOUT_MS = 6_000;
export const APPLE_TRAILER_LOOKUP_TIMEOUT_MS = 5_000;

export const isAppleWebKitBrowser = (vendor: string): boolean =>
  vendor.startsWith("Apple");

// Safari and every iOS browser play HLS natively. Chrome also claims native
// HLS, but Apple's multi-pathway streams stay at readyState 0 there, so other
// browsers use hls.js on Media Source Extensions.
export const chooseHlsPlayback = (support: {
  nativeHls: boolean;
  mediaSource: boolean;
  appleWebKit: boolean;
}): HlsPlayback | null => {
  if (support.nativeHls && (support.appleWebKit || !support.mediaSource)) {
    return "native";
  }
  return support.mediaSource ? "hls.js" : null;
};

// Pending means the Apple lookup has not answered yet. The TV waits in static
// instead of starting YouTube and switching moments later.
export const resolveTrailerSource = (trailer: {
  appleHlsUrl: string | null | undefined;
  appleFailed: boolean;
  youtubeId: string | null;
}): { source: TrailerSource | null; pending: boolean } => {
  if (trailer.appleHlsUrl === undefined) return { source: null, pending: true };
  if (trailer.appleHlsUrl && !trailer.appleFailed) {
    return {
      source: { kind: "apple", hlsUrl: trailer.appleHlsUrl },
      pending: false,
    };
  }
  return trailer.youtubeId
    ? {
        source: { kind: "youtube", youtubeId: trailer.youtubeId },
        pending: false,
      }
    : { source: null, pending: false };
};

export const getTrailerSourceKey = (
  source: TrailerSource | null,
): string | null =>
  source === null
    ? null
    : source.kind === "apple"
      ? `apple:${source.hlsUrl}`
      : `youtube:${source.youtubeId}`;

interface VideoState {
  currentTime: number;
  duration: number;
  ended: boolean;
  paused: boolean;
  readyState: number;
}

// Reports a video element with YouTube's state numbers, so the TV uses one
// state machine for both players: -1 unstarted, 0 ended, 1 playing,
// 2 paused, 3 buffering.
export const readVideoSample = (
  video: VideoState,
  hasStarted: boolean,
  isWaiting: boolean,
): YoutubePlayerSample | null => {
  if (!Number.isFinite(video.currentTime) || video.currentTime < 0) return null;
  const state = video.ended
    ? 0
    : !hasStarted
      ? -1
      : video.paused
        ? 2
        : isWaiting || video.readyState < 3
          ? 3
          : 1;
  return {
    state,
    currentTime: video.currentTime,
    duration:
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : 0,
  };
};
