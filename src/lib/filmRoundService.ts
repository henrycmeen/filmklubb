import filmClubProgrammeConfig from "@/data/filmClubProgramme.json";
import ticketMetadata from "@/data/ticketMetadata.json";
import { makeFilmTicket } from "@/lib/filmTicket";
import {
  combinedFilmCatalogue,
  legacyFilmCatalogue,
  type FilmCatalogueEntry,
} from "@/lib/filmCatalogue";
import {
  filmRoundLockMetadataSchema,
  type FilmRoundFilm,
  type FilmRoundLockMetadata,
  type FilmRoundTicket,
} from "@/lib/filmRound";
import {
  getFilmClubProgramme,
  resolveCanonicalClubId,
} from "@/lib/filmClubProgramme";

const FILM_CLUB_TIME_ZONE = "Europe/Oslo";
const configuredClubIds = new Set(Object.keys(filmClubProgrammeConfig.clubs));

type StaticTicketMetadata = { director?: string };

const staticTicketMetadata = ticketMetadata as Record<
  string,
  StaticTicketMetadata
>;

export interface CurrentFilmRound {
  boardId: string;
  clubId: string;
  screeningId: string;
  scheduledAt: string;
}

const toRoundFilm = (film: FilmCatalogueEntry): FilmRoundFilm => ({
  id: film.id,
  title: film.title,
  year: film.year,
  coverImage: film.coverImage,
});

const formatTicketDateTime = (
  scheduledAt: string,
): { date: string; time: string } => {
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) {
    throw new Error("The configured screening time is invalid.");
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: FILM_CLUB_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((values, part) => {
      values[part.type] = part.value;
      return values;
    }, {});

  if (
    !parts.year ||
    !parts.month ||
    !parts.day ||
    !parts.hour ||
    !parts.minute
  ) {
    throw new Error("The configured screening time could not be formatted.");
  }

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
};

const createTicketTemplates = (
  catalogue: ReadonlyArray<FilmCatalogueEntry>,
  scheduledAt: string,
  venue?: string,
): Record<string, FilmRoundTicket> => {
  const { date, time } = formatTicketDateTime(scheduledAt);

  // A locked round preserves these source-art URLs by reference. The asset
  // bytes stay in their existing local/static stores and are not copied into
  // the SQLite snapshot.
  return Object.fromEntries(
    catalogue.map((catalogueFilm, index) => {
      const film = toRoundFilm(catalogueFilm);
      const serial = String(index + 1).padStart(3, "0");
      const baseTicket = makeFilmTicket(film, serial);
      const director = staticTicketMetadata[String(film.id)]?.director;

      return [
        String(film.id),
        {
          ...baseTicket,
          film,
          date,
          time,
          ...(venue ? { venue } : {}),
          ...(director ? { director } : {}),
        },
      ];
    }),
  ) as Record<string, FilmRoundTicket>;
};

export const getFilmRoundBoardId = (
  clubId: string,
  screeningId: string,
): string => `${clubId}-${screeningId}`;

export const isConfiguredClub = (clubId: string): boolean =>
  configuredClubIds.has(clubId);

export const getCurrentFilmRound = (clubSlug?: string): CurrentFilmRound => {
  const clubId = resolveCanonicalClubId(clubSlug);
  const programme = getFilmClubProgramme(clubId);
  const screeningId = programme.activeScreening.id;

  return {
    boardId: getFilmRoundBoardId(clubId, screeningId),
    clubId,
    screeningId,
    scheduledAt: programme.activeScreening.scheduledAt,
  };
};

export const buildFilmRoundLockMetadata = (
  clubSlug?: string,
  screeningId?: string,
): FilmRoundLockMetadata => {
  const current = getCurrentFilmRound(clubSlug);
  if (screeningId !== undefined && screeningId !== current.screeningId) {
    throw new Error("Only the configured current screening can be locked.");
  }

  return filmRoundLockMetadataSchema.parse({
    clubId: current.clubId,
    screeningId: current.screeningId,
    scheduledAt: current.scheduledAt,
    catalogue: legacyFilmCatalogue.map((film) => ({
      ...toRoundFilm(film),
      tmdbVoteAverage: film.tmdbVoteAverage,
    })),
    ticketTemplates: createTicketTemplates(
      legacyFilmCatalogue,
      current.scheduledAt,
    ),
  });
};

/** Snapshot inputs are prepared before acquiring the database write lock. */
export const buildScheduledFilmRoundMetadata = (
  clubId: string,
  screeningId: string,
  scheduledAt: string,
  venue: string,
  candidateIds: number[],
): FilmRoundLockMetadata => {
  const ids = new Set(candidateIds);
  const catalogue = combinedFilmCatalogue.filter((film) => ids.has(film.id));
  if (
    ids.size !== candidateIds.length ||
    catalogue.length !== candidateIds.length
  ) {
    throw new Error("Ugyldig filmutvalg.");
  }
  const templates = createTicketTemplates(
    combinedFilmCatalogue,
    scheduledAt,
    venue,
  );
  return filmRoundLockMetadataSchema.parse({
    clubId,
    screeningId,
    scheduledAt,
    catalogue: catalogue.map((film) => ({
      ...toRoundFilm(film),
      tmdbVoteAverage: film.tmdbVoteAverage,
    })),
    ticketTemplates: Object.fromEntries(
      catalogue.map((film) => [String(film.id), templates[String(film.id)]]),
    ),
  });
};
