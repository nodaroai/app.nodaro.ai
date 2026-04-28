import { supabase } from "./supabase.js"
import { getStaticAllowedOrigins } from "./allowed-origins.js"

const TTL_MS = 60_000

interface CacheState {
  origins: Set<string>
  expiresAt: number
}

let state: CacheState | null = null
let inflight: Promise<Set<string>> | null = null

async function loadFromDB(): Promise<Set<string>> {
  const set = new Set(getStaticAllowedOrigins())  // operator's own frontend always allowed
  const { data } = await supabase
    .from("developer_apps")
    .select("allowed_origins")
    .eq("status", "active")
  for (const row of data ?? []) {
    for (const o of (row.allowed_origins as string[]) ?? []) set.add(o)
  }
  return set
}

async function refresh(): Promise<Set<string>> {
  if (inflight) return inflight  // stampede protection
  inflight = loadFromDB()
    .then((origins) => {
      state = { origins, expiresAt: Date.now() + TTL_MS }
      return origins
    })
    .finally(() => { inflight = null })
  return inflight
}

/** Async — checks DB if cache stale. Used by Fastify CORS origin callback. */
export async function isOriginAllowedDynamic(origin: string | undefined): Promise<boolean> {
  if (!origin) return false
  if (!state || state.expiresAt < Date.now()) {
    await refresh()
  }
  return state!.origins.has(origin)
}

/** Force cache refresh on next call. Called from developer-apps create/update/delete. */
export function invalidateDynamicOriginsCache(): void {
  state = null
}
