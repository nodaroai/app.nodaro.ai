import { pathToFileURL } from "node:url"
import { selfhostKeysProblem, selfhostKeysWarning } from "./selfhost-keys-settings.js"

/**
 * CLI entry for start.sh and the compose file's one-shot check: the server's
 * own rule on the Supabase keys (lib/selfhost-keys-settings.ts), run before
 * anything starts.
 *
 *     if ! node /app/backend/dist/lib/selfhost-keys-check.js; then … exit 1; fi
 *
 * The API refuses the same keys at boot (config.ts), but that alone closes
 * nothing: start.sh restarts a refusing API in a loop and still starts the
 * proxy, which hands /supabase/* to the auth and database services. Exit 1
 * with one line naming what to fix, else 0 (with a warning when the
 * quick-start runs on the public defaults). The optional argument is the log
 * label (default "[start.sh]"). Pure: it reads only the environment and
 * imports nothing that loads the server's configuration.
 */
export function checkSelfhostKeys(env: Readonly<Record<string, string | undefined>>, log: (line: string) => void, label = "[start.sh]"): number {
  const problem = selfhostKeysProblem(env)
  if (problem !== null) {
    log(`${label} refusing to start: ${problem}`)
    return 1
  }
  const warning = selfhostKeysWarning(env)
  if (warning !== null) log(`${label} WARNING: ${warning}`)
  return 0
}

const isCli = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCli) process.exitCode = checkSelfhostKeys(process.env, (line) => console.error(line), process.argv[2] || undefined)
