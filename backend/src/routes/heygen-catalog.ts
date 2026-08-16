import type { FastifyInstance } from "fastify"
import { listAvatars, listVoices } from "../providers/heygen/catalog.js"
import { config } from "../lib/config.js"
import { shouldRunOnCloud } from "../providers/nodaro/run-on-cloud.js"
import { nodaroCloudBase } from "../lib/nodaro-connect.js"

/**
 * Public catalog routes for HeyGen avatars and voices.
 *
 * Both endpoints are added to PUBLIC_ROUTES in middleware/auth.ts because:
 * - They serve read-only catalog data (no user-specific content).
 * - Published apps render avatar/voice pickers for ANONYMOUS viewers; an
 *   authenticated-only route would 401 those picker requests.
 *
 * When HEYGEN_API_KEY is unset, the underlying catalog functions return []
 * gracefully (200 with empty arrays, no error) — EXCEPT on an install that
 * is connected to nodaro.ai: its avatar jobs run on the connection (see
 * workers/handlers/cloud-video-relay.ts), so its pickers must list what the
 * cloud can render. The cloud serves the same public routes; relay them, and
 * cache the answer as the local functions do.
 */

const CLOUD_CATALOG_TTL_MS = 60 * 60 * 1000

interface CachedList<T> {
  readonly at: number
  readonly items: T[]
}
let cloudAvatars: CachedList<unknown> | null = null
let cloudVoices: CachedList<unknown> | null = null

/** The cloud builds ITS list from HeyGen on a cold cache (paginated, tens of
 *  seconds); a tight timeout answered [] on the first picker open (seen live
 *  2026-08-16). Generous here — the answer is cached for an hour after. */
const CLOUD_CATALOG_TIMEOUT_MS = 45_000

async function fetchCloudCatalog<T>(path: string, field: string): Promise<T[]> {
  const res = await fetch(`${nodaroCloudBase()}${path}`, { signal: AbortSignal.timeout(CLOUD_CATALOG_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`nodaro.ai ${path} answered ${res.status}`)
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
  const items = json?.[field]
  return Array.isArray(items) ? (items as T[]) : []
}

async function catalogThroughConnection<T>(
  path: string,
  field: string,
  cache: CachedList<unknown> | null,
  store: (v: CachedList<unknown>) => void,
): Promise<T[]> {
  if (cache && Date.now() - cache.at < CLOUD_CATALOG_TTL_MS) return cache.items as T[]
  try {
    const items = await fetchCloudCatalog<T>(path, field)
    store({ at: Date.now(), items })
    return items
  } catch (err) {
    console.error(`[heygen/catalog] cloud relay ${path} failed:`, err instanceof Error ? err.message : err)
    return (cache?.items as T[] | undefined) ?? []
  }
}

/** Test hook: forget the relayed catalog. */
export function _resetCloudHeygenCatalogForTests(): void {
  cloudAvatars = null
  cloudVoices = null
}

export async function heygenCatalogRoutes(app: FastifyInstance) {
  app.get("/v1/heygen/avatars", async (_req, reply) => {
    const avatars = (await shouldRunOnCloud(config.HEYGEN_API_KEY))
      ? await catalogThroughConnection("/v1/heygen/avatars", "avatars", cloudAvatars, (v) => { cloudAvatars = v })
      : await listAvatars()
    reply.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
    return reply.send({ avatars })
  })

  app.get("/v1/heygen/voices", async (_req, reply) => {
    const voices = (await shouldRunOnCloud(config.HEYGEN_API_KEY))
      ? await catalogThroughConnection("/v1/heygen/voices", "voices", cloudVoices, (v) => { cloudVoices = v })
      : await listVoices()
    reply.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
    return reply.send({ voices })
  })
}
