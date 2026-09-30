import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { buildYoutubeTrailerEmbedUrl } from "@/lib/youtubeEmbed";
import {
  createMutedYoutubePlayback,
  loadYoutubeIframeApi,
  readYoutubePlayerSample,
  type YoutubePlayer,
  type YoutubePlayerSample,
} from "@/lib/youtubePlayerApi";

export interface YoutubeTrailerControls {
  playMuted: () => void;
  seekTo: (seconds: number) => void;
}

interface Props {
  youtubeId: string;
  title: string;
  className?: string;
  hidden: boolean;
  onSample: (sample: YoutubePlayerSample) => void;
  onBlocked: () => void;
  onError: () => void;
}

export const YoutubeTrailerPlayer = forwardRef<YoutubeTrailerControls, Props>(
  function YoutubeTrailerPlayer(props, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const playerRef = useRef<YoutubePlayer | null>(null);
    const playbackRef = useRef<ReturnType<
      typeof createMutedYoutubePlayback
    > | null>(null);
    const propsRef = useRef(props);
    propsRef.current = props;
    useImperativeHandle(
      ref,
      () => ({
        playMuted: () => playbackRef.current?.request(),
        seekTo: (seconds) => playerRef.current?.seekTo(seconds, true),
      }),
      [],
    );

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      let disposed = false;
      let ready = false;
      let failed = false;
      let player: YoutubePlayer | null = null;
      let poll: number | null = null;
      let observer: IntersectionObserver | null = null;
      let visible = true;
      const disableCaptions = (target: YoutubePlayer) => {
        // Best effort: YouTube still permits saved caption preferences.
        target.setOption?.("captions", "track", {});
        target.unloadModule?.("captions");
      };
      const fail = () => {
        if (disposed || failed) return;
        failed = true;
        container.dataset.playerError = "true";
        if (poll !== null) window.clearInterval(poll);
        playbackRef.current?.cancel();
        propsRef.current.onError();
      };
      const sample = () => {
        if (disposed || failed || !ready || !player) return;
        try {
          playbackRef.current?.flush();
          const value = readYoutubePlayerSample(player);
          if (value) {
            container.dataset.playerState = String(value.state);
            container.dataset.currentTime = String(value.currentTime);
            if (value.state === 1) container.dataset.autoplayBlocked = "false";
            propsRef.current.onSample(value);
          }
        } catch {
          fail();
        }
      };
      const resume = () => {
        if (
          disposed ||
          !ready ||
          !visible ||
          document.visibilityState === "hidden"
        )
          return;
        playbackRef.current?.request();
        sample();
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
        observer.observe(container);
      }
      void loadYoutubeIframeApi()
        .then((api) => {
          if (disposed) return;
          // React owns only the container. YT.Player may remove its own iframe on
          // destroy without invalidating React's DOM, including StrictMode cleanup.
          const iframe = document.createElement("iframe");
          iframe.src = buildYoutubeTrailerEmbedUrl(
            props.youtubeId,
            window.location.origin,
            false,
          );
          iframe.title = `Trailer for ${props.title}`;
          iframe.allow = "autoplay; encrypted-media";
          iframe.referrerPolicy = "strict-origin-when-cross-origin";
          iframe.tabIndex = -1;
          iframe.style.cssText =
            "border:0;width:100%;height:100%;pointer-events:none;";
          container.appendChild(iframe);
          player = new api.Player(iframe, {
            events: {
              onReady: (event) => {
                if (disposed || failed || ready) return;
                player = event.target;
                playerRef.current = player;
                ready = true;
                container.dataset.playerReady = "true";
                playbackRef.current = createMutedYoutubePlayback(player);
                disableCaptions(player);
                playbackRef.current.request();
                sample();
                poll = window.setInterval(sample, 250);
              },
              onStateChange: () => sample(),
              onAutoplayBlocked: () => {
                if (disposed) return;
                playbackRef.current?.cancel();
                container.dataset.autoplayBlocked = "true";
                propsRef.current.onBlocked();
              },
              onError: fail,
              onApiChange: (event) => {
                if (!disposed) disableCaptions(event.target);
              },
            },
          });
        })
        .catch(fail);
      return () => {
        disposed = true;
        if (poll !== null) window.clearInterval(poll);
        observer?.disconnect();
        document.removeEventListener("visibilitychange", handleVisibility);
        window.removeEventListener("focus", resume);
        playbackRef.current?.cancel();
        playbackRef.current = null;
        playerRef.current = null;
        player?.destroy();
        container.replaceChildren();
      };
    }, [props.youtubeId, props.title]);

    return (
      <div
        ref={containerRef}
        className={props.className}
        aria-hidden={props.hidden || undefined}
        data-player-ready="false"
      />
    );
  },
);
