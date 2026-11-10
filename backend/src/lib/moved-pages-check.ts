import { pathToFileURL } from "node:url"
import { movedPagesSettingsProblem } from "./moved-pages-settings.js"

/**
 * CLI entry for start.sh: the server's own check of the settings that move the
 * app's pages to their own host (lib/moved-pages-settings.ts), run before
 * anything starts.
 *
 *     if ! node /app/backend/dist/lib/moved-pages-check.js; then … exit 1; fi
 *
 * start.sh starts the proxy and writes /config.js whatever the API does, so
 * without this a value the server refuses would still turn the proxy's or the
 * browser's half of the move on. Pure: it reads only the environment and
 * imports nothing that loads the server's configuration.
 */
export function checkMovedPagesSettings(env: Readonly<Record<string, string | undefined>>, log: (line: string) => void): number {
  const problem = movedPagesSettingsProblem(env)
  if (problem === null) return 0
  log(`[start.sh] refusing to start: ${problem}`)
  return 1
}

const isCli = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCli) process.exitCode = checkMovedPagesSettings(process.env, (line) => console.error(line))
