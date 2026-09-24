import type { PluginDaemon } from "./daemon-contract.js"

/**
 * Runtime checks for `PluginDaemon` lists — shared by the loader (a malformed
 * list is a load failure) and the daemon host (which mounts routes under each
 * name). Kept out of `daemon-contract.ts`, which is a type-only mirror.
 */

/** A daemon's name is also its URL prefix on the internal listener. */
export const DAEMON_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Names a daemon may not take: `health` would put its routes on the host's one open prefix. */
const RESERVED_DAEMON_NAMES: ReadonlySet<string> = new Set(["health"])

function daemonShapeProblem(candidate: unknown): string | null {
  const daemon = candidate as Partial<PluginDaemon> | null
  const name = daemon?.name
  if (typeof name !== "string" || !DAEMON_NAME_RE.test(name)) {
    return `daemon name ${JSON.stringify(name)} must be lowercase letters, digits and dashes (max 64)`
  }
  if (RESERVED_DAEMON_NAMES.has(name)) return `daemon name "${name}" is reserved by the host`
  if (typeof daemon?.start !== "function") return `daemon "${name}" has no start()`
  if (daemon.registerInternalRoutes !== undefined && typeof daemon.registerInternalRoutes !== "function") {
    return `daemon "${name}" registerInternalRoutes is not a function`
  }
  if (daemon.health !== undefined && typeof daemon.health !== "function") {
    return `daemon "${name}" health is not a function`
  }
  return null
}

/** What is wrong with this daemon list, or null when it can be hosted. */
export function daemonListProblem(daemons: readonly unknown[]): string | null {
  const shapeProblem = daemons.map(daemonShapeProblem).find((problem) => problem !== null)
  if (shapeProblem) return shapeProblem
  const names = daemons.map((daemon) => (daemon as PluginDaemon).name)
  const duplicate = names.find((name, index) => names.indexOf(name) !== index)
  return duplicate === undefined ? null : `daemon name "${duplicate}" is registered twice`
}
