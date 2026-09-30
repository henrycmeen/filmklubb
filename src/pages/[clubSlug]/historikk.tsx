import type { NextPage } from "next";
import { useRouter } from "next/router";
import { FilmClubHistory } from "@/components/FilmClubHistory";
import { resolveClubSlugParam } from "@/lib/clubSlug";

const ClubHistoryPage: NextPage = () => {
  const router = useRouter();

  if (!router.isReady) {
    return null;
  }

  return (
    <FilmClubHistory clubSlug={resolveClubSlugParam(router.query.clubSlug)} />
  );
};

export default ClubHistoryPage;
