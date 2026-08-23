import { getProfile, setProfile, type Profile } from "./config.js"

/**
 * Which workspace the CLI acts in.
 *
 * Three ways to say it, in this order, each beating the one below:
 *
 *   1. `--workspace <id>` — this invocation only.
 *   2. `NODARO_WORKSPACE` — this shell or this CI job.
 *   3. the profile's saved workspace (`nodaro workspace use <id>`).
 *
 * The order is the point. A CI job sets the variable once for the whole
 * pipeline and every command inherits it; a person overrides one command
 * without disturbing what they saved; and neither has to remember to undo
 * anything. Saving is the only one that persists, and it is the only one
 * that took an explicit decision.
 *
 * A selection here decides which workspace a LIST reads from and where a
 * CREATE lands. It never authorizes: pointing at the wrong workspace wastes
 * a command, it cannot reach anyone else's work.
 */

let flagOverride: string | undefined

/** Set once from the root command's `--workspace`, before any action runs. */
export function setWorkspaceFlag(workspaceId: string | undefined): void {
  flagOverride = workspaceId?.trim() || undefined
}

export interface ResolvedWorkspace {
  workspaceId: string | undefined
  source: "flag" | "env" | "profile" | "none"
}

export function resolveWorkspace(profile: Profile | undefined): ResolvedWorkspace {
  if (flagOverride) return { workspaceId: flagOverride, source: "flag" }
  const env = process.env.NODARO_WORKSPACE?.trim()
  if (env) return { workspaceId: env, source: "env" }
  const saved = profile?.workspace?.trim()
  if (saved) return { workspaceId: saved, source: "profile" }
  return { workspaceId: undefined, source: "none" }
}

/**
 * Remember a workspace on a profile, or forget it with `null`.
 *
 * Writes through `setProfile` rather than touching the file, so the token
 * and base URL are carried over and the 0600 mode is re-applied — a saved
 * workspace must never be the reason a credentials file loosens.
 */
export function saveWorkspace(profileName: string | undefined, workspaceId: string | null): string {
  const { name, profile } = getProfile(profileName)
  if (!profile) throw new Error(`no credentials for profile "${name}" — run: nodaro auth login`)
  // Spread, not a rebuild: a rebuild silently drops any field added to
  // Profile later, and losing part of a credentials row to save a preference
  // is the wrong trade in every direction.
  const next: Profile = { ...profile }
  if (workspaceId) next.workspace = workspaceId
  else delete next.workspace
  setProfile(name, next)
  return name
}
