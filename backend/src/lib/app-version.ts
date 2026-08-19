import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

/**
 * The running app's version — env APP_VERSION (baked into published images by
 * community-image.yml from the release tag) with a package.json fallback for
 * dev servers and builds outside the release pipeline (Railway cloud builds
 * currently take the fallback; acceptable per the versioning spec).
 *
 * package.json is deliberately NOT the source of truth: it sat at 1.23.0 for
 * six months while 5,882 commits shipped. Versions come from git tags,
 * computed by backend/scripts/next-app-version.mjs.
 *
 * Read via fs, not an ESM json import: the compiled dist would need import
 * attributes Node enforces at runtime but this tsconfig's module target
 * cannot emit — a boot crash vitest's tolerant resolver never sees (the
 * backend-boot-smoke class). Two candidate paths because the file runs from
 * `src/` in dev and from `dist/backend/src/` in the shipped image.
 */
let cached: string | null = null

export function getAppVersion(): string {
  const env = process.env.APP_VERSION?.trim()
  if (env) return env
  if (cached) return cached
  const here = dirname(fileURLToPath(import.meta.url))
  for (const rel of ["../../package.json", "../../../../package.json"]) {
    try {
      const pkg = JSON.parse(readFileSync(join(here, rel), "utf8")) as { version?: string; name?: string }
      if (pkg.name === "nodaro-backend" && pkg.version) {
        cached = pkg.version
        return cached
      }
    } catch {
      // try the next candidate
    }
  }
  cached = "0.0.0-dev"
  return cached
}

/** Test hook — the module-level cache would otherwise leak between cases. */
export function _resetAppVersionCacheForTests(): void {
  cached = null
}
