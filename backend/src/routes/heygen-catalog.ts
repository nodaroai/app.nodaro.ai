import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import {
  snapshotAvatars,
  snapshotVoices,
  type CatalogSince,
  type CatalogSnapshot,
} from "../providers/heygen/catalog.js"
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
 * The answer is PROGRESSIVE and DELTA-shaped:
 *   `{ avatars, offset, total, complete, generation }` (resp. `voices`).
 * On a warm cache `complete` is true. On a cold cache the catalog module
 * answers with the pages HeyGen has returned so far and `complete:false`; the
 * client re-polls until the list is whole. A client that already holds part
 * of a generation sends `?offset=<what it has>&generation=<id>` and receives
 * only the items after that — the whole catalog crosses the wire once, not on
 * every poll (≈7,000 looks / ≈2.7 MB). Without the params (older clients) the
 * whole list is sent, as before. A partial or empty answer is sent
 * `Cache-Control: no-store`; only a whole, non-empty, from-zero list gets the
 * long public cache (a browser-pinned `[]` would defeat the "paste a key,
 * pickers fill" self-heal).
 *
 * When HEYGEN_API_KEY is unset, the catalog functions return [] gracefully
 * (200 with empty arrays, no error) — EXCEPT on an install that is connected
 * to nodaro.ai: its avatar jobs run on the connection (see
 * workers/handlers/cloud-video-relay.ts), so its pickers must list what the
 * cloud can render. The cloud serves the same public routes; relay them (query
 * string included), and cache a whole list as the local functions do.
 */

const CLOUD_CATALOG_TTL_MS = 60 * 60 * 1000

interface CachedList<T> {
  readonly at: number
  readonly items: T[]
  readonly generation: string
}
let cloudAvatars: CachedList<unknown> | null = null
let cloudVoices: CachedList<unknown> | null = null

/** The cloud used to build ITS list from HeyGen on a cold cache before
 *  answering (paginated, minutes); it now answers progressively, but stay
 *  generous — the answer is cached for an hour after. */
const CLOUD_CATALOG_TIMEOUT_MS = 45_000

const sinceSchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  generation: z.string().min(1).max(64).optional(),
})

/** `?offset=&generation=` → a CatalogSince, or undefined when absent/invalid
 *  (an invalid pair simply means "send me everything"). */
function parseSince(query: unknown): CatalogSince | undefined {
  const parsed = sinceSchema.safeParse(query ?? {})
  if (!parsed.success) return undefined
  const { offset, generation } = parsed.data
  return offset !== undefined && generation ? { offset, generation } : undefined
}

function sinceQuery(since: CatalogSince | undefined): string {
  return since ? `?offset=${since.offset}&generation=${encodeURIComponent(since.generation)}` : ""
}

function snapshotFromBody<T>(json: Record<string, unknown> | null, field: string): CatalogSnapshot<T> {
  const items = json?.[field]
  const list = Array.isArray(items) ? (items as T[]) : []
  const offset = typeof json?.offset === "number" && json.offset >= 0 ? json.offset : 0
  return {
    items: list,
    offset,
    total: typeof json?.total === "number" ? json.total : offset + list.length,
    // An older cloud that does not send `complete` sends whole lists only.
    complete: json?.complete !== false,
    generation: typeof json?.generation === "string" && json.generation ? json.generation : "cloud",
  }
}

async function fetchCloudCatalog<T>(path: string, field: string, since: CatalogSince | undefined): Promise<CatalogSnapshot<T>> {
  const res = await fetch(`${nodaroCloudBase()}${path}${sinceQuery(since)}`, { signal: AbortSignal.timeout(CLOUD_CATALOG_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`nodaro.ai ${path} answered ${res.status}`)
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
  return snapshotFromBody<T>(json, field)
}

/** Answer from a cached whole list, honouring the caller's offset when it is
 *  talking about this generation. */
function fromCache<T>(cache: CachedList<unknown>, since: CatalogSince | undefined): CatalogSnapshot<T> {
  const items = cache.items as T[]
  const offset =
    since && since.generation === cache.generation && since.offset >= 0 && since.offset <= items.length
      ? since.offset
      : 0
  return { items: offset ? items.slice(offset) : items, offset, total: items.length, complete: true, generation: cache.generation }
}

async function catalogThroughConnection<T>(
  path: string,
  field: string,
  since: CatalogSince | undefined,
  cache: CachedList<unknown> | null,
  store: (v: CachedList<unknown>) => void,
): Promise<CatalogSnapshot<T>> {
  if (cache && Date.now() - cache.at < CLOUD_CATALOG_TTL_MS) return fromCache<T>(cache, since)
  try {
    // While the cloud is still filling, pass the client's delta request
    // straight through — the client's generation IS the cloud's, so only the
    // new pages cross the wire, and nothing partial is cached here.
    const snap = await fetchCloudCatalog<T>(path, field, since)
    if (!snap.complete) return snap
    // Whole: fetch the entire list once (a delta answer only holds the tail),
    // cache it for the hour, and answer from the cache from now on.
    const whole = snap.offset === 0 ? snap : await fetchCloudCatalog<T>(path, field, undefined)
    if (whole.complete && whole.offset === 0) {
      const cached = { at: Date.now(), items: whole.items, generation: whole.generation }
      store(cached)
      return fromCache<T>(cached, since)
    }
    return snap
  } catch (err) {
    console.error(`[heygen/catalog] cloud relay ${path} failed:`, err instanceof Error ? err.message : err)
    return cache
      ? fromCache<T>(cache, since)
      : { items: [], offset: 0, total: 0, complete: true, generation: "cloud" }
  }
}

/** Test hook: forget the relayed catalog. */
export function _resetCloudHeygenCatalogForTests(): void {
  cloudAvatars = null
  cloudVoices = null
}

/**
 * Only a WHOLE, NON-EMPTY, FROM-ZERO list earns the hour-long public cache. A
 * partial list must not be pinned (the rest is still arriving), a delta is
 * client-specific, and an empty one must not be either: a keyless install
 * that pastes its key expects the pickers to fill on their next poll, which a
 * browser-cached `[]` would defeat.
 */
function setCatalogCacheHeader(reply: FastifyReply, snap: CatalogSnapshot<unknown>): void {
  reply.header(
    "Cache-Control",
    snap.complete && snap.offset === 0 && snap.items.length > 0
      ? "public, max-age=3600, stale-while-revalidate=86400"
      : "no-store",
  )
}

export async function heygenCatalogRoutes(app: FastifyInstance) {
  app.get("/v1/heygen/avatars", async (req, reply) => {
    const since = parseSince(req.query)
    const snap = (await shouldRunOnCloud(config.HEYGEN_API_KEY))
      ? await catalogThroughConnection("/v1/heygen/avatars", "avatars", since, cloudAvatars, (v) => { cloudAvatars = v })
      : await snapshotAvatars(since)
    setCatalogCacheHeader(reply, snap)
    return reply.send({ avatars: snap.items, offset: snap.offset, total: snap.total, complete: snap.complete, generation: snap.generation })
  })

  app.get("/v1/heygen/voices", async (req, reply) => {
    const since = parseSince(req.query)
    const snap = (await shouldRunOnCloud(config.HEYGEN_API_KEY))
      ? await catalogThroughConnection("/v1/heygen/voices", "voices", since, cloudVoices, (v) => { cloudVoices = v })
      : await snapshotVoices(since)
    setCatalogCacheHeader(reply, snap)
    return reply.send({ voices: snap.items, offset: snap.offset, total: snap.total, complete: snap.complete, generation: snap.generation })
  })
}
