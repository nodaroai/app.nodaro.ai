import { pathToFileURL } from "node:url"

/**
 * CLI entry for start.sh (SAI-3 / H10): prints the browser's surface profile —
 * see surface-profile-runtime-config.ts — so the container's /config.js writer
 * receives the backend's OWN resolved profile instead of re-parsing the env.
 *
 *     RUNTIME_SURFACE_PROFILE="$(node /app/backend/dist/lib/print-surface-profile.js)"
 *
 * stdout IS the payload, so it must be exactly the JSON or nothing. Two things
 * conspire to put a stray line there, and both are handled here rather than
 * trusted to the caller:
 *   - config.ts does `import "dotenv/config"`, and dotenv ≥17 announces itself
 *     on STDOUT ("[dotenv@…] injecting env …") unless DOTENV_CONFIG_QUIET is
 *     set. Static imports are hoisted, so the env is set first and the module
 *     graph is loaded by a dynamic import AFTER it.
 *   - every degrade notice in the resolver is console.warn, which Node writes
 *     to stderr — start.sh leaves stderr alone, so those still reach the log.
 *
 * Any failure (config.ts throwing on a missing required env, an import error)
 * exits non-zero with nothing on stdout; start.sh treats that as "no override"
 * and the backend's own boot then reports the real cause.
 */
const isCli = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href

if (isCli) {
  process.env.DOTENV_CONFIG_QUIET ??= "true"
  try {
    const { renderSurfaceProfileForRuntimeConfig } = await import("./surface-profile-runtime-config.js")
    process.stdout.write(renderSurfaceProfileForRuntimeConfig())
  } catch (err) {
    console.error("[print-surface-profile] could not resolve the surface profile:", (err as Error).message)
    process.exitCode = 1
  }
}
