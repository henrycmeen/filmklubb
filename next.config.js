/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import fs from "node:fs";
import path from "node:path";
import "./src/env.js";

/** @param {string | undefined} value */
const normalizeBasePath = (value) => {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
};

const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

/**
 * A club installation keeps its programme (clubs, aliases, venue) outside Git,
 * next to its database. The bundled file is only the template default.
 */
const resolveProgrammeConfigPath = () => {
  const configured = (process.env.FILMKLUBB_PROGRAMME_PATH ?? "").trim();
  const candidate = path.resolve(configured || "data/club/programme.json");
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  if (configured) {
    throw new Error(`FILMKLUBB_PROGRAMME_PATH does not exist: ${candidate}`);
  }
  return null;
};

const programmeConfigPath = resolveProgrammeConfigPath();

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,

  /**
   * If you are using `appDir` then you must comment the below `i18n` config out.
   *
   * @see https://github.com/vercel/next.js/issues/41980
   */
  i18n: {
    locales: ["en"],
    defaultLocale: "en",
  },
  ...(basePath ? { basePath } : {}),
  transpilePackages: ["geist"],
  webpack: (webpackConfig, { dev, webpack }) => {
    if (programmeConfigPath) {
      webpackConfig.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /[\\/]src[\\/]data[\\/]filmClubProgramme\.json$/,
          programmeConfigPath,
        ),
      );
    }

    if (dev) {
      webpackConfig.watchOptions = {
        ...(webpackConfig.watchOptions ?? {}),
        ignored: [
          "**/.cache/**",
          "**/data/**",
          "**/docs/references/**",
          "**/public/VHS/generated/**",
        ],
      };
    }

    return webpackConfig;
  },
};

export default config;
