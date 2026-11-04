import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  resolveProgrammeConfigPath,
  TEMPLATE_PROGRAMME_PATTERN,
} from "../../src/lib/programmeConfigPath.js";

let registeredPath: string | null = null;

/**
 * Terminal tools run outside Webpack, so the build's replacement of the
 * template programme does not apply. This resolve hook gives later imports
 * the same club programme file as `pnpm build`. Call it before importing
 * modules that read the programme.
 */
export const useClubProgrammeConfig = (
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): string | null => {
  const configPath = resolveProgrammeConfigPath(env, cwd);
  if (!configPath) return null;
  if (registeredPath !== null) {
    if (registeredPath !== configPath) {
      throw new Error("A different club programme file is already in use.");
    }
    return configPath;
  }
  registeredPath = configPath;
  const target = pathToFileURL(configPath).href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      return resolved.url.startsWith("file:") &&
        TEMPLATE_PROGRAMME_PATTERN.test(fileURLToPath(resolved.url))
        ? { ...resolved, url: target, shortCircuit: true }
        : resolved;
    },
  });
  return configPath;
};
