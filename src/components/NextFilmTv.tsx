import { useCallback, useEffect, useRef, useState } from "react";
import type { FilmProgramMovie } from "@/components/filmClubProgramData";
import { withBasePath } from "@/lib/basePath";
import {
  buildYoutubeTrailerEmbedUrl,
  getYoutubePlaybackProgress,
  getYoutubeDuration,
  getYoutubeTrailerCutoffSeconds,
  isYoutubeAutoplayBlockedMessage,
  isYoutubeBufferingMessage,
  isYoutubeEndedMessage,
  isYoutubeErrorMessage,
  isYoutubePausedMessage,
  isYoutubePlayingMessage,
  isYoutubeReadyMessage,
  YOUTUBE_TRAILER_LOOP_START_SECONDS,
} from "@/lib/youtubeEmbed";
import {
  advanceTvPhase,
  buildTvPlayerKey,
  getNextFilmTvView,
  getTvRevealDelay,
  getYoutubePlaybackAction,
  TV_TRANSITION_TIMING,
  type TvPhase,
  type YoutubeTvPlaybackSignal,
} from "@/lib/tvTransition";
import styles from "@/styles/filmClubProgram.module.css";

type NextFilmMovie = Pick<FilmProgramMovie, "id" | "title" | "coverImage"> & {
  trailerYoutubeId?: string | null;
};

interface NextFilmTvProps {
  movie: NextFilmMovie | null;
}

interface ReadyNextFilmTvProps {
  movie: NextFilmMovie;
}

interface TrailerState {
  movieId: number;
  youtubeId: string | null;
}

interface DisplayedTrailer {
  coverImage: string;
  movieId: number;
  title: string;
  youtubeId: string | null;
}

const MAX_STABLE_PROGRESS_AGE_MS = 1_500;
const PLAYBACK_WATCHDOG_GRACE_MS = 4_000;

const TvStaticNoise = ({ poweringOn = false }: { poweringOn?: boolean }) => (
  <span
    className={`${styles.nextTvStatic} ${
      poweringOn ? styles.nextTvStaticPoweringOn : ""
    }`}
    aria-hidden="true"
  >
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img
      className={styles.nextTvStaticGrain}
      src={withBasePath("/VHS/program/analog-no-signal-frame.avif")}
      alt=""
      draggable={false}
    />
    <span className={styles.nextTvSyncTear} />
  </span>
);

export const StaticFilmTv = () => (
  <div
    className={`${styles.nextTv} ${styles.nextTvNoSignal}`}
    role="img"
    aria-label="TV med skurring"
  >
    <div className={styles.nextTvScreen}>
      <TvStaticNoise />
      <span className={styles.nextTvShield} aria-hidden="true" />
      <span className={styles.nextTvGlow} aria-hidden="true" />
    </div>
  </div>
);

const EmptyNextFilmTv = () => {
  const [isTuning, setIsTuning] = useState(true);

  useEffect(() => {
    const delay = getTvRevealDelay(null, "emptyReady");
    if (delay === null) {
      return;
    }

    const revealTimer = window.setTimeout(() => setIsTuning(false), delay);
    return () => window.clearTimeout(revealTimer);
  }, []);

  return (
    <div
      className={styles.nextTv}
      aria-busy={isTuning || undefined}
      aria-label={
        isTuning
          ? "Henter filmen som leder avstemningen"
          : "Ingen film leder avstemningen ennå"
      }
    >
      <div className={styles.nextTvScreen}>
        {isTuning ? <TvStaticNoise /> : null}
        <span className={styles.nextTvShield} aria-hidden="true" />
        <span className={styles.nextTvGlow} aria-hidden="true" />
      </div>
    </div>
  );
};

const BootingNextFilmTv = () => (
  <div className={styles.nextTv} aria-busy="true" aria-label="Slår på TV-en">
    <div className={styles.nextTvScreen}>
      <TvStaticNoise poweringOn />
      <span className={styles.nextTvSignalLock} aria-hidden="true" />
      <span className={styles.nextTvPowerOnFlash} aria-hidden="true" />
      <span className={styles.nextTvShield} aria-hidden="true" />
      <span className={styles.nextTvGlow} aria-hidden="true" />
    </div>
  </div>
);

const ReadyNextFilmTv = ({ movie }: ReadyNextFilmTvProps) => {
  const [trailer, setTrailer] = useState<TrailerState>({
    movieId: movie.id,
    youtubeId: movie.trailerYoutubeId ?? null,
  });
  const [displayed, setDisplayed] = useState<DisplayedTrailer>({
    coverImage: movie.coverImage,
    movieId: movie.id,
    title: movie.title,
    youtubeId: movie.trailerYoutubeId ?? null,
  });
  const [phase, setPhase] = useState<TvPhase>("tuning");
  const [playerGeneration, setPlayerGeneration] = useState(0);
  const [usePosterFallback, setUsePosterFallback] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const blockedTrailerTimer = useRef<number | null>(null);
  const phaseRef = useRef<TvPhase>("tuning");
  const revealTimer = useRef<number | null>(null);
  const phaseTimer = useRef<number | null>(null);
  const previousMovieId = useRef(movie.id);
  const restartPending = useRef(false);
  const posterFallbackRef = useRef(false);
  const playbackSignalRef = useRef<YoutubeTvPlaybackSignal | null>(null);
  const playbackCandidateStartedAt = useRef<number | null>(null);
  const lastPlaybackTime = useRef<number | null>(null);
  const lastPlaybackProgressAt = useRef<number | null>(null);
  const hasPlaybackAdvanced = useRef(false);
  const knownDuration = useRef<number | null>(null);
  const captionsDisableRequested = useRef(false);

  const setTvPhase = useCallback((nextPhase: TvPhase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const resetPlaybackCandidate = useCallback(() => {
    playbackSignalRef.current = null;
    playbackCandidateStartedAt.current = null;
    lastPlaybackTime.current = null;
    lastPlaybackProgressAt.current = null;
    hasPlaybackAdvanced.current = false;
  }, []);

  const clearRevealTimer = useCallback(() => {
    if (revealTimer.current !== null) {
      window.clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }
  }, []);

  const clearPhaseTimer = useCallback(() => {
    if (phaseTimer.current !== null) {
      window.clearTimeout(phaseTimer.current);
      phaseTimer.current = null;
    }
  }, []);

  const clearBlockedTrailerTimer = useCallback(() => {
    if (blockedTrailerTimer.current !== null) {
      window.clearTimeout(blockedTrailerTimer.current);
      blockedTrailerTimer.current = null;
    }
  }, []);

  const returnTrailerToTuning = useCallback(() => {
    if (phaseRef.current === "poweringOff" || posterFallbackRef.current) {
      return;
    }

    clearRevealTimer();
    clearPhaseTimer();
    resetPlaybackCandidate();
    setTvPhase("tuning");
  }, [clearPhaseTimer, clearRevealTimer, resetPlaybackCandidate, setTvPhase]);

  const isPlaybackStable = useCallback(() => {
    const progressAt = lastPlaybackProgressAt.current;
    return (
      playbackSignalRef.current === "playing" &&
      hasPlaybackAdvanced.current &&
      progressAt !== null &&
      Date.now() - progressAt <= MAX_STABLE_PROGRESS_AGE_MS
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setTrailer({
      movieId: movie.id,
      youtubeId: movie.trailerYoutubeId ?? null,
    });

    if (movie.trailerYoutubeId) {
      return () => controller.abort();
    }

    const loadTrailer = async () => {
      try {
        const params = new URLSearchParams({ movieId: String(movie.id) });
        const response = await fetch(
          withBasePath(`/api/tmdb/trailer?${params.toString()}`),
          { signal: controller.signal },
        );
        if (!response.ok) {
          return;
        }

        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object") {
          return;
        }

        const youtubeId = (payload as { youtubeId?: unknown }).youtubeId;
        if (typeof youtubeId === "string" || youtubeId === null) {
          setTrailer({ movieId: movie.id, youtubeId });
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    };

    void loadTrailer();
    return () => controller.abort();
  }, [movie.id, movie.trailerYoutubeId]);

  const youtubeId =
    trailer.movieId === movie.id
      ? trailer.youtubeId
      : (movie.trailerYoutubeId ?? null);

  useEffect(() => {
    restartPending.current = false;
    knownDuration.current = null;
    captionsDisableRequested.current = false;
  }, [displayed.youtubeId, playerGeneration]);

  const pendingDisplay = useRef<DisplayedTrailer>({
    coverImage: movie.coverImage,
    movieId: movie.id,
    title: movie.title,
    youtubeId,
  });
  pendingDisplay.current = {
    coverImage: movie.coverImage,
    movieId: movie.id,
    title: movie.title,
    youtubeId,
  };

  useEffect(() => {
    if (previousMovieId.current !== movie.id) {
      previousMovieId.current = movie.id;

      clearRevealTimer();
      clearPhaseTimer();
      clearBlockedTrailerTimer();
      resetPlaybackCandidate();

      posterFallbackRef.current = false;
      setUsePosterFallback(false);
      setTvPhase(advanceTvPhase(phaseRef.current, "movieChanged"));
      phaseTimer.current = window.setTimeout(() => {
        setDisplayed(pendingDisplay.current);
        setPlayerGeneration((generation) => generation + 1);
        setTvPhase(advanceTvPhase(phaseRef.current, "powerOffFinished"));
        phaseTimer.current = null;
      }, TV_TRANSITION_TIMING.powerOffMs);
      return;
    }

    if (displayed.movieId === movie.id && displayed.youtubeId !== youtubeId) {
      clearRevealTimer();
      clearPhaseTimer();
      clearBlockedTrailerTimer();
      resetPlaybackCandidate();
      posterFallbackRef.current = false;
      setUsePosterFallback(false);
      setDisplayed(pendingDisplay.current);
      setPlayerGeneration((generation) => generation + 1);
      setTvPhase("tuning");
    }
  }, [
    clearBlockedTrailerTimer,
    clearPhaseTimer,
    clearRevealTimer,
    displayed.movieId,
    displayed.youtubeId,
    movie.id,
    resetPlaybackCandidate,
    setTvPhase,
    youtubeId,
  ]);

  useEffect(() => {
    return () => {
      clearRevealTimer();
      clearPhaseTimer();
      clearBlockedTrailerTimer();
    };
  }, [clearBlockedTrailerTimer, clearPhaseTimer, clearRevealTimer]);

  useEffect(() => {
    if (phase !== "poweringOn") {
      return;
    }

    const powerOnTimer = window.setTimeout(() => {
      if (phaseRef.current === "poweringOn") {
        setTvPhase(advanceTvPhase(phaseRef.current, "powerOnFinished"));
      }
    }, TV_TRANSITION_TIMING.powerOnMs);

    return () => window.clearTimeout(powerOnTimer);
  }, [phase, setTvPhase]);

  const revealPicture = useCallback(
    (delay: number, requireStablePlayback = false) => {
      if (phaseRef.current !== "tuning") {
        return;
      }

      if (revealTimer.current !== null) {
        return;
      }

      revealTimer.current = window.setTimeout(() => {
        revealTimer.current = null;
        if (phaseRef.current !== "tuning") {
          return;
        }
        if (requireStablePlayback && !isPlaybackStable()) {
          return;
        }

        clearBlockedTrailerTimer();
        setTvPhase(advanceTvPhase(phaseRef.current, "signalReady"));
      }, delay);
    },
    [clearBlockedTrailerTimer, isPlaybackStable, setTvPhase],
  );

  const revealPosterFallback = useCallback(() => {
    if (phaseRef.current === "poweringOff" || posterFallbackRef.current) {
      return;
    }

    clearRevealTimer();
    clearPhaseTimer();
    clearBlockedTrailerTimer();
    resetPlaybackCandidate();
    posterFallbackRef.current = true;
    setUsePosterFallback(true);
    setTvPhase("tuning");
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func: "pauseVideo", args: [] }),
      "https://www.youtube-nocookie.com",
    );
    revealPicture(TV_TRANSITION_TIMING.posterSignalHoldMs);
  }, [
    clearBlockedTrailerTimer,
    clearPhaseTimer,
    clearRevealTimer,
    resetPlaybackCandidate,
    revealPicture,
    setTvPhase,
  ]);

  useEffect(() => {
    if (phase === "tuning" && !displayed.youtubeId) {
      const delay = getTvRevealDelay(displayed.youtubeId, "posterReady");
      if (delay !== null) {
        revealPicture(delay);
      }
    }
  }, [displayed.youtubeId, phase, revealPicture]);

  const postYoutubeCommand = useCallback(
    (func: string, args: unknown[] = []) => {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func, args }),
        "https://www.youtube-nocookie.com",
      );
    },
    [],
  );

  const prepareTrailerPlayback = useCallback(() => {
    if (!displayed.youtubeId) {
      return;
    }

    const playerWindow = iframeRef.current?.contentWindow;
    if (playerWindow) {
      playerWindow.postMessage(
        JSON.stringify({
          channel: "filmklubb-tv",
          event: "listening",
          id: "filmklubb-tv",
        }),
        "https://www.youtube-nocookie.com",
      );
      for (const eventName of [
        "onStateChange",
        "onReady",
        "onAutoplayBlocked",
        "onError",
        "onApiChange",
      ]) {
        postYoutubeCommand("addEventListener", [eventName]);
      }
      postYoutubeCommand("mute");
      postYoutubeCommand("playVideo");
    }

    // Keep the no-signal layer visible until YouTube confirms playback.
    // If Safari blocks a muted attempt, the player is remounted and retried
    // automatically behind the TV treatment.
  }, [displayed.youtubeId, postYoutubeCommand]);

  const retryTrailerPlayback = useCallback(() => {
    if (!displayed.youtubeId) {
      return;
    }

    clearRevealTimer();
    clearPhaseTimer();
    clearBlockedTrailerTimer();
    resetPlaybackCandidate();
    posterFallbackRef.current = false;
    setUsePosterFallback(false);
    setPlayerGeneration((generation) => generation + 1);
    setTvPhase("tuning");
  }, [
    clearBlockedTrailerTimer,
    clearPhaseTimer,
    clearRevealTimer,
    displayed.youtubeId,
    resetPlaybackCandidate,
    setTvPhase,
  ]);

  useEffect(() => {
    if (!usePosterFallback || phase !== "playing" || !displayed.youtubeId) {
      return;
    }

    const retryTimer = window.setTimeout(
      retryTrailerPlayback,
      TV_TRANSITION_TIMING.posterRetryMs,
    );
    return () => window.clearTimeout(retryTimer);
  }, [displayed.youtubeId, phase, retryTrailerPlayback, usePosterFallback]);

  useEffect(() => {
    if (phase !== "tuning" || !displayed.youtubeId || usePosterFallback) {
      return;
    }

    blockedTrailerTimer.current = window.setTimeout(() => {
      blockedTrailerTimer.current = null;
      revealPosterFallback();
    }, TV_TRANSITION_TIMING.blockedTrailerFallbackMs);

    return () => {
      if (blockedTrailerTimer.current !== null) {
        window.clearTimeout(blockedTrailerTimer.current);
        blockedTrailerTimer.current = null;
      }
    };
  }, [displayed.youtubeId, phase, revealPosterFallback, usePosterFallback]);

  const restartTrailer = useCallback(() => {
    if (restartPending.current || posterFallbackRef.current) {
      return;
    }
    restartPending.current = true;
    // Hide the old picture before seeking, including delayed end-state frames.
    returnTrailerToTuning();
    postYoutubeCommand("seekTo", [YOUTUBE_TRAILER_LOOP_START_SECONDS, true]);
    postYoutubeCommand("playVideo");
  }, [postYoutubeCommand, returnTrailerToTuning]);

  useEffect(() => {
    const handleYoutubeMessage = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== "https://www.youtube-nocookie.com" ||
        event.source !== iframeRef.current?.contentWindow
      ) {
        return;
      }

      let payload = event.data;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload) as unknown;
        } catch {
          return;
        }
      }

      const duration = getYoutubeDuration(payload);
      if (duration !== null) knownDuration.current = duration;

      // cc_load_policy=0 still permits the viewer's saved caption preference.
      // Module unloading is best effort: YouTube does not guarantee an off switch.
      if (
        payload &&
        typeof payload === "object" &&
        (payload as { event?: unknown }).event === "onApiChange" &&
        !captionsDisableRequested.current
      ) {
        captionsDisableRequested.current = true;
        postYoutubeCommand("setOption", ["captions", "track", {}]);
        postYoutubeCommand("unloadModule", ["captions"]);
      }

      if (isYoutubeReadyMessage(payload)) {
        postYoutubeCommand("setOption", ["captions", "track", {}]);
        postYoutubeCommand("unloadModule", ["captions"]);
        postYoutubeCommand("mute");
        postYoutubeCommand("playVideo");
        return;
      }

      if (
        isYoutubeAutoplayBlockedMessage(payload) ||
        isYoutubeErrorMessage(payload)
      ) {
        revealPosterFallback();
        return;
      }

      const playbackSignal = isYoutubePlayingMessage(payload)
        ? "playing"
        : isYoutubePausedMessage(payload)
          ? "paused"
          : isYoutubeBufferingMessage(payload)
            ? "buffering"
            : null;

      if (playbackSignal !== null) {
        const action = getYoutubePlaybackAction(
          phaseRef.current,
          posterFallbackRef.current,
          playbackSignal,
        );

        if (action === "startStabilityCheck") {
          if (playbackSignalRef.current !== "playing") {
            playbackCandidateStartedAt.current = Date.now();
            lastPlaybackTime.current = null;
            lastPlaybackProgressAt.current = null;
            hasPlaybackAdvanced.current = false;
          }
          playbackSignalRef.current = "playing";
        } else if (action === "cancelPendingReveal") {
          clearRevealTimer();
          resetPlaybackCandidate();
        } else if (action === "showPosterFallback") {
          if (restartPending.current) {
            returnTrailerToTuning();
          } else {
            revealPosterFallback();
          }
          return;
        } else if (playbackSignal === "playing") {
          playbackSignalRef.current = "playing";
        }
      }

      const progress = getYoutubePlaybackProgress(
        payload,
        knownDuration.current,
      );
      if (progress && playbackSignalRef.current === "playing") {
        const now = Date.now();
        const previousTime = lastPlaybackTime.current;
        lastPlaybackTime.current = progress.currentTime;
        lastPlaybackProgressAt.current = now;

        if (
          previousTime !== null &&
          progress.currentTime > previousTime + 0.01
        ) {
          hasPlaybackAdvanced.current = true;

          if (phaseRef.current === "tuning" && !posterFallbackRef.current) {
            const fullDelay = getTvRevealDelay(
              displayed.youtubeId,
              "youtubePlaying",
            );
            const candidateStartedAt = playbackCandidateStartedAt.current;
            if (fullDelay !== null && candidateStartedAt !== null) {
              revealPicture(
                Math.max(0, fullDelay - (now - candidateStartedAt)),
                true,
              );
            }
          }
        }
      }

      if (progress && progress.currentTime < progress.duration * 0.1) {
        restartPending.current = false;
      }

      const cutoff = getYoutubeTrailerCutoffSeconds(knownDuration.current ?? 0);
      if (
        (progress !== null &&
          cutoff !== null &&
          progress.currentTime >= cutoff) ||
        isYoutubeEndedMessage(payload)
      ) {
        restartTrailer();
      }
    };

    window.addEventListener("message", handleYoutubeMessage);
    return () => window.removeEventListener("message", handleYoutubeMessage);
  }, [
    clearPhaseTimer,
    clearRevealTimer,
    displayed.youtubeId,
    postYoutubeCommand,
    restartTrailer,
    resetPlaybackCandidate,
    revealPicture,
    revealPosterFallback,
    returnTrailerToTuning,
    setTvPhase,
  ]);

  useEffect(() => {
    if (phase !== "playing" || !displayed.youtubeId || usePosterFallback) {
      return;
    }

    const watchdog = window.setInterval(() => {
      const progressAt = lastPlaybackProgressAt.current;
      const time = lastPlaybackTime.current;
      const cutoff = getYoutubeTrailerCutoffSeconds(knownDuration.current ?? 0);
      // Bridge gaps between player messages, but never extrapolate stalled playback.
      if (
        progressAt !== null &&
        time !== null &&
        cutoff !== null &&
        playbackSignalRef.current === "playing" &&
        Date.now() - progressAt <= MAX_STABLE_PROGRESS_AGE_MS &&
        time + (Date.now() - progressAt) / 1000 >= cutoff
      ) {
        restartTrailer();
        return;
      }
      if (
        progressAt === null ||
        Date.now() - progressAt > PLAYBACK_WATCHDOG_GRACE_MS
      ) {
        returnTrailerToTuning();
      }
    }, 250);

    return () => window.clearInterval(watchdog);
  }, [
    displayed.youtubeId,
    phase,
    restartTrailer,
    returnTrailerToTuning,
    usePosterFallback,
  ]);

  const pictureClassName = `${styles.nextTvPicture} ${
    phase === "poweringOff"
      ? styles.nextTvPicturePoweringOff
      : phase === "poweringOn"
        ? styles.nextTvPicturePoweringOn
        : phase === "playing"
          ? styles.nextTvPicturePlaying
          : styles.nextTvPictureTuning
  }`;
  const screenClassName = `${styles.nextTvScreen} ${
    usePosterFallback ? styles.nextTvScreenFallback : ""
  }`;

  return (
    <div className={styles.nextTv} aria-label={`Trailer for ${movie.title}`}>
      <div className={screenClassName}>
        <div className={pictureClassName}>
          {displayed.youtubeId ? (
            <iframe
              key={buildTvPlayerKey(displayed.youtubeId, playerGeneration)}
              ref={iframeRef}
              className={styles.nextTvVideo}
              src={buildYoutubeTrailerEmbedUrl(displayed.youtubeId)}
              title={`Trailer for ${displayed.title}`}
              aria-hidden={usePosterFallback || undefined}
              allow="autoplay; encrypted-media"
              referrerPolicy="strict-origin-when-cross-origin"
              loading="eager"
              tabIndex={-1}
              onLoad={prepareTrailerPlayback}
            />
          ) : null}
          {!displayed.youtubeId || usePosterFallback ? (
            <>
              <span
                className={styles.nextTvPosterBackdrop}
                aria-hidden="true"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className={styles.nextTvPoster}
                src={withBasePath(displayed.coverImage)}
                alt=""
                draggable={false}
              />
            </>
          ) : null}
        </div>
        {phase === "tuning" || phase === "poweringOn" ? (
          <TvStaticNoise poweringOn={phase === "poweringOn"} />
        ) : null}
        {phase === "poweringOn" ? (
          <>
            <span className={styles.nextTvSignalLock} aria-hidden="true" />
            <span className={styles.nextTvPowerOnFlash} aria-hidden="true" />
          </>
        ) : null}
        {phase === "poweringOff" ? (
          <span className={styles.nextTvPowerOffFlash} aria-hidden="true" />
        ) : null}
        <span className={styles.nextTvShield} aria-hidden="true" />
        <span className={styles.nextTvGlow} aria-hidden="true" />
      </div>
    </div>
  );
};

export const NextFilmTv = ({ movie }: NextFilmTvProps) => {
  const [hasCompletedInitialPowerOn, setHasCompletedInitialPowerOn] =
    useState(false);

  useEffect(() => {
    const powerOnTimer = window.setTimeout(
      () => setHasCompletedInitialPowerOn(true),
      TV_TRANSITION_TIMING.powerOnMs,
    );
    return () => window.clearTimeout(powerOnTimer);
  }, []);

  const view = getNextFilmTvView(hasCompletedInitialPowerOn, movie !== null);

  if (view === "booting") {
    return <BootingNextFilmTv />;
  }

  if (view === "ready" && movie) {
    return <ReadyNextFilmTv movie={movie} />;
  }

  return <EmptyNextFilmTv />;
};
