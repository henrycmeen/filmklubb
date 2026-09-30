import { useCallback, useEffect, useRef, useState } from "react";
import type { FilmProgramMovie } from "@/components/filmClubProgramData";
import { withBasePath } from "@/lib/basePath";
import {
  getYoutubeTrailerCutoffSeconds,
  YOUTUBE_TRAILER_LOOP_START_SECONDS,
} from "@/lib/youtubeEmbed";
import {
  YoutubeTrailerPlayer,
  type YoutubeTrailerControls,
} from "@/components/YoutubeTrailerPlayer";
import {
  observeYoutubeProgress,
  shouldRecoverYoutubePoster,
  type YoutubePlayerSample,
} from "@/lib/youtubePlayerApi";
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
import { getYoutubePlaybackCandidateStart } from "@/lib/youtubeRecovery";
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
      src={withBasePath("/VHS/program/analog-no-signal-frame.webp")}
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
  const playerRef = useRef<YoutubeTrailerControls | null>(null);
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
  const lastPlayerSampleTime = useRef<number | null>(null);
  const lastPlaybackProgressAt = useRef<number | null>(null);
  const hasPlaybackAdvanced = useRef(false);
  const knownDuration = useRef<number | null>(null);
  const retryableFailureRef = useRef(false);
  const autoplayBlockedRef = useRef(false);
  const manualPlaybackRequestedRef = useRef(false);
  const [needsPlaybackGesture, setNeedsPlaybackGesture] = useState(false);

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
    lastPlayerSampleTime.current = null;
  }, [displayed.youtubeId, playerGeneration]);

  useEffect(() => {
    manualPlaybackRequestedRef.current = false;
    retryableFailureRef.current = false;
    autoplayBlockedRef.current = false;
    setNeedsPlaybackGesture(false);
  }, [displayed.movieId, displayed.youtubeId]);

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
    if (phaseRef.current === "poweringOff") return;
    manualPlaybackRequestedRef.current = false;
    setNeedsPlaybackGesture(true);
    if (posterFallbackRef.current) return;

    clearRevealTimer();
    clearPhaseTimer();
    clearBlockedTrailerTimer();
    resetPlaybackCandidate();
    posterFallbackRef.current = true;
    setUsePosterFallback(true);
    setTvPhase("tuning");
  }, [
    clearBlockedTrailerTimer,
    clearPhaseTimer,
    clearRevealTimer,
    resetPlaybackCandidate,
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

  const prepareTrailerPlayback = useCallback(() => {
    playerRef.current?.playMuted();
  }, []);

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
    playerRef.current?.seekTo(YOUTUBE_TRAILER_LOOP_START_SECONDS);
    playerRef.current?.playMuted();
  }, [returnTrailerToTuning]);

  const handleTrailerBlocked = useCallback(() => {
    autoplayBlockedRef.current = true;
    retryableFailureRef.current = false;
    setNeedsPlaybackGesture(true);
    revealPosterFallback();
  }, [revealPosterFallback]);

  const handleTrailerError = useCallback(() => {
    retryableFailureRef.current = true;
    revealPosterFallback();
  }, [revealPosterFallback]);

  const handleYoutubeSample = useCallback(
    (sample: YoutubePlayerSample) => {
      if (sample.duration > 0) knownDuration.current = sample.duration;
      const playbackSignal =
        sample.state === 1
          ? "playing"
          : sample.state === 2
            ? "paused"
            : sample.state === 3
              ? "buffering"
              : null;

      const canRecoverPoster = shouldRecoverYoutubePoster(
        sample.state,
        lastPlayerSampleTime.current,
        sample.currentTime,
        manualPlaybackRequestedRef.current,
      );
      // This history survives poster fallback and candidate resets so a cached
      // PLAYING state cannot turn a frozen frame into another tuning cycle.
      lastPlayerSampleTime.current = sample.currentTime;
      if (canRecoverPoster && posterFallbackRef.current) {
        clearRevealTimer();
        posterFallbackRef.current = false;
        autoplayBlockedRef.current = false;
        retryableFailureRef.current = false;
        setNeedsPlaybackGesture(false);
        setUsePosterFallback(false);
        resetPlaybackCandidate();
        setTvPhase("tuning");
      }

      if (playbackSignal !== null) {
        const action = getYoutubePlaybackAction(
          phaseRef.current,
          posterFallbackRef.current,
          playbackSignal,
        );
        if (action === "startStabilityCheck") {
          const candidateStart = getYoutubePlaybackCandidateStart(
            playbackSignalRef.current,
            playbackCandidateStartedAt.current,
            Date.now(),
          );
          if (playbackCandidateStartedAt.current !== candidateStart) {
            playbackCandidateStartedAt.current = candidateStart;
            lastPlaybackTime.current = null;
            lastPlaybackProgressAt.current = null;
            hasPlaybackAdvanced.current = false;
          }
          playbackSignalRef.current = "playing";
        } else if (action === "cancelPendingReveal") {
          clearRevealTimer();
          resetPlaybackCandidate();
        } else if (action === "showPosterFallback") {
          if (restartPending.current) returnTrailerToTuning();
          else revealPosterFallback();
          return;
        } else if (
          playbackSignal === "playing" &&
          phaseRef.current !== "poweringOff"
        ) {
          playbackCandidateStartedAt.current = getYoutubePlaybackCandidateStart(
            playbackSignalRef.current,
            playbackCandidateStartedAt.current,
            Date.now(),
          );
          playbackSignalRef.current = "playing";
        }
      }

      if (
        playbackSignalRef.current === "playing" &&
        !posterFallbackRef.current
      ) {
        const now = Date.now();
        const previousTime = lastPlaybackTime.current;
        lastPlaybackTime.current = sample.currentTime;
        const observation = observeYoutubeProgress(
          previousTime,
          lastPlaybackProgressAt.current,
          sample.currentTime,
          now,
        );
        lastPlaybackProgressAt.current = observation.lastAdvancedAt;
        if (observation.advanced) {
          hasPlaybackAdvanced.current = true;
          if (phaseRef.current === "tuning") {
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

      const duration = knownDuration.current ?? 0;
      if (duration > 0 && sample.currentTime < duration * 0.1)
        restartPending.current = false;
      const cutoff = getYoutubeTrailerCutoffSeconds(duration);
      if (
        (cutoff !== null && sample.currentTime >= cutoff) ||
        sample.state === 0
      )
        restartTrailer();
    },
    [
      clearRevealTimer,
      displayed.youtubeId,
      resetPlaybackCandidate,
      restartTrailer,
      revealPicture,
      revealPosterFallback,
      returnTrailerToTuning,
      setTvPhase,
    ],
  );

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
        revealPosterFallback();
      }
    }, 250);

    return () => window.clearInterval(watchdog);
  }, [
    displayed.youtubeId,
    phase,
    restartTrailer,
    revealPosterFallback,
    usePosterFallback,
  ]);

  const resumeTrailerFromGesture = useCallback(() => {
    if (
      !displayed.youtubeId ||
      phaseRef.current === "poweringOff" ||
      (phaseRef.current === "playing" && !posterFallbackRef.current)
    )
      return;
    manualPlaybackRequestedRef.current = true;
    autoplayBlockedRef.current = false;
    if (retryableFailureRef.current) {
      retryableFailureRef.current = false;
      retryTrailerPlayback();
      return;
    }
    // Preserve the existing iframe and send play directly inside the gesture.
    prepareTrailerPlayback();
  }, [displayed.youtubeId, prepareTrailerPlayback, retryTrailerPlayback]);

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
    <div
      className={styles.nextTv}
      data-tv-phase={phase}
      data-poster-fallback={usePosterFallback}
      role={displayed.youtubeId ? "button" : undefined}
      tabIndex={displayed.youtubeId ? 0 : undefined}
      aria-label={
        needsPlaybackGesture
          ? `Spill trailer for ${movie.title}`
          : `Trailer for ${movie.title}`
      }
      onClick={resumeTrailerFromGesture}
      onKeyDown={(event) => {
        if (
          displayed.youtubeId &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          resumeTrailerFromGesture();
        }
      }}
    >
      <div className={screenClassName}>
        <div className={pictureClassName}>
          {displayed.youtubeId ? (
            <YoutubeTrailerPlayer
              key={buildTvPlayerKey(displayed.youtubeId, playerGeneration)}
              ref={playerRef}
              className={styles.nextTvVideo}
              youtubeId={displayed.youtubeId}
              title={displayed.title}
              hidden={usePosterFallback}
              onSample={handleYoutubeSample}
              onBlocked={handleTrailerBlocked}
              onError={handleTrailerError}
            />
          ) : null}
          {!displayed.youtubeId ? (
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
        {usePosterFallback || phase === "tuning" || phase === "poweringOn" ? (
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
