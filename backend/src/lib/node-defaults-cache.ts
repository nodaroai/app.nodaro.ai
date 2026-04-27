// 60s TTL cache for `node_defaults`, mirroring `app-settings.ts`.
// Stampede-safe via inflight-promise dedup; invalidated by admin write routes.

import { supabase } from "./supabase.js"

export interface NodeDefaultRow {
  node_type: string
  provider: string
  quality_level: "low" | "mid" | "high" | null
  aspect_ratio: "auto" | "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | null
  updated_at: string
  updated_by: string | null
}

const CACHE_TTL_MS = 60_000

let cachedRows: NodeDefaultRow[] | null = null
let cacheTimestamp = 0
let inflight: Promise<NodeDefaultRow[]> | null = null

export async function getNodeDefaults(): Promise<NodeDefaultRow[]> {
  const now = Date.now()
  if (cachedRows && now - cacheTimestamp < CACHE_TTL_MS) return cachedRows
  if (inflight) return inflight

  inflight = refreshNodeDefaults()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

async function refreshNodeDefaults(): Promise<NodeDefaultRow[]> {
  const { data, error } = await supabase.from("node_defaults").select("*")
  if (error) {
    console.error("[node-defaults-cache] fetch failed:", error.message)
    return cachedRows ?? []
  }
  cachedRows = (data ?? []) as NodeDefaultRow[]
  cacheTimestamp = Date.now()
  return cachedRows
}

export function invalidateNodeDefaultsCache(): void {
  cachedRows = null
  cacheTimestamp = 0
}
