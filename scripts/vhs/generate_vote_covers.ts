import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { renderVhsPoster } from "../../src/lib/vhs/render";

export interface VoteCoverSource {
  tmdbId: number;
  posterPath: string;
  outputFile: string;
}

const MANIFEST_PATH = path.join(
  process.cwd(),
  "scripts/vhs/vote_cover_sources.json",
);
const OUTPUT_DIRECTORY = path.join(
  process.cwd(),
  "public/VHS/program/vote-covers",
);
const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const generateVoteCovers = async (
  sources: readonly VoteCoverSource[],
  options: { force?: boolean } = {},
): Promise<void> => {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });

  for (const source of sources) {
    if (!Number.isInteger(source.tmdbId) || source.tmdbId <= 0) {
      throw new Error(`Invalid TMDB id: ${source.tmdbId}`);
    }
    if (!/^\/[A-Za-z0-9._-]+\.(?:jpe?g|png)$/i.test(source.posterPath)) {
      throw new Error(`Invalid TMDB poster path: ${source.posterPath}`);
    }
    if (!/^\d{3}-[a-z0-9-]+\.webp$/.test(source.outputFile)) {
      throw new Error(`Invalid vote-cover filename: ${source.outputFile}`);
    }

    const outputPath = path.join(OUTPUT_DIRECTORY, source.outputFile);
    if (!options.force && (await fileExists(outputPath))) {
      console.log(`Keeping existing ${source.outputFile}`);
      continue;
    }

    const rendered = await renderVhsPoster({
      sourceUrl: `https://image.tmdb.org/t/p/original${source.posterPath}`,
      templateId: "black-case-front-v1",
      fit: "cover",
      width: 520,
      height: 520,
      format: "webp",
      quality: 70,
      background: "transparent",
      randomSeed: `vote-grid-${source.tmdbId}`,
    });

    await sharp(rendered.buffer)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .resize({ height: 520 })
      .extend({
        top: 8,
        right: 8,
        bottom: 8,
        left: 8,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp({ quality: 70 })
      .toFile(outputPath);

    console.log(`Rendered ${source.outputFile}`);
  }
};

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const rawManifest = await readFile(MANIFEST_PATH, "utf8");
  const sources = JSON.parse(rawManifest) as VoteCoverSource[];
  await generateVoteCovers(sources, {
    force: process.argv.includes("--force"),
  });
}
