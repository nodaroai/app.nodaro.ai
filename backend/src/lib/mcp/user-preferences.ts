/**
 * Per-user MCP preferences resolver.
 *
 * Stored on `profiles.mcp_preferences` (JSONB). Read with a small in-process
 * cache so we don't round-trip to the DB on every tool call. Cache is
 * invalidated when a user updates prefs via PATCH /v1/user/settings (the
 * route calls `invalidateUserPreferences(userId)` after a successful write).
 *
 * Used in MCP verb handlers to pick the right value when the caller didn't
 * specify one. Resolution order: explicit arg > user pref > catalog default.
 */
import { supabase } from "../supabase.js"

export interface UserMcpPreferences {
  image?: {
    model?: string
    aspectRatio?: string
    resolution?: string
    quality?: string
  }
  video?: {
    model?: string
    aspectRatio?: string
    duration?: number
    resolution?: string
  }
  audio?: {
    ttsModel?: string
    musicModel?: string
  }
}

const CACHE_TTL_MS = 60_000

interface CacheEntry {
  value: UserMcpPreferences
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

/**
 * Read the user's saved MCP preferences. Returns an empty object when the
 * user has none, or when the DB read fails — the caller is expected to fall
 * through to the catalog default in either case, so a permissive fallback
 * keeps a transient DB blip from surfacing as a tool error.
 */
export async function getUserMcpPreferences(
  userId: string,
): Promise<UserMcpPreferences> {
  const now = Date.now()
  const hit = cache.get(userId)
  if (hit && hit.expiresAt > now) return hit.value

  // Wrap the DB call in a 500ms timeout so a stalled supabase doesn't hold
  // up an MCP tool call indefinitely. Hitting the timeout is treated the
  // same as a DB error — fall through to catalog defaults.
  let prefs: UserMcpPreferences = {}
  try {
    const dbCall = supabase
      .from("profiles")
      .select("mcp_preferences")
      .eq("id", userId)
      .single()
      .then(({ data, error }) =>
        error || !data ? {} : ((data.mcp_preferences as UserMcpPreferences) ?? {}),
      )
    const timeout = new Promise<UserMcpPreferences>((resolve) =>
      setTimeout(() => resolve({}), 500),
    )
    prefs = await Promise.race([dbCall, timeout])
  } catch {
    prefs = {}
  }

  cache.set(userId, { value: prefs, expiresAt: now + CACHE_TTL_MS })
  return prefs
}

/**
 * Drop a user's cached preferences. Call after PATCH /v1/user/settings
 * succeeds so the next MCP tool call sees the new values.
 */
export function invalidateUserPreferences(userId: string): void {
  cache.delete(userId)
}
