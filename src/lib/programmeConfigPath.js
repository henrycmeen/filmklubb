import fs from "node:fs";
import path from "node:path";

/**
 * A club installation keeps its programme (clubs, aliases, venue, round
 * artwork) outside Git, next to its database. The tracked file is only the
 * template default. Both the build and the terminal tools use this path.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [cwd]
 * @returns {string | null}
 */
export const resolveProgrammeConfigPath = (
  env = process.env,
  cwd = process.cwd(),
) => {
  const configured = (env.FILMKLUBB_PROGRAMME_PATH ?? "").trim();
  const candidate = path.resolve(cwd, configured || "data/club/programme.json");
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  if (configured) {
    throw new Error(`FILMKLUBB_PROGRAMME_PATH does not exist: ${candidate}`);
  }
  return null;
};

/** The tracked template that a club's programme file replaces. */
export const TEMPLATE_PROGRAMME_PATTERN =
  /[\\/]src[\\/]data[\\/]filmClubProgramme\.json$/;
