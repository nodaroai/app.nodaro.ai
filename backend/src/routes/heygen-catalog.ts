import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  refreshHeygenCatalog,
  snapshotAvatars,
  snapshotPrivateAvatars,
  snapshotVoices,
  type CatalogSince,
  type CatalogSnapshot,
} from "../providers/heygen/catalog.js"
import { config, hasAdmin } from "../lib/config.js"
import { checkIsAdmin } from "../lib/admin-check.js"
import { rejectProgrammaticAuth } from "../lib/api-auth-mode.js"
import { sendInternalError } from "../lib/http-errors.js"
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
 * Three public routes + one operator action:
 *   GET  /v1/heygen/avatars          HeyGen's PUBLIC preset library (≈7,000 looks)
 *   GET  /v1/heygen/avatars/private  the account's OWN looks (small; refreshed
 *                                    every couple of minutes so a look created
 *                                    a moment ago shows up; clients list it first)
 *   GET  /v1/heygen/voices           ≈2,500 voices
 *   POST /v1/heygen/catalog/refresh  refetch every catalog from HeyGen now (the
 *                                    shared lists otherwise refresh once a day).
 *                                    Signed-in, first-party, admin where the
 *                                    edition has admins — the same gate as the
 *                                    provider-key routes. On a connected install
 *                                    it forgets the relayed copies instead.
 *
 * Privacy note (deliberate, not drift): all three GET routes are anonymous —
 * published apps render the pickers for signed-out viewers. The private
 * route lists the account's OWN looks (name, preview, group, and a
 * processing/failed status while HeyGen builds one); those looks were
 * already inside the anonymous /v1/heygen/avatars answer before the split.
 *
 * The big lists are PROGRESSIVE and DELTA-shaped:
 *   `{ avatars | voices, offset, total, complete, generation }`.
 * On a warm cache `complete` is true. On a cold cache the catalog module
 * answers with the pages HeyGen has returned so far and `complete:false`; the
 * client re-polls until the list is whole. A client that already holds part
 * of a generation sends `?offset=<what it has>&generation=<id>` and receives
 * only the items after that; `?limit=` bounds one answer so a warm list can
 * be streamed in chunks (`total` tells the client whether it is caught up).
 * Without the params (older clients) the whole list is sent, as before. A
 * partial, delta, chunk or empty answer is sent `Cache-Control: no-store`;
 * only a whole, non-empty, from-zero list gets the long public cache (a
 * browser-pinned `[]` would defeat the "paste a key, pickers fill"
 * self-heal). The private list is always sent whole and never long-cached.
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
let cloudPrivateAvatars: CachedList<unknown> | null = null
let cloudVoices: CachedList<unknown> | null = null

/** The cloud's own looks change under it; ask again every couple of minutes. */
const CLOUD_PRIVATE_TTL_MS = 2 * 60 * 1000

/** The cloud used to build ITS list from HeyGen on a cold cache before
 *  answering (paginated, minutes); it now answers progressively, but stay
 *  generous — the answer is cached for an hour after. */
const CLOUD_CATALOG_TIMEOUT_MS = 45_000

const querySchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  generation: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
})

interface CatalogQuery {
  readonly since: CatalogSince | undefined
  readonly limit: number | undefined
}

/** `?offset=&generation=&limit=` → what the caller holds + how much it wants;
 *  an absent/invalid pair simply means "send me everything from zero". */
function parseQuery(query: unknown): CatalogQuery {
  const parsed = querySchema.safeParse(query ?? {})
  if (!parsed.success) return { since: undefined, limit: undefined }
  const { offset, generation, limit } = parsed.data
  return {
    since: offset !== undefined && generation ? { offset, generation } : undefined,
    limit,
  }
}

function toQueryString(q: CatalogQuery): string {
  const params = new URLSearchParams()
  if (q.since) {
    params.set("offset", String(q.since.offset))
    params.set("generation", q.since.generation)
  }
  if (q.limit) params.set("limit", String(q.limit))
  const qs = params.toString()
  return qs ? `?${qs}` : ""
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

async function fetchCloudCatalog<T>(path: string, field: string, q: CatalogQuery): Promise<CatalogSnapshot<T>> {
  const res = await fetch(`${nodaroCloudBase()}${path}${toQueryString(q)}`, { signal: AbortSignal.timeout(CLOUD_CATALOG_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`nodaro.ai ${path} answered ${res.status}`)
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
  return snapshotFromBody<T>(json, field)
}

/** Answer from a cached whole list, honouring the caller's offset (when it is
 *  talking about this generation) and limit. */
function fromCache<T>(cache: CachedList<unknown>, q: CatalogQuery): CatalogSnapshot<T> {
  const items = cache.items as T[]
  const since = q.since
  const offset =
    since && since.generation === cache.generation && since.offset >= 0 && since.offset <= items.length
      ? since.offset
      : 0
  const end = q.limit ? Math.min(items.length, offset + q.limit) : items.length
  return {
    items: offset === 0 && end === items.length ? items : items.slice(offset, end),
    offset,
    total: items.length,
    complete: true,
    generation: cache.generation,
  }
}

const NO_LIMIT: CatalogQuery = { since: undefined, limit: undefined }

async function catalogThroughConnection<T>(
  path: string,
  field: string,
  q: CatalogQuery,
  cache: CachedList<unknown> | null,
  store: (v: CachedList<unknown>) => void,
  ttlMs = CLOUD_CATALOG_TTL_MS,
): Promise<CatalogSnapshot<T>> {
  if (cache && Date.now() - cache.at < ttlMs) return fromCache<T>(cache, q)
  try {
    // While the cloud is still filling, pass the client's delta request
    // straight through — the client's generation IS the cloud's, so only the
    // new pages cross the wire, and nothing partial is cached here. (A chunk
    // request that finds this cache cold costs the chunk PLUS the whole list
    // below — once per hour per relay, amortised over the cached hour.)
    const snap = await fetchCloudCatalog<T>(path, field, q)
    if (!snap.complete) return snap
    // Whole: fetch the entire list once (a delta / chunk only holds part of
    // it), cache it for the hour, and answer from the cache from now on.
    const isWhole = snap.offset === 0 && snap.items.length >= snap.total
    const whole = isWhole ? snap : await fetchCloudCatalog<T>(path, field, NO_LIMIT)
    if (whole.complete && whole.offset === 0 && whole.items.length >= whole.total) {
      const cached = { at: Date.now(), items: whole.items, generation: whole.generation }
      store(cached)
      return fromCache<T>(cached, q)
    }
    return snap
  } catch (err) {
    console.error(`[heygen/catalog] cloud relay ${path} failed:`, err instanceof Error ? err.message : err)
    return cache
      ? fromCache<T>(cache, q)
      : { items: [], offset: 0, total: 0, complete: true, generation: "cloud" }
  }
}

/** Forget the relayed copies — the next request pulls the cloud's current lists. */
function forgetRelayedCatalog(): void {
  cloudAvatars = null
  cloudPrivateAvatars = null
  cloudVoices = null
}

/** Test hook: forget the relayed catalog. */
export function _resetCloudHeygenCatalogForTests(): void {
  forgetRelayedCatalog()
}

const REFRESH_WRITE_MSG = "The HeyGen catalog can only be refreshed from the Nodaro editor, not with an API or app token."

/** Operator gate: signed in, first-party, admin where the edition has them
 *  (mirrors routes/provider-keys.ts — a refresh is ≈140 HeyGen calls on the
 *  operator's account). */
async function authorizeRefresh(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (!req.userId) {
    reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    return false
  }
  if (rejectProgrammaticAuth(req, reply, REFRESH_WRITE_MSG)) return false
  if (hasAdmin()) {
    let admin = false
    try {
      admin = await checkIsAdmin(req.userId)
    } catch (err) {
      // The role lookup itself failed — say so generically (never the raw DB error).
      sendInternalError(reply, req, err, "Failed to verify permissions")
      return false
    }
    if (!admin) {
      reply.status(403).send({ error: { code: "forbidden", message: "Only an admin can refresh the HeyGen catalog on this edition" } })
      return false
    }
  }
  return true
}

/**
 * Only a WHOLE, NON-EMPTY, FROM-ZERO list earns the hour-long public cache. A
 * partial list must not be pinned (the rest is still arriving), a delta or a
 * chunk is client-specific, and an empty one must not be either: a keyless
 * install that pastes its key expects the pickers to fill on their next poll,
 * which a browser-cached `[]` would defeat.
 */
function setCatalogCacheHeader(reply: FastifyReply, snap: CatalogSnapshot<unknown>): void {
  reply.header(
    "Cache-Control",
    snap.complete && snap.offset === 0 && snap.items.length > 0 && snap.items.length >= snap.total
      ? "public, max-age=3600, stale-while-revalidate=86400"
      : "no-store",
  )
}

export async function heygenCatalogRoutes(app: FastifyInstance) {
  app.get("/v1/heygen/avatars", async (req, reply) => {
    const q = parseQuery(req.query)
    const snap = (await shouldRunOnCloud(config.HEYGEN_API_KEY))
      ? await catalogThroughConnection("/v1/heygen/avatars", "avatars", q, cloudAvatars, (v) => { cloudAvatars = v })
      : await snapshotAvatars(q.since, q.limit)
    setCatalogCacheHeader(reply, snap)
    return reply.send({ avatars: snap.items, offset: snap.offset, total: snap.total, complete: snap.complete, generation: snap.generation })
  })

  // The account's own looks: small, whole, fresh. Never long-cached — the
  // point of the separate route is that a look created a moment ago shows up
  // on the next poll, while the big preset list above stays cacheable.
  app.get("/v1/heygen/avatars/private", async (_req, reply) => {
    const avatars = (await shouldRunOnCloud(config.HEYGEN_API_KEY))
      ? (await catalogThroughConnection(
          "/v1/heygen/avatars/private", "avatars", NO_LIMIT, cloudPrivateAvatars,
          (v) => { cloudPrivateAvatars = v }, CLOUD_PRIVATE_TTL_MS,
        )).items
      : await snapshotPrivateAvatars()
    reply.header("Cache-Control", "no-store")
    return reply.send({ avatars })
  })

  app.get("/v1/heygen/voices", async (req, reply) => {
    const q = parseQuery(req.query)
    const snap = (await shouldRunOnCloud(config.HEYGEN_API_KEY))
      ? await catalogThroughConnection("/v1/heygen/voices", "voices", q, cloudVoices, (v) => { cloudVoices = v })
      : await snapshotVoices(q.since, q.limit)
    setCatalogCacheHeader(reply, snap)
    return reply.send({ voices: snap.items, offset: snap.offset, total: snap.total, complete: snap.complete, generation: snap.generation })
  })

  // Manual refresh. Returns at once with what each catalog did ("started" —
  // the fill runs in the background and pickers pick it up on their next
  // poll; "already-running" / "locked-elsewhere" — a refresh is under way
  // here or on another instance; "adopted" — a newer shared snapshot already
  // existed; "unconfigured" — no HeyGen key). Rate-limited: one refresh is
  // ≈140 HeyGen calls.
  app.post(
    "/v1/heygen/catalog/refresh",
    { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!(await authorizeRefresh(req, reply))) return
      if (await shouldRunOnCloud(config.HEYGEN_API_KEY)) {
        // The catalog lives on nodaro.ai; forget the relayed copies so the next
        // picker request pulls the cloud's current lists.
        forgetRelayedCatalog()
        return reply.send({ mode: "connection", avatars: "relay-reset", privateAvatars: "relay-reset", voices: "relay-reset" })
      }
      const result = await refreshHeygenCatalog()
      return reply.send({ mode: "local", ...result })
    },
  )
}
