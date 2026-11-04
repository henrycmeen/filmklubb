import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getAppleTrailerHlsUrl } from "@/lib/appleTrailer";
import { applyRateLimit } from "@/lib/rateLimit";

const querySchema = z.object({
  movieId: z.coerce.number().int().positive(),
});

const getQueryValue = (
  value: string | string[] | undefined,
): string | undefined => (Array.isArray(value) ? value[0] : value);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  if (
    !applyRateLimit(req, res, {
      key: "apple-trailer",
      maxRequests: 120,
      windowMs: 60_000,
    })
  ) {
    return;
  }

  const parsed = querySchema.safeParse({
    movieId: getQueryValue(req.query.movieId),
  });
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid movie id" });
  }

  // Lookup failures are answered as a missing trailer, so YouTube takes over.
  const hlsUrl = await getAppleTrailerHlsUrl(parsed.data.movieId).catch(
    () => null,
  );
  // A missing trailer may be a passing failure; the server cache decides when
  // to ask again, so only a found trailer may be reused by the browser.
  res.setHeader("Cache-Control", hlsUrl ? "private, max-age=600" : "no-store");
  return res.status(200).json({ hlsUrl });
}
