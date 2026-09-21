import type { IncomingMessage } from "node:http";

type AdminRequest = Pick<IncomingMessage, "headers" | "socket"> &
  Partial<Pick<IncomingMessage, "rawHeaders">>;

/** Local preview only. Never treat a public club code as administrator access. */
export function isLocalFilmAdminRequest(req: AdminRequest): boolean {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.FILMKLUBB_LOCAL_ADMIN !== "1"
  )
    return false;
  if (
    !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress ?? "",
    )
  )
    return false;
  // Next adds forwarding headers internally. Check the actual incoming header
  // names so direct local setup works, but tunnel/proxy requests cannot enroll.
  const incomingNames = req.rawHeaders
    ? req.rawHeaders.filter((_, index) => index % 2 === 0)
    : Object.keys(req.headers);
  if (
    incomingNames.some((key) =>
      /^(forwarded|x-forwarded-|cf-|x-real-ip)/i.test(key),
    )
  )
    return false;
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(
    req.headers.host ?? "",
  );
}

export function isSameOriginAdminWrite(req: AdminRequest): boolean {
  if (!isLocalFilmAdminRequest(req)) return false;
  const origin = req.headers.origin;
  if (typeof origin !== "string") return false;
  return (
    origin === `http://${req.headers.host}` &&
    req.headers["content-type"]?.split(";")[0]?.trim() === "application/json" &&
    (!req.headers["sec-fetch-site"] ||
      req.headers["sec-fetch-site"] === "same-origin")
  );
}
