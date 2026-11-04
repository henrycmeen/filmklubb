import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type HlsType from "hls.js";
import {
  APPLE_TRAILER_STARTUP_TIMEOUT_MS,
  chooseHlsPlayback,
  isAppleWebKitBrowser,
  readVideoSample,
} from "@/lib/appleTrailerPlayback";
import type { YoutubeTrailerControls } from "@/components/YoutubeTrailerPlayer";
import type { YoutubePlayerSample } from "@/lib/youtubePlayerApi";

interface Props {
  hlsUrl: string;
  title: string;
  className?: string;
  hidden: boolean;
  startSeconds: number;
  onSample: (sample: YoutubePlayerSample) => void;
  onBlocked: () => void;
  onError: () => void;
}

// A muted <video> on the page itself. Unlike the YouTube iframe, a click on
// the TV reaches play() directly, so Safari can always start it.
export const AppleTrailerPlayer = forwardRef<YoutubeTrailerControls, Props>(
  function AppleTrailerPlayer(props, ref) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const requestRef = useRef<() => void>(() => undefined);
    const propsRef = useRef(props);
    propsRef.current = props;

    useImperativeHandle(
      ref,
      () => ({
        playMuted: () => requestRef.current(),
        seekTo: (seconds) => {
          if (videoRef.current) videoRef.current.currentTime = seconds;
        },
      }),
      [],
    );

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;
      let disposed = false;
      let failed = false;
      let hasStarted = false;
      let isWaiting = false;
      // After a refusal only a click (playMuted) may try again.
      let awaitingGesture = false;
      let hls: HlsType | null = null;
      let visible = true;
      let observer: IntersectionObserver | null = null;
      let startupTimer = 0;
      const startSeconds = propsRef.current.startSeconds;

      const fail = () => {
        if (disposed || failed) return;
        failed = true;
        window.clearTimeout(startupTimer);
        propsRef.current.onError();
      };
      startupTimer = window.setTimeout(fail, APPLE_TRAILER_STARTUP_TIMEOUT_MS);

      const sample = () => {
        if (disposed || failed) return;
        const value = readVideoSample(video, hasStarted, isWaiting);
        if (value) propsRef.current.onSample(value);
      };
      const request = () => {
        if (disposed || failed) return;
        video.muted = true;
        const attempt = video.play();
        void attempt?.catch((error: unknown) => {
          if (disposed || failed) return;
          if (
            error instanceof DOMException &&
            error.name === "NotAllowedError" &&
            !awaitingGesture
          ) {
            // Blocked is not broken: wait for a click instead of falling back.
            awaitingGesture = true;
            window.clearTimeout(startupTimer);
            propsRef.current.onBlocked();
          }
        });
      };
      requestRef.current = request;

      const onPlaying = () => {
        isWaiting = false;
        awaitingGesture = false;
        if (!hasStarted && video.currentTime > 0) {
          hasStarted = true;
          window.clearTimeout(startupTimer);
        }
        sample();
      };
      const onTimeUpdate = () => {
        if (!hasStarted && !video.paused && video.currentTime > 0) {
          hasStarted = true;
          window.clearTimeout(startupTimer);
        }
        sample();
      };
      const onWaiting = () => {
        isWaiting = true;
        sample();
      };
      const onLoadedMetadata = () => {
        // hls.js seeks through startPosition; native playback seeks here.
        if (
          !hls &&
          Number.isFinite(video.duration) &&
          video.duration > startSeconds + 10 &&
          video.currentTime < startSeconds
        ) {
          video.currentTime = startSeconds;
        }
      };
      const listeners: Array<[keyof HTMLVideoElementEventMap, () => void]> = [
        ["playing", onPlaying],
        ["timeupdate", onTimeUpdate],
        ["waiting", onWaiting],
        ["pause", sample],
        ["ended", sample],
        ["loadedmetadata", onLoadedMetadata],
        ["error", fail],
      ];
      for (const [name, listener] of listeners) {
        video.addEventListener(name, listener);
      }
      const poll = window.setInterval(sample, 250);

      const resume = () => {
        if (
          awaitingGesture ||
          !visible ||
          document.visibilityState === "hidden"
        )
          return;
        if (video.paused && !video.ended) request();
      };
      const handleVisibility = () => {
        if (document.visibilityState === "visible") resume();
      };
      document.addEventListener("visibilitychange", handleVisibility);
      window.addEventListener("focus", resume);
      if (typeof IntersectionObserver !== "undefined") {
        observer = new IntersectionObserver(([entry]) => {
          const wasVisible = visible;
          visible = entry?.isIntersecting ?? false;
          if (!wasVisible && visible) resume();
        });
        observer.observe(video);
      }

      const playback = chooseHlsPlayback({
        nativeHls: video.canPlayType("application/vnd.apple.mpegurl") !== "",
        mediaSource:
          typeof window.MediaSource !== "undefined" ||
          "ManagedMediaSource" in window,
        appleWebKit: isAppleWebKitBrowser(navigator.vendor ?? ""),
      });
      if (playback === "native") {
        video.src = propsRef.current.hlsUrl;
        request();
      } else if (playback === "hls.js") {
        void import("hls.js")
          .then(({ default: Hls }) => {
            if (disposed) return;
            if (!Hls.isSupported()) {
              fail();
              return;
            }
            hls = new Hls({
              capLevelToPlayerSize: true,
              maxBufferLength: 20,
              startPosition: startSeconds,
            });
            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (data.fatal) fail();
            });
            hls.on(Hls.Events.MANIFEST_PARSED, request);
            hls.loadSource(propsRef.current.hlsUrl);
            hls.attachMedia(video);
          })
          .catch(fail);
      } else {
        fail();
      }

      return () => {
        disposed = true;
        window.clearTimeout(startupTimer);
        window.clearInterval(poll);
        observer?.disconnect();
        document.removeEventListener("visibilitychange", handleVisibility);
        window.removeEventListener("focus", resume);
        for (const [name, listener] of listeners) {
          video.removeEventListener(name, listener);
        }
        requestRef.current = () => undefined;
        hls?.destroy();
        video.pause();
        video.removeAttribute("src");
        video.load();
      };
    }, [props.hlsUrl]);

    return (
      <video
        ref={videoRef}
        className={props.className}
        aria-hidden={props.hidden || undefined}
        aria-label={`Trailer for ${props.title}`}
        tabIndex={-1}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
      />
    );
  },
);
