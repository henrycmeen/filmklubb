import type { ScheduledFilmRound } from "@/lib/filmSchedule";
import {
  adminEventStatus,
  adminEventTitle,
  groupAdminEvents,
} from "@/lib/filmAdminOverview";
import { formatOsloDateTime } from "@/lib/filmAdminTime";
import styles from "@/styles/filmClubAdmin.module.css";

export function FilmClubEventList({
  rounds,
  now,
  onOpen,
  onNew,
}: {
  rounds: ScheduledFilmRound[];
  now: number;
  onOpen: (boardId: string) => void;
  onNew: () => void;
}) {
  const grouped = groupAdminEvents(rounds, now);
  return (
    <>
      <div className={styles.overviewActions}>
        <p>Velg et arrangement for å se eller endre tidsplanen.</p>
        <button className={styles.button} type="button" onClick={onNew}>
          Nytt arrangement
        </button>
      </div>
      {(
        [
          ["active", "Aktive", "Ingen aktive arrangementer."],
          ["planned", "Planlagte", "Ingen planlagte arrangementer ennå."],
          ["historical", "Historiske", "Gjennomførte arrangementer vises her."],
        ] as const
      ).map(([key, title, empty]) => (
        <section
          key={key}
          className={styles.eventGroup}
          aria-labelledby={`events-${key}`}
        >
          <h2 id={`events-${key}`}>
            {title} <span>{grouped[key].length}</span>
          </h2>
          {grouped[key].length ? (
            <ul className={styles.eventList}>
              {grouped[key].map((round) => (
                <li key={round.boardId}>
                  <button
                    type="button"
                    className={styles.eventRow}
                    onClick={() => onOpen(round.boardId)}
                  >
                    <span className={styles.eventInfo}>
                      <strong>{adminEventTitle(round)}</strong>
                      <span>
                        {formatOsloDateTime(round.scheduledAt)} · {round.venue}
                      </span>
                      <small>{round.screeningId}</small>
                    </span>
                    <span className={styles.eventState}>
                      {adminEventStatus(round, now)}
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.emptyState}>{empty}</p>
          )}
        </section>
      ))}
    </>
  );
}
