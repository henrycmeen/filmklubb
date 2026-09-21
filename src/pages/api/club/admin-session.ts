import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { isLocalFilmAdminRequest } from "@/lib/filmAdminAccess";
import {
  ADMIN_COOKIE,
  hasAdminPassword,
  verifyAdminPassword,
  setInitialAdminPassword,
  createAdminSession,
  verifyAdminSession,
  serializeAdminCookie,
  validAdminOrigin,
} from "@/lib/filmAdminSession";
import { resolveCanonicalClubId } from "@/lib/filmClubProgramme";
import { isConfiguredClub } from "@/lib/filmRoundService";
import { applyRateLimit } from "@/lib/rateLimit";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res
      .status(405)
      .json({ error: { message: "Metoden er ikke tillatt." } });
  }
  const query = z
    .object({ clubSlug: z.string().regex(/^[a-z0-9-]{1,64}$/i) })
    .strict()
    .safeParse(req.query);
  if (!query.success)
    return res.status(400).json({ error: { message: "Ugyldig klubb." } });
  const clubId = resolveCanonicalClubId(query.data.clubSlug);
  if (!isConfiguredClub(clubId))
    return res.status(404).json({ error: { message: "Ukjent klubb." } });
  try {
    if (req.method === "GET")
      return res
        .status(200)
        .json({
          authenticated: verifyAdminSession(
            req.cookies?.[ADMIN_COOKIE],
            clubId,
          ),
          needsSetup: !hasAdminPassword(),
          canSetup: isLocalFilmAdminRequest(req),
        });
    if (!validAdminOrigin(req))
      return res
        .status(403)
        .json({
          error: {
            message: "Åpne adminsiden på riktig adresse og prøv igjen.",
          },
        });
    // Do not let an untrusted X-Forwarded-For value reset password throttling.
    if (
      !applyRateLimit(
        { ...req, headers: {}, socket: req.socket } as NextApiRequest,
        res,
        { key: "club-admin-login", maxRequests: 10, windowMs: 60_000 },
      )
    )
      return;
    const input = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("setup"),
            password: z.string().min(10).max(256),
          })
          .strict(),
        z
          .object({
            action: z.literal("login"),
            password: z.string().min(1).max(256),
          })
          .strict(),
        z.object({ action: z.literal("logout") }).strict(),
      ])
      .safeParse(req.body);
    if (!input.success)
      return res
        .status(400)
        .json({
          error: { message: "Bruk et passord på minst 10 tegn ved oppsett." },
        });
    const secure =
      req.headers.origin?.startsWith("https://") === true ||
      process.env.NODE_ENV === "production";
    if (input.data.action === "logout") {
      res.setHeader("Set-Cookie", serializeAdminCookie("", secure, true));
      return res.status(200).json({ authenticated: false });
    }
    if (input.data.action === "setup") {
      if (!isLocalFilmAdminRequest(req) || hasAdminPassword())
        return res
          .status(403)
          .json({
            error: {
              message:
                "Passordoppsett er bare tilgjengelig lokalt første gang.",
            },
          });
      setInitialAdminPassword(input.data.password);
    } else if (!verifyAdminPassword(input.data.password))
      return res.status(401).json({ error: { message: "Feil passord." } });
    res.setHeader(
      "Set-Cookie",
      serializeAdminCookie(createAdminSession(clubId), secure),
    );
    return res.status(200).json({ authenticated: true });
  } catch {
    return res
      .status(503)
      .json({
        error: { message: "Admininnlogging er ikke tilgjengelig akkurat nå." },
      });
  }
}
export const config = { api: { bodyParser: { sizeLimit: "2kb" } } };
