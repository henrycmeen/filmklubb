import Head from "next/head";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClosedFilmRound } from "@/components/ClosedFilmRound";
import { FilmVoteWall, type FilmVoteMovie } from "@/components/FilmVoteWall";
import { formatFilmDate } from "@/components/filmClubProgramData";
import { NextFilmTv, StaticFilmTv } from "@/components/NextFilmTv";
import { withBasePath } from "@/lib/basePath";
import {
  fetchFilmRoundStatus,
  isFilmRoundAbortError,
  type FilmRoundSnapshot,
} from "@/lib/filmRoundClient";
import {
  getActiveVoteBoardId,
  getFilmClubProgramme,
} from "@/lib/filmClubProgramme";
import styles from "@/styles/filmClubProgram.module.css";

type RoundState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "open";
      boardId: string;
      scheduledAt?: string;
      venue?: string;
      candidateIds?: number[];
    }
  | {
      status: "scheduled";
      boardId: string;
      opensAt: string;
      scheduledAt: string;
      venue?: string;
    }
  | {
      status: "awaiting";
      boardId: string;
      resultsAt: string;
      scheduledAt: string;
      venue?: string;
    }
  | { status: "idle" }
  | { status: "closed"; boardId: string; snapshot: FilmRoundSnapshot };

const INITIAL_ROUND_STATE: RoundState = { status: "loading" };
const ROUND_POLL_INTERVAL_MS = 15_000;

interface ClubProgramHomeProps {
  clubSlug: string;
}

const getScreeningId = (
  value: string | string[] | undefined,
): string | undefined => {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = candidate?.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized;
};

const isDirectResultRequest = (
  value: string | string[] | undefined,
): boolean => {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "1" || candidate?.toLowerCase() === "true";
};

export const ClubProgramHome = ({ clubSlug }: ClubProgramHomeProps) => {
  const router = useRouter();
  const requestedScreeningId = useMemo(
    () => (router.isReady ? getScreeningId(router.query.screening) : undefined),
    [router.isReady, router.query.screening],
  );
  const requestedDirectResult = useMemo(
    () => router.isReady && isDirectResultRequest(router.query.result),
    [router.isReady, router.query.result],
  );
  const programme = getFilmClubProgramme(clubSlug);
  const fallbackBoardId = getActiveVoteBoardId(clubSlug);
  const [roundState, setRoundState] = useState<RoundState>(INITIAL_ROUND_STATE);
  const [leader, setLeader] = useState<FilmVoteMovie | null>(null);
  const roundStateRef = useRef<RoundState>(INITIAL_ROUND_STATE);
  const roundRequestRef = useRef(0);
  const roundAbortRef = useRef<AbortController | null>(null);
  const roundInFlightRef = useRef(false);

  const updateRoundState = useCallback((next: RoundState) => {
    roundStateRef.current = next;
    setRoundState(next);
  }, []);

  const refreshRound = useCallback(
    async ({ force = false, showLoading = false } = {}): Promise<void> => {
      if (roundInFlightRef.current) {
        if (!force) {
          return;
        }
        roundAbortRef.current?.abort();
      }

      roundInFlightRef.current = true;
      const requestId = roundRequestRef.current + 1;
      roundRequestRef.current = requestId;
      const controller = new AbortController();
      roundAbortRef.current = controller;
      if (showLoading) {
        updateRoundState({ status: "loading" });
      }

      try {
        const status = await fetchFilmRoundStatus({
          clubSlug,
          screeningId: requestedScreeningId,
          signal: controller.signal,
        });
        if (
          controller.signal.aborted ||
          requestId !== roundRequestRef.current
        ) {
          return;
        }
        if (status.status === "closed") {
          const previous = roundStateRef.current;
          if (
            previous.status === "closed" &&
            previous.snapshot.snapshotId === status.snapshot.snapshotId
          ) {
            return;
          }
          updateRoundState({
            status: "closed",
            boardId: status.boardId,
            snapshot: status.snapshot,
          });
        } else if (status.status === "open") {
          updateRoundState({
            status: "open",
            boardId: status.boardId,
            ...(status.scheduledAt ? { scheduledAt: status.scheduledAt } : {}),
            ...(status.venue ? { venue: status.venue } : {}),
            ...(status.candidateIds
              ? { candidateIds: status.candidateIds }
              : {}),
          });
        } else if (status.status === "scheduled") {
          updateRoundState({
            status: "scheduled",
            boardId: status.boardId,
            opensAt: status.opensAt,
            scheduledAt: status.scheduledAt,
            ...(status.venue ? { venue: status.venue } : {}),
          });
        } else if (status.status === "awaiting") {
          updateRoundState({
            status: "awaiting",
            boardId: status.boardId,
            resultsAt: status.resultsAt,
            scheduledAt: status.scheduledAt,
            ...(status.venue ? { venue: status.venue } : {}),
          });
        } else {
          // A transition away from a closed round must clear the frozen
          // snapshot so an old result cannot remain visible on the next round.
          updateRoundState({ status: "idle" });
        }
      } catch (error) {
        if (
          controller.signal.aborted ||
          requestId !== roundRequestRef.current ||
          isFilmRoundAbortError(error)
        ) {
          return;
        }
        if (showLoading || roundStateRef.current.status === "loading") {
          updateRoundState({
            status: "error",
            message:
              "Avstemningen kunne ikke hentes. Prøv igjen når forbindelsen er tilbake.",
          });
        }
      } finally {
        if (roundAbortRef.current === controller) {
          roundAbortRef.current = null;
          roundInFlightRef.current = false;
        }
      }
    },
    [clubSlug, requestedScreeningId, updateRoundState],
  );

  useEffect(() => {
    roundAbortRef.current?.abort();
    roundRequestRef.current += 1;
    roundInFlightRef.current = false;
    updateRoundState({ status: "loading" });

    const refreshWhenVisible = () => {
      if (
        document.visibilityState === "visible" &&
        roundStateRef.current.status !== "loading" &&
        roundStateRef.current.status !== "error"
      ) {
        void refreshRound({ force: true });
      }
    };

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    void refreshRound({ showLoading: true });

    return () => {
      roundAbortRef.current?.abort();
      roundRequestRef.current += 1;
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshRound, updateRoundState]);

  useEffect(() => {
    if (roundState.status === "loading" || roundState.status === "error") {
      return;
    }

    const pollTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshRound();
      }
    }, ROUND_POLL_INTERVAL_MS);

    return () => window.clearInterval(pollTimer);
  }, [refreshRound, roundState.status]);

  const handleRoundClosed = useCallback(() => {
    void refreshRound({ force: true, showLoading: true });
  }, [refreshRound]);

  const boardId =
    "boardId" in roundState ? roundState.boardId : fallbackBoardId;

  const scheduledAt =
    roundState.status === "closed"
      ? roundState.snapshot.scheduledAt
      : "scheduledAt" in roundState && roundState.scheduledAt
        ? roundState.scheduledAt
        : roundState.status === "idle"
          ? null
          : programme.activeScreening.scheduledAt;

  const statusLabel =
    roundState.status === "scheduled"
      ? "Neste avstemning"
      : roundState.status === "awaiting"
        ? "Stemmingen er avsluttet"
        : roundState.status === "idle"
          ? "Filmklubben"
          : "Neste film";

  const historyHref = withBasePath(`/${clubSlug}/historikk`);

  useEffect(() => {
    setLeader(null);
  }, [boardId]);

  if (roundState.status === "closed") {
    return (
      <ClosedFilmRound
        key={roundState.snapshot.snapshotId}
        clubSlug={clubSlug}
        openDirectResult={requestedDirectResult}
        snapshot={roundState.snapshot}
      />
    );
  }

  return (
    <>
      <Head>
        <title>Filmklubben</title>
        <meta
          name="description"
          content="Neste film, tidligere visninger og avstemning i Filmklubben."
        />
      </Head>

      <main className={styles.programPage}>
        <section className={styles.nextSection} id="neste">
          <div className={styles.sectionLabel}>
            <span>{statusLabel}</span>
            {scheduledAt ? <span>{formatFilmDate(scheduledAt)}</span> : null}
          </div>

          <div className={styles.nextLayout}>
            <div className={styles.nextCase}>
              {roundState.status === "scheduled" ||
              roundState.status === "awaiting" ||
              roundState.status === "idle" ? (
                <StaticFilmTv />
              ) : (
                <NextFilmTv movie={leader} />
              )}
            </div>
          </div>
        </section>

        {roundState.status === "open" ? (
          <FilmVoteWall
            key={boardId}
            boardId={boardId}
            candidateIds={roundState.candidateIds}
            onLeaderChange={setLeader}
            onRoundClosed={handleRoundClosed}
          />
        ) : roundState.status === "loading" ? (
          <section
            className={styles.voteWallSection}
            aria-busy="true"
            aria-live="polite"
          >
            <p>Henter avstemningen…</p>
          </section>
        ) : (
          <section className={styles.voteWallSection} aria-live="polite">
            {roundState.status === "error" ? (
              <>
                <p role="status">{roundState.message}</p>
                <button
                  type="button"
                  onClick={() =>
                    void refreshRound({ force: true, showLoading: true })
                  }
                >
                  Prøv igjen
                </button>
              </>
            ) : roundState.status === "scheduled" ? (
              <p role="status">
                Avstemningen åpner {formatFilmDate(roundState.opensAt)}.
              </p>
            ) : roundState.status === "awaiting" ? (
              <p role="status">
                Resultatet publiseres {formatFilmDate(roundState.resultsAt)}.
              </p>
            ) : (
              <p role="status">Ingen aktiv avstemning akkurat nå.</p>
            )}
            <a className={styles.sectionLabel} href={historyHref}>
              Se historikk
            </a>
          </section>
        )}
      </main>
    </>
  );
};
