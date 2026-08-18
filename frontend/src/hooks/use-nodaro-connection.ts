import { useEffect, useState } from "react"
import { hasCredits } from "@/lib/edition"
import { getAuthHeaders } from "@/lib/api"

/**
 * Shared "is this install connected to nodaro.ai?" read (4b).
 *
 * Module-level cache + inflight dedupe (same pattern as
 * use-llm-availability): every consumer — node header chips, connect CTAs,
 * the integrations card — shares ONE fetch per TTL window instead of each
 * card hitting /v1/nodaro-connect/status (which proxies a balance read to
 * the cloud) on its own.
 *
 * On cloud (`hasCredits()`) the exclusive nodes are native — no fetch,
 * statically connected.
 */

export interface NodaroConnectionState {
  /** True when the install has a usable nodaro.ai credential. */
  readonly connected: boolean
  /** False until the first status read settles (render neutrally, not "disconnected"). */
  readonly checked: boolean
}

const TTL_MS = 60_000

let cached: NodaroConnectionState | null = null
let cachedAt = 0
let inflight: Promise<NodaroConnectionState> | null = null
const listeners = new Set<(s: NodaroConnectionState) => void>()

async function fetchState(): Promise<NodaroConnectionState> {
  try {
    const headers = await getAuthHeaders()
    const res = await fetch("/v1/nodaro-connect/status", { headers })
    if (!res.ok) return { connected: false, checked: true }
    const body = (await res.json()) as { connected?: boolean }
    return { connected: body.connected === true, checked: true }
  } catch {
    // Degrade to unconnected — the CTA is a safe default; never throw into render.
    return { connected: false, checked: true }
  }
}

function readShared(): NodaroConnectionState | Promise<NodaroConnectionState> {
  const now = Date.now()
  if (cached && now - cachedAt < TTL_MS) return cached
  if (inflight) return inflight
  inflight = fetchState().then((state) => {
    cached = state
    cachedAt = Date.now()
    inflight = null
    for (const notify of listeners) notify(state)
    return state
  })
  return inflight
}

/** Force the next read to refetch (call after connect/disconnect actions). */
export function invalidateNodaroConnectionCache(): void {
  cached = null
  cachedAt = 0
}

export function _resetNodaroConnectionCacheForTests(): void {
  cached = null
  cachedAt = 0
  inflight = null
  listeners.clear()
}

export function useNodaroConnection(): NodaroConnectionState {
  const [state, setState] = useState<NodaroConnectionState>(() => {
    if (hasCredits()) return { connected: true, checked: true }
    const shared = readShared()
    return shared instanceof Promise ? { connected: false, checked: false } : shared
  })

  useEffect(() => {
    if (hasCredits()) return
    let mounted = true
    const apply = (s: NodaroConnectionState) => {
      if (mounted) setState(s)
    }
    listeners.add(apply)
    const shared = readShared()
    if (shared instanceof Promise) void shared.then(apply)
    else apply(shared)
    return () => {
      mounted = false
      listeners.delete(apply)
    }
  }, [])

  return state
}
