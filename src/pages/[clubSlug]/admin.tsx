import type { GetServerSideProps, NextPage } from "next";
import Head from "next/head";
import { FilmClubAdmin } from "@/components/FilmClubAdmin";
import { resolveClubSlugParam } from "@/lib/clubSlug";
import { isConfiguredClub } from "@/lib/filmRoundService";

interface ClubAdminPageProps {
  clubSlug: string;
}

const ClubAdminPage: NextPage<ClubAdminPageProps> = ({ clubSlug }) => (
  <>
    <Head>
      <title>Administrasjon · Filmklubben</title>
      <meta name="robots" content="noindex,nofollow" />
      <meta
        name="description"
        content="Lokal administrasjon av Filmklubb-runder."
      />
    </Head>
    <FilmClubAdmin clubSlug={clubSlug} />
  </>
);

export const getServerSideProps: GetServerSideProps<
  ClubAdminPageProps
> = async (context) => {
  const clubSlug = resolveClubSlugParam(context.params?.clubSlug);
  // The shell can show login remotely. Data and every mutation are protected
  // by the server session; only initial password enrollment is local-only.
  if (!isConfiguredClub(clubSlug)) {
    return { notFound: true };
  }

  return {
    props: { clubSlug },
  };
};

export default ClubAdminPage;
