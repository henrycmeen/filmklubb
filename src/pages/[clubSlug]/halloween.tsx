import type { GetServerSideProps, NextPage } from "next";
import Head from "next/head";
import { VhsCaseArtwork } from "@/components/VhsCaseArtwork";
import { withBasePath } from "@/lib/basePath";
import { resolveClubSlugParam } from "@/lib/clubSlug";
import { halloweenFilmCatalogue } from "@/lib/filmCatalogue";
import type { FilmRoundFilm } from "@/lib/filmRound";
import styles from "./halloween.module.css";

interface HalloweenPreviewProps {
  clubSlug: "na";
  films: FilmRoundFilm[];
}

/**
 * A deliberately named, read-only preview for the Nasjonalarkivet Halloween
 * special. It does not mount the vote wall or call a vote endpoint; the real
 * scheduled round remains the only place where these films can be voted on.
 */
const HalloweenPreviewPage: NextPage<HalloweenPreviewProps> = ({
  clubSlug,
  films,
}) => (
  <>
    <Head>
      <title>Halloween 2026 · Filmklubben</title>
      <meta
        name="description"
        content="Forhåndsvisning av Halloween-spesialen i Nasjonalarkivets filmklubb."
      />
      <meta name="robots" content="noindex" />
    </Head>
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Nasjonalarkivet · Filmklubben</p>
        <h1>Halloween 2026</h1>
        <div className={styles.intro}>
          <p>
            <strong>29. oktober kl. 16.00</strong> · Wergelandshallen
          </p>
          <p>
            Avstemningen åpner <strong>22. september kl. 18.00</strong> (Oslo).
          </p>
          <p>
            Frist <strong>28. oktober kl. 16.00</strong> (Oslo).
          </p>
        </div>
        <a className={styles.backLink} href={withBasePath(`/${clubSlug}`)}>
          Tilbake til Filmklubben
        </a>
      </header>

      <section
        className={styles.catalogue}
        aria-labelledby="halloween-catalogue-heading"
      >
        <div className={styles.catalogueHeading}>
          <p id="halloween-catalogue-heading">Kveldens filmutvalg</p>
          <p>{films.length} filmer</p>
        </div>
        <ol className={styles.grid}>
          {films.map((film) => (
            <li className={styles.item} key={film.id}>
              <div
                className={styles.case}
                role="img"
                aria-label={`${film.title} (${film.year})`}
              >
                <VhsCaseArtwork
                  coverImage={film.coverImage}
                  title={film.title}
                />
              </div>
              <p className={styles.filmLabel}>
                <strong>{film.title}</strong>
                {film.year}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  </>
);

export const getServerSideProps: GetServerSideProps<
  HalloweenPreviewProps
> = async (context) => {
  const clubSlug = resolveClubSlugParam(context.params?.clubSlug);

  // Keep this public preview specific to the authorized NA route. A generic
  // `draft` query/slug must never expose an unpublished round.
  if (clubSlug !== "na") {
    return { notFound: true };
  }

  const { getFilmVoteStore } = await import("@/lib/filmVotes");
  const round = getFilmVoteStore().getScheduledRound("na-halloween-2026");
  const films = round?.published ? round.metadata.catalogue : halloweenFilmCatalogue;
  return { props: { clubSlug, films } };
};

export default HalloweenPreviewPage;
