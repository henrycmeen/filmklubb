import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { VhsCaseArtwork } from "@/components/VhsCaseArtwork";
import { withBasePath } from "@/lib/basePath";
import { combinedFilmCatalogue, legacyFilmIds } from "@/lib/filmCatalogue";
import {
  areVoteSnapshotsEqual,
  getFlipMotion,
  getPublishedVoteTrailerFilmId,
  getVoteCaseState,
  getVoteToggleInteraction,
  isPublishedVoteLeader,
  parseFilmVoteSnapshot,
  shouldApplyVoteSnapshot,
  type FilmVoteClientSnapshot,
  type SlotPosition,
} from "@/lib/filmVoteClient";
import styles from "@/styles/filmClubProgram.module.css";

const FILM_BY_ID = new Map(
  combinedFilmCatalogue.map((film) => [film.id, film]),
);
const TMDB_SCORE_BY_FILM_ID = new Map(
  combinedFilmCatalogue.map((film) => [film.id, film.tmdbVoteAverage]),
);

export type FilmVoteMovie = (typeof combinedFilmCatalogue)[number];

interface FilmVoteWallProps {
  boardId: string;
  candidateIds?: ReadonlyArray<number>;
  onLeaderChange?: (film: FilmVoteMovie | null) => void;
  onRoundClosed?: () => void;
}

interface VoteMutation {
  filmId: number;
  hasVoted: boolean;
}

const createInitialSnapshot = (
  boardId: string,
  candidateFilms: ReadonlyArray<FilmVoteMovie>,
): FilmVoteClientSnapshot => ({
  boardId,
  ranking: candidateFilms.map((film) => ({ filmId: film.id, votes: 0 })),
  revision: 0,
  votedFilmIds: [],
});

export const FilmVoteWall = ({
  boardId,
  candidateIds,
  onLeaderChange,
  onRoundClosed,
}: FilmVoteWallProps) => {
  // The parent polls the round endpoint and may recreate the metadata array on
  // every response. Keep the candidate signature primitive so an unchanged
  // round does not reset the wall or its in-flight polling loop.
  const candidateIdsKey =
    candidateIds === undefined
      ? null
      : Array.from(candidateIds)
          .sort((first, second) => first - second)
          .join(",");
  const candidateIdSet = useMemo(() => {
    if (candidateIdsKey === null) {
      // An omitted candidate list means the unmanaged September round. Keep
      // it pinned to the historical 107-film catalogue even though scheduled
      // rounds may use the seasonal combined lookup below.
      return legacyFilmIds;
    }

    return new Set(
      candidateIdsKey
        .split(",")
        .filter((value) => value.length > 0)
        .map((value) => Number(value)),
    );
  }, [candidateIdsKey]);
  const candidateFilms = useMemo(
    () => combinedFilmCatalogue.filter((film) => candidateIdSet.has(film.id)),
    [candidateIdSet],
  );
  const allowedFilmIds = useMemo(
    () => new Set(candidateFilms.map((film) => film.id)),
    [candidateFilms],
  );
  const [snapshot, setSnapshot] = useState<FilmVoteClientSnapshot>(() =>
    createInitialSnapshot(boardId, candidateFilms),
  );
  const [isAuthoritativeSnapshot, setIsAuthoritativeSnapshot] = useState(false);
  const snapshotRef = useRef(snapshot);
  const activeBoardIdRef = useRef(boardId);
  const itemNodes = useRef(new Map<number, HTMLLIElement>());
  const previousSlots = useRef(new Map<number, SlotPosition>());
  const previousRanks = useRef(new Map<number, number>());
  const runningAnimations = useRef(new Map<number, Animation>());
  const roundClosedRef = useRef(false);
  const pendingFilmIds = useRef(new Set<number>());
  const [pendingVoteStates, setPendingVoteStates] = useState<
    ReadonlyMap<number, boolean>
  >(() => new Map());
  const [suppressedPreviewFilmIds, setSuppressedPreviewFilmIds] = useState<
    ReadonlySet<number>
  >(() => new Set());

  const rankedFilms = useMemo(
    () =>
      snapshot.ranking.flatMap((count) => {
        const film = FILM_BY_ID.get(count.filmId);
        return film ? [{ count, film }] : [];
      }),
    [snapshot.ranking],
  );
  const votedFilmIds = useMemo(
    () => new Set(snapshot.votedFilmIds),
    [snapshot.votedFilmIds],
  );

  const clearSuppressedPreview = useCallback((filmId: number) => {
    setSuppressedPreviewFilmIds((current) => {
      if (!current.has(filmId)) {
        return current;
      }

      const next = new Set(current);
      next.delete(filmId);
      return next;
    });
  }, []);

  const captureCurrentLayout = useCallback(() => {
    previousSlots.current = new Map(
      Array.from(itemNodes.current, ([filmId, node]) => {
        const rect = node.getBoundingClientRect();
        return [filmId, { left: rect.left, top: rect.top }];
      }),
    );
    previousRanks.current = new Map(
      snapshotRef.current.ranking.map(({ filmId }, rank) => [filmId, rank]),
    );
  }, []);

  const applySnapshot = useCallback(
    (candidate: FilmVoteClientSnapshot) => {
      if (
        !shouldApplyVoteSnapshot(
          activeBoardIdRef.current,
          snapshotRef.current,
          candidate,
        )
      ) {
        return;
      }

      if (areVoteSnapshotsEqual(snapshotRef.current, candidate)) {
        setIsAuthoritativeSnapshot(true);
        return;
      }

      captureCurrentLayout();
      snapshotRef.current = candidate;
      setSnapshot(candidate);
      setIsAuthoritativeSnapshot(true);
    },
    [captureCurrentLayout],
  );

  const loadSnapshot = useCallback(
    async (
      voteMutation?: VoteMutation,
      signal?: AbortSignal,
    ): Promise<void> => {
      const query = new URLSearchParams({ boardId });
      const response = await fetch(
        withBasePath(`/api/club/votes?${query.toString()}`),
        voteMutation === undefined
          ? { cache: "no-store", credentials: "same-origin", signal }
          : {
              body: JSON.stringify(voteMutation),
              cache: "no-store",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              method: "POST",
              signal,
            },
      );
      if (response.status === 409) {
        roundClosedRef.current = true;
        onRoundClosed?.();
        return;
      }
      if (!response.ok) {
        return;
      }

      const parsed = parseFilmVoteSnapshot(
        await response.json(),
        boardId,
        allowedFilmIds,
      );
      if (parsed) {
        applySnapshot(parsed);
      }
    },
    [allowedFilmIds, applySnapshot, boardId, onRoundClosed],
  );

  useEffect(() => {
    const initialSnapshot = createInitialSnapshot(boardId, candidateFilms);
    activeBoardIdRef.current = boardId;
    roundClosedRef.current = false;
    snapshotRef.current = initialSnapshot;
    setSnapshot(initialSnapshot);
    setIsAuthoritativeSnapshot(false);
    pendingFilmIds.current.clear();
    setPendingVoteStates(new Map());
    setSuppressedPreviewFilmIds(new Set());
    let isCancelled = false;
    let pollTimer: number | undefined;
    let pollInFlight = false;
    const controller = new AbortController();

    const refresh = async () => {
      if (pollInFlight || roundClosedRef.current) {
        return;
      }

      pollInFlight = true;
      try {
        await loadSnapshot(undefined, controller.signal);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // Keep the wall usable with its last confirmed ordering.
        }
      } finally {
        pollInFlight = false;
      }
    };

    const poll = async () => {
      await refresh();

      if (!isCancelled && !roundClosedRef.current) {
        pollTimer = window.setTimeout(() => void poll(), 1_500);
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    void poll();
    return () => {
      isCancelled = true;
      controller.abort();
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      if (pollTimer !== undefined) {
        window.clearTimeout(pollTimer);
      }
    };
  }, [boardId, candidateFilms, loadSnapshot]);

  useLayoutEffect(() => {
    const leaderId = getPublishedVoteTrailerFilmId(
      snapshot,
      isAuthoritativeSnapshot,
      TMDB_SCORE_BY_FILM_ID,
    );
    onLeaderChange?.(
      leaderId === null ? null : (FILM_BY_ID.get(leaderId) ?? null),
    );
  }, [isAuthoritativeSnapshot, onLeaderChange, snapshot]);

  useLayoutEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const currentRanks = new Map(
      snapshot.ranking.map(({ filmId }, rank) => [filmId, rank]),
    );

    for (const [filmId, node] of itemNodes.current) {
      runningAnimations.current.get(filmId)?.cancel();
      runningAnimations.current.delete(filmId);
      delete node.dataset.moving;
      const previous = previousSlots.current.get(filmId);
      if (!previous || prefersReducedMotion) {
        continue;
      }

      const rect = node.getBoundingClientRect();
      const rankDelta =
        (previousRanks.current.get(filmId) ?? 0) -
        (currentRanks.get(filmId) ?? 0);
      const motion = getFlipMotion(
        previous,
        { left: rect.left, top: rect.top },
        rankDelta,
      );
      if (!motion) {
        continue;
      }

      node.dataset.moving = "true";
      const overshootX = motion.from.x * -0.025;
      const overshootY = motion.from.y * -0.025;
      const animation = node.animate(
        [
          {
            offset: 0,
            transform: `translate3d(${motion.from.x}px, ${motion.from.y}px, 0) scale(0.985)`,
          },
          {
            offset: 0.78,
            transform: `translate3d(${overshootX}px, ${overshootY}px, 0) scale(1.012)`,
          },
          { offset: 1, transform: "translate3d(0, 0, 0) scale(1)" },
        ],
        {
          delay: motion.delayMs,
          duration: motion.durationMs,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        },
      );
      runningAnimations.current.set(filmId, animation);
      animation.addEventListener(
        "finish",
        () => {
          delete node.dataset.moving;
          runningAnimations.current.delete(filmId);
        },
        { once: true },
      );
    }

    previousSlots.current.clear();
    previousRanks.current.clear();
  }, [snapshot.ranking]);

  const toggleVoteForFilm = async (filmId: number, hasVoted: boolean) => {
    if (roundClosedRef.current || pendingFilmIds.current.has(filmId)) {
      return;
    }

    const { nextHasVoted } = getVoteToggleInteraction(hasVoted);
    pendingFilmIds.current.add(filmId);
    // Let the clicked pose finish before hinting at the reverse action.
    setSuppressedPreviewFilmIds((current) => {
      const next = new Set(current);
      next.add(filmId);
      return next;
    });
    setPendingVoteStates((current) => {
      const next = new Map(current);
      next.set(filmId, nextHasVoted);
      return next;
    });
    try {
      await loadSnapshot({ filmId, hasVoted: nextHasVoted });
    } catch {
      // A failed change returns the case to its last confirmed vote state.
    } finally {
      pendingFilmIds.current.delete(filmId);
      setPendingVoteStates((current) => {
        const next = new Map(current);
        next.delete(filmId);
        return next;
      });
    }
  };

  return (
    <section className={styles.voteWallSection} id="stem">
      <ol
        className={styles.voteGrid}
        aria-busy={!isAuthoritativeSnapshot}
        aria-label="Filmer du kan stemme på"
      >
        {(isAuthoritativeSnapshot ? rankedFilms : []).map(({ film }, index) => {
          const hasVoted = votedFilmIds.has(film.id);
          const displayedHasVoted = pendingVoteStates.get(film.id) ?? hasVoted;
          const isPending = pendingVoteStates.has(film.id);
          const suppressPreview = suppressedPreviewFilmIds.has(film.id);
          const isLeader = isPublishedVoteLeader(
            snapshot,
            isAuthoritativeSnapshot,
            film.id,
          );
          const rank = index + 1;
          const caseState = getVoteCaseState({
            hasVoted: displayedHasVoted,
            isLeader,
          });

          return (
            <li
              key={film.id}
              ref={(node) => {
                if (node) {
                  itemNodes.current.set(film.id, node);
                } else {
                  itemNodes.current.delete(film.id);
                }
              }}
            >
              <button
                className={styles.voteFilm}
                type="button"
                aria-label={
                  displayedHasVoted
                    ? `Fjern stemmen fra ${film.title}. Plass ${rank}.`
                    : `Stem på ${film.title}. Plass ${rank}.`
                }
                aria-busy={isPending || undefined}
                aria-pressed={displayedHasVoted}
                data-case-open={caseState.isOpen}
                data-cassette-position={caseState.cassettePosition}
                data-leader={isLeader}
                data-suppress-preview={suppressPreview || undefined}
                onBlur={() => clearSuppressedPreview(film.id)}
                onClick={() => void toggleVoteForFilm(film.id, hasVoted)}
                onPointerLeave={() => clearSuppressedPreview(film.id)}
              >
                <VhsCaseArtwork
                  coverImage={film.coverImage}
                  title={film.title}
                  eager={index < 30}
                />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
};
