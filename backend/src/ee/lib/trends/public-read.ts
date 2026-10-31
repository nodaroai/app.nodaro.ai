/**
 * What the public trend reads (the catalog, its tags, a trend's page) do
 * around their data: their rate limit, a guest's language, a guest's kept
 * answer (catalog-stamp.ts), and the cache headers that let the edge keep a
 * guest's answer while no cache keeps a signed-in one.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import { LANGUAGES } from "@nodaro/shared/i18n"
import { rateLimitAddressKey } from "../../../lib/client-address.js"
import { TRENDS_CATALOG_CACHE_TAG, trendCatalogEdgeConfigured } from "./edge-purge.js"
import { keepGuestAnswer, keptGuestAnswer, trendCatalogGeneration, trendCatalogStamp } from "./catalog-stamp.js"
import { acceptedLocale } from "./localize.js"

const LOCALE_IDS: ReadonlyArray<string> = LANGUAGES.map((l) => l.id)
const LOCALES: ReadonlySet<string> = new Set(LOCALE_IDS)

/** A guest's language: `?locale=` when it is a platform language, else `Accept-Language`, else English (never a database read). */
export function guestLocale(req: FastifyRequest, raw: string | undefined): string {
  if (raw && LOCALES.has(raw)) return raw
  return acceptedLocale(req.headers["accept-language"], LOCALE_IDS) ?? "en"
}

/** Where a guest's answer is kept: under the catalog stamp read BEFORE it is built, with this process's change count then. */
export interface GuestKeep {
  stamp: string
  key: string
  builtAt: number
}

/**
 * Where to keep this answer: a guest's only, under `key` (made from the parsed
 * query, never the raw one, so a stray parameter keeps nothing new). Null for
 * a signed-in caller, for an answer not kept (`key` null), or when the stamp
 * cannot be read (then the answer is built as if nothing were kept).
 */
export async function guestKeep(userId: string | null, key: string | null): Promise<GuestKeep | null> {
  if (userId !== null || key === null) return null
  const builtAt = trendCatalogGeneration()
  const stamp = await trendCatalogStamp()
  return stamp === null ? null : { stamp, key, builtAt }
}

/** The answer kept at `keep`, or undefined. */
export function keptHit(keep: GuestKeep | null): unknown {
  return keep ? keptGuestAnswer(keep.stamp, keep.key) : undefined
}

/** Send a public read's answer with its cache headers, keeping a guest's for the next guest. */
export function sendPublicRead<T>(
  reply: FastifyReply,
  userId: string | null,
  rawLocale: string | undefined,
  keep: GuestKeep | null,
  body: T,
): T {
  publicReadCache(reply, userId, {
    namedLocale: rawLocale !== undefined && LOCALES.has(rawLocale),
    edgeKeeps: trendCatalogEdgeConfigured(),
  })
  if (keep) keepGuestAnswer(keep.stamp, keep.key, body, keep.builtAt)
  return body
}

/**
 * This many a minute to each read, per address for a guest and per account
 * when signed in. Keyed after the auth hook (`preHandler`) on who it resolved,
 * never on the raw Authorization header: these routes serve a request with an
 * invalid bearer as a guest, so a header key would give every made-up bearer
 * its own bucket.
 */
export const PUBLIC_READ_LIMIT = {
  rateLimit: {
    max: 60,
    timeWindow: "1 minute",
    hook: "preHandler" as const,
    keyGenerator: (req: FastifyRequest) => (req.userId ? `user:${req.userId}` : rateLimitAddressKey(req)),
  },
}

/** How long a browser may keep a guest's answer: a publish or an edit shows within this. */
export const GUEST_CACHE_SECONDS = 60

/**
 * How long the edge may keep a guest's answer that names its language
 * (`?locale=`), when this deployment can drop the edge's copies on every
 * change (edge-purge.ts): a day, the backstop to a missed purge.
 */
export const EDGE_CACHE_SECONDS = 24 * 60 * 60

/** Adds `names` to the reply's `Vary`, keeping what is there (CORS's `Origin`). */
function addVary(reply: FastifyReply, names: string[]): void {
  const current = reply.getHeader("Vary")
  const have = (Array.isArray(current) ? current.join(",") : String(current ?? ""))
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
  const lower = new Set(have.map((v) => v.toLowerCase()))
  reply.header("Vary", [...have, ...names.filter((n) => !lower.has(n.toLowerCase()))].join(", "))
}

/**
 * Set on a public read's answer, never on a failure.
 *
 * - Signed in: the caller's favorites and language — no cache keeps it.
 * - A guest whose language came from `Accept-Language`: the same for every
 *   guest of that language, but the edge keys a copy by its address alone (it
 *   does not honour `Vary` here), so only the browser keeps it.
 * - A guest who named the language (`?locale=`): the address says everything
 *   the answer depends on, so a shared cache may keep it — a day at the edge,
 *   tagged so every change drops it, when this deployment can drop it
 *   (`edgeKeeps`); otherwise as long as a browser.
 */
export function publicReadCache(
  reply: FastifyReply,
  userId: string | null,
  opts: { namedLocale: boolean; edgeKeeps: boolean },
): void {
  if (userId !== null) {
    reply.header("Cache-Control", "private, no-store")
    return
  }
  if (!opts.namedLocale) {
    reply.header("Cache-Control", `private, max-age=${GUEST_CACHE_SECONDS}`)
    addVary(reply, ["Accept-Language", "Authorization"])
    return
  }
  if (opts.edgeKeeps) {
    reply.header("Cache-Control", `public, max-age=${GUEST_CACHE_SECONDS}, s-maxage=${EDGE_CACHE_SECONDS}`)
    reply.header("Cache-Tag", TRENDS_CATALOG_CACHE_TAG)
  } else {
    reply.header("Cache-Control", `public, max-age=${GUEST_CACHE_SECONDS}`)
  }
  addVary(reply, ["Authorization"])
}
