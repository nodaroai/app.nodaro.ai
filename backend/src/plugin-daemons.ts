/**
 * Plugin daemon host — entry point for long-lived private-plugin processes
 * (`PluginDaemon`, contributed through a plugin's `daemons()`).
 *
 * Cloud-only: exits cleanly on other editions, so the same image serves every
 * edition. Two ways to run it, one process either way (never both at once):
 *   - its own service from this image, start command
 *     `node /app/backend/dist/plugin-daemons.js`, ONE replica;
 *   - inside the app container, supervised by start.sh, when
 *     PLUGIN_DAEMONS_IN_CONTAINER=true — only while the app runs one replica.
 *
 * With no daemons to host (a plugin-version lag, or a degraded load under
 * PRIVATE_MODULES=optional) it stays up and answers /health, instead of
 * exiting into a restart loop.
 *
 * Usage: node dist/plugin-daemons.js
 */

import { config, hasCredits } from "./lib/config.js"
import { loadOverlay } from "./lib/overlay/load.js"
import { initializeExternalWallet } from "./lib/external-wallet.js"
import { registerMainlinePromptPolicies } from "./lib/prompt-policies/index.js"
import type { PluginDaemonHost } from "./lib/plugin-daemons/host.js"

/** Upper bound on any shutdown: the host's drain window plus a margin, then exit regardless. */
const FORCE_EXIT_MS = 13_000

/**
 * What a log line may carry about an error: its stack (name + message), never
 * the whole object — a provider error can hold request config with credentials.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`
  return String(err)
}

// Set once the host runs, so a fatal error still drains: daemons release
// their leases and connections instead of leaving them to expire.
let shutdownHook: ((code: number) => Promise<void>) | null = null

// A daemon holds leases and live connections: an unknown state is worse than
// a restart — but the restart goes through the same bounded drain as SIGTERM.
function fatal(label: string, err: unknown): void {
  console.error(`[plugin-daemons] ${label}: ${describeError(err)}`)
  if (shutdownHook) void shutdownHook(1)
  else process.exit(1)
}
process.on("unhandledRejection", (err) => fatal("unhandled rejection", err))
process.on("uncaughtException", (err) => fatal("uncaught exception", err))

/**
 * One shutdown for every trigger (SIGTERM, SIGINT, a crashed daemon, a fatal
 * error): stop the host once, then exit with the trigger's code — even when
 * stopping throws, and at the latest after FORCE_EXIT_MS.
 */
function makeShutdown(getHost: () => PluginDaemonHost | null): (code: number) => Promise<void> {
  let stopping = false
  return async (code) => {
    if (stopping) return
    stopping = true
    setTimeout(() => process.exit(code), FORCE_EXIT_MS).unref()
    console.info("[plugin-daemons] shutting down...")
    try {
      await getHost()?.stop()
    } catch (err) {
      console.error(`[plugin-daemons] shutdown did not complete cleanly: ${describeError(err)}`)
    } finally {
      process.exit(code)
    }
  }
}

/** Cloud only: load every plugin's daemons and host them until a signal or a crash. */
async function hostDaemons(): Promise<void> {
  // Imported after the edition gate: the toolkit graph opens a Redis
  // connection at module load, which would keep a non-cloud process alive
  // instead of letting it exit cleanly (pipeline-worker.ts does the same).
  const [{ loadPrivatePlugins }, { buildToolkit }, { startPluginDaemonHost }] = await Promise.all([
    import("./lib/private-plugins/load.js"),
    import("./lib/private-plugins/toolkit.js"),
    import("./lib/plugin-daemons/host.js"),
  ])

  const { daemons = [] } = await loadPrivatePlugins({ daemons: true, toolkit: buildToolkit({ role: "daemon" }) })

  let host: PluginDaemonHost | null = null
  const shutdown = makeShutdown(() => host)
  shutdownHook = shutdown

  host = await startPluginDaemonHost({
    daemons,
    port: config.PLUGIN_DAEMONS_PORT,
    host: config.PLUGIN_DAEMONS_HOST,
    secret: config.INTERNAL_ORCHESTRATOR_SECRET,
    onCrash: (name, err) => {
      console.error(`[plugin-daemons] daemon "${name}" stopped unexpectedly: ${describeError(err)}`)
      void shutdown(1)
    },
  })

  console.info(
    `[plugin-daemons] hosting ${daemons.length} daemon(s) [${daemons.map((d) => d.name).join(", ")}] on port ${host.port}`,
  )

  process.on("SIGTERM", () => void shutdown(0))
  process.on("SIGINT", () => void shutdown(0))
}

async function main() {
  // Same boot order as the other workers: overlay first, then the wallet,
  // then the mainline prompt policies (a platform safety invariant a daemon
  // inherits the moment it asks the toolkit for a generation).
  await loadOverlay()
  await initializeExternalWallet(true)
  registerMainlinePromptPolicies()

  if (!hasCredits()) {
    console.info("[plugin-daemons] EDITION is not cloud — no plugin daemons to host")
    return
  }
  await hostDaemons()
}

main().catch((err) => fatal("fatal", err))
