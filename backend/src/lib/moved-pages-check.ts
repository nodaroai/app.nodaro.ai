import { pathToFileURL } from "node:url"
import { flowHostOrigins, legacyUiHostList, movedFlowOrigin, movedPagesSettingsProblem } from "./moved-pages-settings.js"

/**
 * CLI entry for start.sh: the server's own check of the settings that give the
 * app's pages a host of their own (lib/moved-pages-settings.ts), run before
 * anything starts.
 *
 *     if ! node /app/backend/dist/lib/moved-pages-check.js; then … exit 1; fi
 *
 * start.sh starts the proxy and writes /config.js whatever the API does, so
 * without this a value the server refuses would still turn the proxy's or the
 * browser's half on. When the settings run, one line names the state that is
 * on, so a misspelled LEGACY_UI_HOSTS reads as "none redirects" in the log
 * rather than passing unseen. Pure: it reads only the environment and imports
 * nothing that loads the server's configuration.
 */
export function checkMovedPagesSettings(env: Readonly<Record<string, string | undefined>>, log: (line: string) => void): number {
  const problem = movedPagesSettingsProblem(env)
  if (problem !== null) {
    log(`[start.sh] refusing to start: ${problem}`)
    return 1
  }
  const state = flowHostState(env)
  if (state !== null) log(state)
  return 0
}

/** The line naming which state the settings turn on, or null when neither is (nothing set). */
export function flowHostState(env: Readonly<Record<string, string | undefined>>): string | null {
  const origins = flowHostOrigins(env)
  if (origins === null) return null
  if (movedFlowOrigin(env) !== null) {
    return `[start.sh] the app's pages moved to ${origins.flow}: ${legacyUiHostList(env.LEGACY_UI_HOSTS).join(", ")} redirect them there; the API, OAuth and published pages stay on ${origins.kept}`
  }
  return `[start.sh] the app's pages have their own host, ${origins.flow}: every host still serves them and none redirects there (LEGACY_UI_HOSTS is empty); browser settings carry over from ${origins.kept} once, and public pages name their home to search engines`
}

const isCli = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCli) process.exitCode = checkMovedPagesSettings(process.env, (line) => console.error(line))
