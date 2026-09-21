import artwork from "@/data/ticketDemoArt.json";
import logos from "@/data/filmCassetteLogos.json";
import metadata from "@/data/ticketMetadata.json";
import type { TicketData } from "@/components/FilmTicket";

export const ticketPalettes: Record<number, string> = {
  62: "ember",
  25538: "rose",
  149: "red",
  10227: "mineral",
};
export function makeFilmTicket(
  film: TicketData["film"],
  serial: string,
): TicketData {
  const art = artwork[String(film.id) as keyof typeof artwork];
  const localLogo = logos[film.coverImage as keyof typeof logos];
  return {
    film: { ...film },
    director: metadata[String(film.id) as keyof typeof metadata]?.director,
    image: art?.image ?? film.coverImage,
    fallback: art?.fallback ?? film.coverImage,
    logo: art && "logo" in art ? art.logo : localLogo?.image,
    logoFallback: localLogo?.image,
    palette: ticketPalettes[film.id] ?? art?.palette ?? "ember",
    date: "2026-09-22",
    time: "16:00",
    venue: "Wergelandssalen",
    note: "ADGANG FOR ÉN",
    serial,
  };
}

export interface DemoFinalist {
  film: TicketData["film"];
  votes: number;
  tmdbVoteAverage?: number;
}
// The public demo only stores a visitor's open/closed cases. These explicitly
// fictional totals illustrate a whole club's result without touching club APIs.
export function makeDemoFinalists(films: TicketData["film"][]): DemoFinalist[] {
  const sampleVotes = [
    34, 30, 27, 24, 21, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2, 1,
  ];
  return films.map((film, index) => ({
    film: { ...film },
    votes: sampleVotes[index] ?? 0,
  }));
}
