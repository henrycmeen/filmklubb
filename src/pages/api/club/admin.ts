import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import catalogue from "@/data/filmVoteCatalogue.json";
import {
  ADMIN_COOKIE,
  verifyAdminSession,
  validAdminOrigin,
} from "@/lib/filmAdminSession";
import { resolveCanonicalClubId } from "@/lib/filmClubProgramme";
import {
  buildScheduledFilmRoundMetadata,
  getCurrentFilmRound,
  getFilmRoundBoardId,
  isConfiguredClub,
} from "@/lib/filmRoundService";
import { FilmScheduleError, getFilmVoteStore } from "@/lib/filmVotes";

const identifier = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .min(1)
  .max(64);
const instant = z.string().datetime({ offset: true });
const command = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("save"),
      expectedRevision: z.number().int().nonnegative().nullable(),
      round: z
        .object({
          screeningId: identifier,
          voteStartsAt: instant,
          voteEndsAt: instant,
          resultsAt: instant,
          scheduledAt: instant,
          displayUntil: instant,
          venue: z.string().trim().min(1).max(200),
          published: z.boolean(),
          candidateIds: z.array(z.number().int().positive()).min(1).max(200),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("close"),
      boardId: identifier,
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal("complete"),
      boardId: identifier,
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
]);

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res
      .status(405)
      .json({ error: { message: "Metoden er ikke tillatt." } });
  }
  if (req.method === "POST" && !validAdminOrigin(req))
    return res
      .status(403)
      .json({ error: { message: "Forespørselen må komme fra adminsiden." } });
  const query = z
    .object({ clubSlug: z.string().regex(/^[a-z0-9-]{1,64}$/i) })
    .strict()
    .safeParse(req.query);
  if (!query.success)
    return res.status(400).json({ error: { message: "Ugyldig klubb." } });
  const clubId = resolveCanonicalClubId(query.data.clubSlug);
  if (!isConfiguredClub(clubId))
    return res.status(404).json({ error: { message: "Ukjent klubb." } });
  const parsed = req.method === "POST" ? command.safeParse(req.body) : null;
  if (parsed && !parsed.success)
    return res
      .status(400)
      .json({ error: { message: "Kontroller feltene og prøv igjen." } });
  try {
    if (!verifyAdminSession(req.cookies?.[ADMIN_COOKIE], clubId))
      return res
        .status(401)
        .json({
          error: { message: "Logg inn for å administrere filmklubben." },
        });
    const store = getFilmVoteStore();
    store.finalizeDueRounds(clubId);
    if (parsed?.success) {
      const input = parsed.data;
      if (input.action === "save") {
        const { candidateIds, ...fields } = input.round;
        const boardId = getFilmRoundBoardId(clubId, fields.screeningId);
        const existing = store.getScheduledRound(boardId);
        // An unmanaged election is already public. It cannot be adopted as a
        // private draft: that would silently disable its public vote endpoints.
        if (
          !fields.published &&
          boardId === getCurrentFilmRound(clubId).boardId
        )
          return res.status(409).json({
            error: {
              message:
                "Denne ID-en tilhører dagens avstemning. Bruk en ny ID for neste rundes utkast, eller publiser tidsplanen for dagens runde.",
            },
          });
        // Preserve frozen film metadata on a schedule-only edit.
        const sameFilms =
          existing &&
          JSON.stringify([...candidateIds].sort((a, b) => a - b)) ===
            JSON.stringify(
              existing.metadata.catalogue
                .map((f) => f.id)
                .sort((a, b) => a - b),
            );
        const metadata =
          sameFilms &&
          Date.parse(existing.scheduledAt) === Date.parse(fields.scheduledAt) &&
          existing.venue === fields.venue
            ? existing.metadata
            : buildScheduledFilmRoundMetadata(
                clubId,
                fields.screeningId,
                fields.scheduledAt,
                fields.venue,
                candidateIds,
              );
        store.saveScheduledRound(
          { ...fields, clubId, boardId, metadata },
          input.expectedRevision,
        );
      } else {
        const round = store.getScheduledRound(input.boardId);
        if (!round || round.clubId !== clubId)
          return res
            .status(404)
            .json({
              error: { message: "Runden finnes ikke i denne klubben." },
            });
        if (input.action === "close")
          store.closeScheduledRound(input.boardId, input.expectedRevision);
        else
          store.completeScheduledRound(input.boardId, input.expectedRevision);
      }
    }
    return res
      .status(200)
      .json({
        rounds: store.listScheduledRounds(clubId),
        catalogue: catalogue.map(({ id, title, year }) => ({
          id,
          title,
          year,
        })),
        current: getCurrentFilmRound(clubId),
      });
  } catch (error) {
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({
          error: {
            message:
              "Kontroller datoene: åpning før frist, deretter offentliggjøring, visning og sluttdato.",
          },
        });
    // Only validated domain messages are exposed; database details stay private.
    const known = error instanceof FilmScheduleError;
    return res
      .status(known ? 409 : 503)
      .json({
        error: {
          message: known
            ? error.message
            : "Endringen kunne ikke lagres. Last inn siden på nytt og prøv igjen.",
        },
      });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "32kb" } } };
