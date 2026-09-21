import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getPublicFilmHistory } from "@/lib/filmScheduleService";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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
  try {
    return res
      .status(200)
      .json({ history: getPublicFilmHistory(query.data.clubSlug) });
  } catch {
    return res
      .status(503)
      .json({ error: { message: "Tidligere visninger kunne ikke hentes." } });
  }
}
