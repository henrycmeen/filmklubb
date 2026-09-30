import Head from "next/head";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import clubCatalogue from "@/data/filmVoteCatalogue.json";
import featuredFilms from "@/data/ticketFeaturedFilms.json";
import art from "@/data/ticketDemoArt.json";
import { FilmTicket, type TicketData } from "@/components/FilmTicket";
import { makeFilmTicket } from "@/lib/filmTicket";
import { getTicketPngFilename, renderTicketPng } from "@/lib/ticketPng";
import { withBasePath } from "@/lib/basePath";
import styles from "@/styles/ticketDemo.module.css";

const catalogue = [...clubCatalogue, ...featuredFilms];

const samples = [
  { id: 62, label: "2001" },
  { id: 25538, label: "Yi Yi" },
  { id: 149, label: "Akira" },
  { id: 10227, label: "PlayTime" },
  { id: 324857, label: "Spider-Man" },
  { id: 10315, label: "Fantastic Mr. Fox" },
  { id: 129, label: "Spirited Away" },
  { id: 503919, label: "The Lighthouse" },
];
const palettes = [
  { id: "ember", label: "Krem" },
  { id: "rose", label: "Rosa" },
  { id: "red", label: "Rød" },
  { id: "mineral", label: "Grønn" },
  { id: "white", label: "Hvit" },
  { id: "midnight", label: "Natt" },
  { id: "blue", label: "Blå" },
];
const curated: Record<number, string> = {
  62: "ember",
  25538: "rose",
  149: "red",
  10227: "mineral",
};

type CatalogueFilm = (typeof catalogue)[number];
type SearchPhase = "idle" | "pending" | "success" | "error";
type TicketFetchState = "idle" | "pending" | "success" | "error";

interface RemoteSearchResult {
  id: number;
  title: string;
  year: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
}

interface RemoteTicketResponse {
  film: TicketData["film"];
  image: string;
  fallback: string;
  logo?: string;
  director?: string;
}

type SearchItem =
  | { source: "catalogue"; film: CatalogueFilm }
  | { source: "tmdb"; result: RemoteSearchResult };

const initialFilm = catalogue.find((film) => film.id === 62) ?? catalogue[0];
if (!initialFilm) {
  throw new Error("The ticket catalogue is empty.");
}
const defaultFilm = initialFilm;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeSearch = (value: string): string =>
  value
    .toLocaleLowerCase("nb-NO")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

const parseSearchResults = (payload: unknown): RemoteSearchResult[] => {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    return [];
  }

  return payload.results.flatMap((entry): RemoteSearchResult[] => {
    if (!isRecord(entry)) {
      return [];
    }

    const { id, title, year } = entry;
    if (
      typeof id !== "number" ||
      !Number.isInteger(id) ||
      typeof title !== "string" ||
      !title.trim() ||
      (year !== null &&
        year !== undefined &&
        (typeof year !== "number" || !Number.isFinite(year)))
    ) {
      return [];
    }

    return [
      {
        id,
        title: title.trim(),
        year: typeof year === "number" ? year : null,
        posterUrl: typeof entry.posterUrl === "string" ? entry.posterUrl : null,
        backdropUrl:
          typeof entry.backdropUrl === "string" ? entry.backdropUrl : null,
      },
    ];
  });
};

const parseTicketResponse = (payload: unknown): RemoteTicketResponse | null => {
  if (!isRecord(payload) || !isRecord(payload.film)) {
    return null;
  }

  const film = payload.film;
  if (
    typeof film.id !== "number" ||
    !Number.isInteger(film.id) ||
    typeof film.title !== "string" ||
    !film.title.trim() ||
    typeof film.year !== "number" ||
    !Number.isFinite(film.year) ||
    typeof film.coverImage !== "string"
  ) {
    return null;
  }

  return {
    film: {
      id: film.id,
      title: film.title.trim(),
      year: film.year,
      coverImage: film.coverImage,
    },
    image: typeof payload.image === "string" ? payload.image : "",
    fallback: typeof payload.fallback === "string" ? payload.fallback : "",
    logo: typeof payload.logo === "string" ? payload.logo : undefined,
    director:
      typeof payload.director === "string" && payload.director.trim()
        ? payload.director.trim()
        : undefined,
  };
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

export default function TicketDemo() {
  const [activeFilm, setActiveFilm] = useState<TicketData["film"]>(defaultFilm);
  const [activeSource, setActiveSource] = useState<"catalogue" | "tmdb">(
    "catalogue",
  );
  const [palette, setPalette] = useState("ember");
  const [originalLogo, setOriginalLogo] = useState(true);
  const [date, setDate] = useState("2026-09-22");
  const [time, setTime] = useState("16:00");
  const [venue, setVenue] = useState("Eksempelkino");
  const [note, setNote] = useState("ADGANG FOR ÉN");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<RemoteSearchResult[]>([]);
  const [searchPhase, setSearchPhase] = useState<SearchPhase>("idle");
  const [searchError, setSearchError] = useState("");
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1);
  const [remoteTicket, setRemoteTicket] = useState<RemoteTicketResponse | null>(
    null,
  );
  const [ticketFetchState, setTicketFetchState] =
    useState<TicketFetchState>("idle");
  const [ticketFetchError, setTicketFetchError] = useState("");
  const [readyTicketKey, setReadyTicketKey] = useState("");
  const [fontsReady, setFontsReady] = useState(false);
  const [exportState, setExportState] = useState<"idle" | "loading">("idle");
  const [exportError, setExportError] = useState("");
  const [exportSuccess, setExportSuccess] = useState("");
  const [pngUrl, setPngUrl] = useState("");

  const ticketRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suppressSearchFocusRef = useRef(false);
  const searchOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchRequestRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const ticketRequestRef = useRef(0);
  const ticketAbortRef = useRef<AbortController | null>(null);
  const exportGenerationRef = useRef(0);
  const exportAbortRef = useRef<AbortController | null>(null);

  const isCatalogueFilm = activeSource === "catalogue";
  const serial = isCatalogueFilm
    ? String(
        catalogue.findIndex((film) => film.id === activeFilm.id) + 1,
      ).padStart(3, "0")
    : String(activeFilm.id).slice(-3).padStart(3, "0");
  const localTicketBase = useMemo(
    () => (isCatalogueFilm ? makeFilmTicket(activeFilm, serial) : null),
    [activeFilm, isCatalogueFilm, serial],
  );
  const hasStaticDirector = Boolean(localTicketBase?.director?.trim());

  useEffect(() => {
    let mounted = true;
    void document.fonts.ready.then(() => {
      if (mounted) {
        setFontsReady(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const query = searchQuery.trim();
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setSearchError("");
    setSearchResults([]);
    setSearchActiveIndex(-1);

    if (!query) {
      setSearchPhase("idle");
      setSearchOpen(false);
      return;
    }

    setSearchOpen(true);
    setSearchPhase("pending");
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            withBasePath(
              `/api/tmdb/search?query=${encodeURIComponent(query)}&limit=8`,
            ),
            {
              signal: controller.signal,
              headers: { Accept: "application/json" },
            },
          );
          if (!response.ok) {
            throw new Error(`TMDB search failed (${response.status}).`);
          }

          const results = parseSearchResults(await response.json());
          if (
            controller.signal.aborted ||
            requestId !== searchRequestRef.current
          ) {
            return;
          }
          setSearchResults(results);
          setSearchPhase("success");
        } catch (error) {
          if (
            controller.signal.aborted ||
            requestId !== searchRequestRef.current ||
            isAbortError(error)
          ) {
            return;
          }
          setSearchPhase("error");
          setSearchError(
            "Søket er ikke tilgjengelig akkurat nå. Prøv igjen snart.",
          );
        }
      })();
    }, 320);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  useEffect(() => {
    ticketAbortRef.current?.abort();
    ticketAbortRef.current = null;
    const requestId = ticketRequestRef.current + 1;
    ticketRequestRef.current = requestId;
    setRemoteTicket(null);
    setTicketFetchError("");

    if (isCatalogueFilm && hasStaticDirector) {
      setTicketFetchState("idle");
      return;
    }

    setTicketFetchState("pending");
    const controller = new AbortController();
    ticketAbortRef.current = controller;
    void (async () => {
      try {
        const response = await fetch(
          withBasePath(`/api/tmdb/ticket?movieId=${activeFilm.id}`),
          {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
        );
        if (!response.ok) {
          throw new Error(`Ticket metadata failed (${response.status}).`);
        }

        const parsed = parseTicketResponse(await response.json());
        if (!parsed) {
          throw new Error("Ticket metadata had an invalid shape.");
        }
        if (
          controller.signal.aborted ||
          requestId !== ticketRequestRef.current
        ) {
          return;
        }
        setRemoteTicket(parsed);
        setTicketFetchState("success");
      } catch (error) {
        if (
          controller.signal.aborted ||
          requestId !== ticketRequestRef.current ||
          isAbortError(error)
        ) {
          return;
        }
        setTicketFetchState("error");
        setTicketFetchError(
          isCatalogueFilm
            ? "Regissøren kunne ikke hentes akkurat nå."
            : "Filmdata kunne ikke hentes akkurat nå.",
        );
      } finally {
        if (ticketAbortRef.current === controller) {
          ticketAbortRef.current = null;
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [activeFilm.id, hasStaticDirector, isCatalogueFilm]);

  const ticket = useMemo<TicketData>(() => {
    if (isCatalogueFilm && localTicketBase) {
      return {
        ...localTicketBase,
        palette,
        logo: originalLogo ? localTicketBase.logo : undefined,
        logoFallback: originalLogo ? localTicketBase.logoFallback : undefined,
        director: localTicketBase.director ?? remoteTicket?.director,
        date,
        time,
        venue: venue.trim() || "Filmklubben",
        note,
      };
    }

    const remoteFilm = remoteTicket?.film ?? activeFilm;
    return {
      film: remoteFilm,
      image: remoteTicket?.image ?? activeFilm.coverImage,
      fallback: remoteTicket?.fallback ?? activeFilm.coverImage,
      logo: originalLogo ? remoteTicket?.logo : undefined,
      director: remoteTicket?.director,
      palette,
      date,
      time,
      venue: venue.trim() || "Filmklubben",
      note,
      serial,
    };
  }, [
    activeFilm,
    date,
    isCatalogueFilm,
    localTicketBase,
    note,
    originalLogo,
    palette,
    remoteTicket,
    serial,
    time,
    venue,
  ]);
  const ticketVisualKey = [
    activeSource,
    ticket.film.id,
    originalLogo,
    ticket.image,
    ticket.fallback,
    ticket.logo ?? "",
    ticket.director ?? "",
  ].join("|");
  const readyToExport =
    fontsReady &&
    readyTicketKey === ticketVisualKey &&
    !(activeSource === "tmdb" && ticketFetchState === "pending");
  const actionMessages = [
    exportState === "loading" ? "Lager PNG…" : "",
    exportSuccess,
    activeSource === "tmdb" && ticketFetchState === "pending"
      ? "Henter filmdata…"
      : "",
    isCatalogueFilm && ticketFetchState === "pending" && !hasStaticDirector
      ? "Henter regissør…"
      : "",
  ].filter((message): message is string => Boolean(message));

  const localSearchResults = useMemo(() => {
    const query = normalizeSearch(searchQuery.trim());
    if (!query) {
      return [];
    }

    return catalogue
      .filter((film) =>
        normalizeSearch(`${film.title} ${film.year}`).includes(query),
      )
      .slice(0, 6);
  }, [searchQuery]);
  const searchItems = useMemo<SearchItem[]>(() => {
    const localIds = new Set(localSearchResults.map((film) => film.id));
    return [
      ...localSearchResults.map((film) => ({
        source: "catalogue" as const,
        film,
      })),
      ...searchResults
        .filter((result) => !localIds.has(result.id))
        .map((result) => ({ source: "tmdb" as const, result })),
    ];
  }, [localSearchResults, searchResults]);
  const showSearchResults = searchOpen && searchQuery.trim().length > 0;

  useEffect(() => {
    exportAbortRef.current?.abort();
    exportAbortRef.current = null;
    exportGenerationRef.current += 1;
    setExportState("idle");
    setExportError("");
    setExportSuccess("");
    setPngUrl("");
  }, [date, note, originalLogo, palette, ticketVisualKey, time, venue]);

  function chooseLocalFilm(id: number) {
    const film = catalogue.find((candidate) => candidate.id === id);
    if (!film) {
      return;
    }
    setActiveFilm(film);
    setActiveSource("catalogue");
    setReadyTicketKey("");
    setPalette(
      curated[id] ?? art[String(id) as keyof typeof art]?.palette ?? "ember",
    );
    setSearchQuery("");
    setSearchOpen(false);
  }

  function chooseRemoteFilm(result: RemoteSearchResult) {
    setActiveFilm({
      id: result.id,
      title: result.title,
      year: result.year ?? 0,
      coverImage: result.posterUrl ?? result.backdropUrl ?? "",
    });
    setActiveSource("tmdb");
    setRemoteTicket(null);
    setTicketFetchError("");
    setReadyTicketKey("");
    setPalette("ember");
    setSearchQuery("");
    setSearchOpen(false);
  }

  function chooseSearchItem(item: SearchItem) {
    if (item.source === "catalogue") {
      chooseLocalFilm(item.film.id);
    } else {
      chooseRemoteFilm(item.result);
    }
  }

  function focusSearchOption(index: number) {
    if (searchItems.length === 0) {
      return;
    }
    const boundedIndex = (index + searchItems.length) % searchItems.length;
    setSearchActiveIndex(boundedIndex);
    searchOptionRefs.current[boundedIndex]?.focus();
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusSearchOption(searchActiveIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusSearchOption(searchActiveIndex - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setSearchOpen(false);
      setSearchActiveIndex(-1);
    } else if (event.key === "Enter" && searchActiveIndex >= 0) {
      event.preventDefault();
      const item = searchItems[searchActiveIndex];
      if (item) {
        chooseSearchItem(item);
      }
    }
  }

  function handleSearchOptionKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusSearchOption(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index === 0) {
        searchInputRef.current?.focus();
        setSearchActiveIndex(-1);
      } else {
        focusSearchOption(index - 1);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setSearchOpen(false);
      suppressSearchFocusRef.current = true;
      searchInputRef.current?.focus();
    }
  }

  function saveTicketAsPng(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ticketElement = ticketRef.current?.firstElementChild;
    if (
      !readyToExport ||
      !(ticketElement instanceof HTMLElement) ||
      exportState === "loading"
    ) {
      return;
    }

    exportAbortRef.current?.abort();
    const controller = new AbortController();
    const exportId = exportGenerationRef.current + 1;
    exportGenerationRef.current = exportId;
    exportAbortRef.current = controller;
    setExportState("loading");
    setExportError("");
    setExportSuccess("");

    void (async () => {
      try {
        const dataUrl = await renderTicketPng(ticketElement, {
          signal: controller.signal,
        });
        if (
          controller.signal.aborted ||
          exportId !== exportGenerationRef.current
        ) {
          return;
        }
        setPngUrl(dataUrl);
        setExportSuccess("PNG-en er klar.");
      } catch (error) {
        if (
          controller.signal.aborted ||
          exportId !== exportGenerationRef.current ||
          isAbortError(error)
        ) {
          return;
        }
        setExportError(
          "PNG-en kunne ikke lages. Kontroller at motivet er ferdig lastet, og prøv igjen.",
        );
      } finally {
        if (
          exportAbortRef.current === controller &&
          exportId === exportGenerationRef.current
        ) {
          exportAbortRef.current = null;
          setExportState("idle");
        }
      }
    })();
  }

  return (
    <div className={styles.page}>
      <Head>
        <title>{`${filmTitleForHead(ticket.film.title)} · Billettgenerator`}</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <header className={styles.header}>
        <Link href="/">
          Filmklubben <span>●</span>
        </Link>
      </header>
      <main className={styles.studio}>
        <div className={styles.controls}>
          <h1>Billettgenerator</h1>
          <div className={styles.sampleChoices} aria-label="Prøv en film">
            {samples.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-label={catalogue.find((film) => film.id === id)?.title}
                aria-pressed={isCatalogueFilm && activeFilm.id === id}
                onClick={() => chooseLocalFilm(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <form onSubmit={saveTicketAsPng} aria-label="Lag en filmbillett">
            <div className={styles.searchGroup}>
              <div className={styles.searchField}>
                <input
                  ref={searchInputRef}
                  id="film-search"
                  type="search"
                  value={searchQuery}
                  aria-label="Søk etter film"
                  placeholder="Søk etter film"
                  autoComplete="off"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={showSearchResults}
                  aria-controls="film-search-results"
                  aria-activedescendant={
                    searchActiveIndex >= 0
                      ? `film-search-option-${searchActiveIndex}`
                      : undefined
                  }
                  onFocus={() => {
                    if (suppressSearchFocusRef.current) {
                      suppressSearchFocusRef.current = false;
                      return;
                    }
                    if (searchQuery.trim()) {
                      setSearchOpen(true);
                    }
                  }}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={handleSearchKeyDown}
                />
              </div>
              {showSearchResults ? (
                <div
                  id="film-search-results"
                  className={styles.searchResults}
                  role="listbox"
                  aria-label="Filmvalg"
                  aria-busy={searchPhase === "pending"}
                >
                  {searchItems.map((item, index) => {
                    const id =
                      item.source === "catalogue"
                        ? item.film.id
                        : item.result.id;
                    const title =
                      item.source === "catalogue"
                        ? item.film.title
                        : item.result.title;
                    const year =
                      item.source === "catalogue"
                        ? item.film.year
                        : item.result.year;
                    return (
                      <button
                        key={`${item.source}-${id}`}
                        id={`film-search-option-${index}`}
                        ref={(element) => {
                          searchOptionRefs.current[index] = element;
                        }}
                        className={styles.searchResult}
                        type="button"
                        role="option"
                        aria-selected={
                          searchActiveIndex === index ||
                          (activeSource === item.source && activeFilm.id === id)
                        }
                        onMouseEnter={() => setSearchActiveIndex(index)}
                        onKeyDown={(event) =>
                          handleSearchOptionKeyDown(event, index)
                        }
                        onClick={() => chooseSearchItem(item)}
                      >
                        <span>{title}</span>
                        <small>{year ?? "—"}</small>
                      </button>
                    );
                  })}
                  {searchPhase === "pending" ? (
                    <p className={styles.searchStatus} role="status">
                      Søker…
                    </p>
                  ) : null}
                  {searchPhase === "success" && searchItems.length === 0 ? (
                    <p className={styles.searchEmpty}>Ingen treff.</p>
                  ) : null}
                </div>
              ) : null}
              {searchError ? (
                <p className={styles.searchError} role="status">
                  {searchError}
                </p>
              ) : null}
            </div>
            <fieldset className={styles.paletteField}>
              <legend>PAPIR OG TRYKK</legend>
              <div>
                {palettes.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-palette={p.id}
                    aria-label={p.label}
                    aria-pressed={palette === p.id}
                    onClick={() => setPalette(p.id)}
                  >
                    <span />
                    {p.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={originalLogo}
                onChange={(event) => {
                  setReadyTicketKey("");
                  setOriginalLogo(event.target.checked);
                }}
              />
              Original tittellogo
            </label>
            <div className={styles.fields}>
              <label className={styles.field}>
                DATO
                <input
                  type="date"
                  value={date}
                  min="1900-01-01"
                  max="9999-12-31"
                  required
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                TID
                <input
                  type="time"
                  value={time}
                  required
                  onChange={(event) => setTime(event.target.value)}
                />
              </label>
            </div>
            <label className={styles.field}>
              VISNINGSSTED
              <input
                value={venue}
                maxLength={40}
                onChange={(event) => setVenue(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              LINJE UNDER TITTELEN
              <input
                value={note}
                maxLength={70}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            {pngUrl ? (
              <a
                className={styles.primary}
                href={pngUrl}
                download={getTicketPngFilename(ticket.film.title)}
              >
                <span>Last ned PNG</span>
                <span aria-hidden="true">↓</span>
              </a>
            ) : (
              <button
                className={styles.primary}
                type="submit"
                disabled={!readyToExport || exportState === "loading"}
              >
                <span>Lagre som PNG</span>
                <span aria-hidden="true">↓</span>
              </button>
            )}
            <div className={styles.actionStatus} aria-live="polite">
              {actionMessages.join(" · ")}
            </div>
            {ticketFetchError ? (
              <p className={styles.ticketFetchError} role="status">
                {ticketFetchError}
              </p>
            ) : null}
            {exportError ? (
              <p className={styles.exportError} role="alert">
                {exportError}
              </p>
            ) : null}
          </form>
          <p className={styles.attribution}>
            Filmdata fra <a href="https://www.themoviedb.org">TMDB</a>.
          </p>
        </div>
        <section
          className={styles.preview}
          aria-label={`Billettforhåndsvisning for ${ticket.film.title}`}
        >
          <div
            className={styles.ticketMount}
            ref={ticketRef}
            key={ticketVisualKey}
          >
            <FilmTicket
              ticket={ticket}
              onReady={() => setReadyTicketKey(ticketVisualKey)}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

const filmTitleForHead = (title: string): string =>
  title.trim() || "Filmklubben";
