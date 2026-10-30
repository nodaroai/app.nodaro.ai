/**
 * /v1/trends — the public trend catalog and trend runs (Cloud: registered
 * under `hasCredits()`).
 *
 *   GET    /v1/trends                    cards of the published catalog
 *   GET    /v1/trends/runs               the caller's trend runs (before /:slug)
 *   GET    /v1/trends/runs/:jobId        one of the caller's trend runs
 *   GET    /v1/trends/tags               the published catalog's tags, labelled (before /:slug)
 *   GET    /v1/trends/:slug              a published trend's page
 *   POST   /v1/trends/:slug/estimate     the quote for a run
 *   POST   /v1/trends/:slug/runs         start a run → 202 { data: { jobId } }
 *   PUT    /v1/trends/:slug/favorite     204
 *   DELETE /v1/trends/:slug/favorite     204
 *
 * Only PUBLISHED trends exist here: a draft, an unpublished or an unknown slug
 * is a 404 on every route (a miss is never a 403).
 *
 * HIDDEN data never leaves: the store hands back a trend version's full data
 * (the uploaded source clip, slot `roleName`, fixed references, trend prompt,
 * the examples' source jobs), so every response is built field by field from
 * the public ones, never spread. The trend's page shows its original from the
 * source's DISPLAY copy (`source.display`: a browser-safe re-encode in its own
 * file), never from the uploaded clip a run edits. A trend run is composed
 * here (`composeTrendRun`) and dispatched to the Cast Swap engine as an
 * INTERNAL request as the caller (the only way a run can carry `trendRun`);
 * the engine keeps the hidden parts in `__` keys of the job's `input_data`,
 * which every job read drops. The run reads redact those keys too and then
 * map each job to the `TrendRun` whitelist.
 *
 * A trend that hides its original (`hideOriginal`) shows Example 1 as its
 * original on the card and the page, and lists its examples from Example 2:
 * neither the source clip nor its display copy is in any response
 * (`shownOriginal`, `listedExamples`). A run's `example` numbers the examples
 * as that page lists them, translated to and from the stored numbering here
 * (public-examples.ts). A Full Quality version of a draft is a run of its own.
 *
 * GUESTS read the catalog: `GET /v1/trends`, `/tags` and `/:slug` take no
 * credential (middleware/auth.ts lists them public), so a visitor sees every
 * published trend and is asked to sign in only to run one. A guest's answer
 * is the signed-in one's published data with `isFavorite: false`, its language
 * from `?locale=` then `Accept-Language`, and a cache may keep it a minute;
 * `favorites=1` is an account read (401). Every other route needs a caller.
 *
 * A signed-in caller's reads need `jobs:read` for an OAuth app; estimate and
 * run `workflows:execute` (as the Cast Swap MCP verb); favorites
 * `assets:write` (as the gallery's).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { LANGUAGES } from "@nodaro/shared/i18n"
import { CAST_SWAP_RESOLUTIONS_BY_ENGINE, nodaroMotionEngineName, nodaroMotionEngineOf, type NodaroMotionEngine } from "@nodaro/shared/models"
import { supabase } from "../../lib/supabase.js"
import { requireScope } from "../../lib/scopes.js"
import { requireAppScope } from "../../lib/scope-prehandler.js"
import { formatZodError } from "../../lib/zod-error.js"
import { afterKeyset, decodeCursor, encodeCursor, findOwnSession, type Keyset } from "../../lib/generation-sessions.js"
import { resolveRequestOrigin } from "../../lib/client-origin-scope.js"
import { callerGrantOf, grantMayWriteSessions } from "../../lib/job-submission-context.js"
import { deriveJobSource } from "../../lib/job-source.js"
import {
  InvalidTrendCursorError,
  TrendsUnavailableError,
  favoriteIds,
  getTrendBySlug,
  getVersion,
  listPublished,
  setFavorite,
} from "../lib/trends/store.js"
import { engineOf, shownChips, trendRunRequestSchema, type ChipKey } from "../lib/trends/schemas.js"
import { acceptedLocale, pickText } from "../lib/trends/localize.js"
import { PUBLIC_READ_LIMIT, publicReadCache } from "../lib/trends/public-read.js"
import { neutralBreakdown, privacyCreditsOf } from "../../lib/nodaro-motion-quote.js"
import { publishedTagUsage, readTagLabels, tagLabel, type TagLabels } from "../lib/trends/tags.js"
import { TrendRunError, composeTrendRun, type ComposedTrendRun } from "../lib/trends/compose.js"
import { listedExamples, shownOriginal, storedExampleRequest } from "../lib/trends/public-examples.js"
import { publicWebCopy } from "../lib/trends/web-copy-plan.js"
import {
  RUN_JOB_COLS,
  SLOT_KINDS,
  engineRequest,
  engineSupports,
  followPreviewMasking,
  withoutUnsupportedFields,
  isRec,
  jobIdOf,
  listedRunsPage,
  parseJson,
  publicRefusal,
  toTrendRuns,
  unavailableOrInternal,
  type RunJobRow,
} from "../lib/trends/run-helpers.js"
import type {
  Choice,
  TrendResolution,
  TrendRow,
  TrendSlot,
  TrendExample,
  TrendSlotKind,
  TrendSourceDisplay,
  TrendVersionData,
} from "../lib/trends/types.js"
import { CHILD_JOB_COLUMN, TRASHED_JOB_COLUMN } from "../../lib/public-job-data.js"

export type { TrendRun } from "../lib/trends/run-helpers.js"

// ── public shapes (mirrored by the SDK) ─────────────────────────────────────

type Chips = Partial<Record<"body" | "outfit" | "hair" | "coat" | "shape" | "finish", Choice>>

/**
 * One video as a public answer shows it. `webUrl` / `webSizeBytes`: its web
 * copy (a light MP4 the platform made for playback: H.264 ~2.5 Mbit/s, AAC
 * 160 kbit/s; played as it is, no CDN transform), absent until it is made.
 */
export interface TrendVideo {
  videoUrl: string
  posterUrl?: string
  width: number
  height: number
  webUrl?: string
  webSizeBytes?: number
}

export interface TrendCard {
  id: string
  slug: string
  name: string
  description?: string
  tags: string[]
  badges: string[]
  /** Example 1, else (a trend with no example) the original's display copy. */
  cover: TrendVideo
  /**
   * The original's display copy (the same address as the page's `original`),
   * absent on a version without one. Never the uploaded source clip. On a
   * trend that hides its original: Example 1 (then the same as `cover`).
   */
  original?: TrendVideo
  /**
   * Every example's video, in order (empty on a trend with none); the pictures
   * each slot used are the page's. On a trend that hides its original, from
   * Example 2 (Example 1 is `original`).
   */
  examples: TrendVideo[]
  needs: Record<TrendSlotKind, number>
  durationSec: number
  isFavorite: boolean
}

/** A tag in use on the published catalog, labelled in the resolved locale (the tag itself when it has no label). */
export interface TrendTag {
  tag: string
  label: string
  count: number
}

/**
 * The clip a trend recasts, as shown: the source's display copy (never the
 * uploaded file a run edits), or Example 1 on a trend that hides its original.
 * `previewStartSec` is where the 4 s preview starts, sent whenever the trend
 * offers one (0 included).
 */
export interface TrendOriginal extends TrendVideo {
  durationSec: number
  previewStartSec?: number
}

export interface TrendDetail extends TrendCard {
  version: number
  previewSec: 4 | null
  /** Absent only on a version whose source has no display copy (none can publish since). */
  original?: TrendOriginal
  /**
   * The engine every run of this trend uses, by its public id (the person
   * never chooses it): `"motion-prism"` or `"motion-pulse"`.
   */
  engine: NodaroMotionEngine
  /** Its name: "Nodaro Motion Prism" or "Nodaro Motion Pulse". */
  engineName: string
  /**
   * The resolutions a run of this trend may ask for, its default first:
   * Nodaro Motion Prism `["480p", "720p", "1080p"]` (480p is the draft),
   * Nodaro Motion Pulse `["720p", "1080p"]` (no draft).
   */
  resolutions: TrendResolution[]
  /**
   * `chips`: the chips the person may set on this slot (its kind's order; `[]`
   * = none, so no chips row). A chip not listed is fixed by the trend, and a
   * run that sends it is refused (`chip_not_offered`). `defaults` covers only
   * the listed chips.
   */
  slots: Array<{
    key: string
    label: string
    kind: TrendSlotKind
    required: boolean
    hint?: string
    /** A picture that shows who or what the slot is in the original (the admin's, optional). */
    hintImageUrl?: string
    chips: ChipKey[]
    defaults?: Chips
  }>
  /**
   * May be empty: a trend can be published with only its original. On a trend
   * that hides its original, from Example 2 (Example 1 is `original`).
   */
  examples: Array<TrendVideo & { slots: Record<string, string[]> }>
}


// ── constants ───────────────────────────────────────────────────────────────

/** Same shape as migration 549's CHECK on `trends.slug`. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOCALE_IDS: ReadonlyArray<string> = LANGUAGES.map((l) => l.id)
const LOCALES: ReadonlySet<string> = new Set(LOCALE_IDS)
const PREVIEW_SEC = 4 as const

const WRITE_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } }

const limitSchema = z.coerce.number().int().min(1).max(60).default(30)

const listQuery = z.object({
  q: z.string().max(200).optional(),
  tag: z.string().min(1).max(100).optional(),
  favorites: z.enum(["1", "true", "0", "false"]).optional(),
  locale: z.string().max(16).optional(),
  cursor: z.string().max(500).optional(),
  limit: limitSchema,
})

const runsQuery = z.object({
  trend: z.string().regex(SLUG_RE).optional(),
  cursor: z.string().max(500).optional(),
  limit: limitSchema,
})

const detailQuery = z.object({ locale: z.string().max(16).optional() })

// ── replies ─────────────────────────────────────────────────────────────────

function err(reply: FastifyReply, status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return reply.status(status).send({ error: { code, message, ...extra } })
}

const notFound = (reply: FastifyReply) => err(reply, 404, "not_found", "Trend not found")

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(error) } })
}

/** The signed-in caller allowed to READ, or null after replying. */
function reader(req: FastifyRequest, reply: FastifyReply): string | null {
  if (!req.userId) {
    err(reply, 401, "unauthorized", "Authentication required")
    return null
  }
  if (req.appAuthorization) {
    const denied = requireScope(req.appAuthorization.scopes, "jobs:read")
    if (denied) {
      reply.status(denied.statusCode).send(denied.body)
      return null
    }
  }
  return req.userId
}

/**
 * Who reads a public route (the catalog, its tags, a trend's page): the
 * signed-in caller as `reader` admits one, or `null` for a guest. An OAuth
 * app without `jobs:read` is refused, never read as a guest. `undefined`
 * after replying.
 */
function publicReader(req: FastifyRequest, reply: FastifyReply): string | null | undefined {
  if (!req.userId) return null
  return reader(req, reply) ?? undefined
}

// ── locale ──────────────────────────────────────────────────────────────────

/**
 * `?locale=` when it is a platform language; else the signed-in caller's
 * profile preferredLocale, or a guest's `Accept-Language`; else English.
 */
async function resolveLocale(req: FastifyRequest, userId: string | null, raw: string | undefined): Promise<string> {
  if (raw && LOCALES.has(raw)) return raw
  if (userId === null) return acceptedLocale(req.headers["accept-language"], LOCALE_IDS) ?? "en"
  try {
    const { data, error } = await supabase.from("profiles").select("preferred_locale").eq("id", userId).maybeSingle()
    const pref = (data as { preferred_locale?: unknown } | null)?.preferred_locale
    if (!error && typeof pref === "string" && LOCALES.has(pref)) return pref
    if (error) req.log.warn({ err: error }, "trends: preferred locale unavailable, using English")
  } catch (e) {
    req.log.warn({ err: e }, "trends: preferred locale unavailable, using English")
  }
  return "en"
}

// ── catalog mappers (whitelists: never spread stored data) ──────────────────

function needsOf(slots: TrendSlot[]): Record<TrendSlotKind, number> {
  const out: Record<TrendSlotKind, number> = { person: 0, location: 0, product: 0, pet: 0 }
  for (const s of slots) if (SLOT_KINDS.includes(s.kind)) out[s.kind] += 1
  return out
}

/**
 * The card of a published trend. Its cover is Example 1, else the original's
 * display copy — never the uploaded source clip — so a version with neither
 * (or without a source, which no published version has) has no card. It also
 * carries the shown original as `original` and the listed examples' videos
 * (never their slots or source job), so a list can show each clip without
 * reading the page. A trend that hides its original never falls back to the
 * display copy: with no example (none can publish so) it has no card.
 */
/** One shown video's public fields (its web copy's, when it has a current one: `publicWebCopy`). */
function videoOf(v: TrendExample | TrendSourceDisplay): TrendVideo {
  return {
    videoUrl: v.videoUrl,
    ...(v.posterUrl ? { posterUrl: v.posterUrl } : {}),
    width: v.width,
    height: v.height,
    ...publicWebCopy(v),
  }
}

function toCard(row: TrendRow, data: TrendVersionData, locale: string, isFavorite: boolean): TrendCard | null {
  if (!data.source) return null
  const display = shownOriginal(data)
  const cover = data.examples[0] ?? display
  if (!cover) return null
  const description = pickText(data.description, locale)
  return {
    id: row.id,
    slug: row.slug,
    name: pickText(data.name, locale) ?? "",
    ...(description ? { description } : {}),
    tags: [...row.tags],
    badges: [...row.badges],
    cover: videoOf(cover),
    ...(display ? { original: videoOf(display) } : {}),
    examples: listedExamples(data).map(videoOf),
    needs: needsOf(data.slots),
    durationSec: data.source.durationSec,
    isFavorite,
  }
}

/** The slot's defaults of the chips it shows (a hidden chip's value is the trend's, not a starting value). */
function slotDefaults(slot: TrendSlot): Chips | undefined {
  const given = (slot.defaults ?? {}) as Chips
  const out: Chips = {}
  for (const chip of shownChips(slot)) {
    const v = given[chip]
    if (v === "new" || v === "original") out[chip] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** The shown original (`shownOriginal`) as the trend page's original, or undefined when the version has none. */
function originalOf(data: TrendVersionData): TrendOriginal | undefined {
  const display = shownOriginal(data)
  if (!display) return undefined
  return {
    ...videoOf(display),
    durationSec: display.durationSec,
    ...(data.previewStart !== null ? { previewStartSec: data.previewStart } : {}),
  }
}

function toDetail(row: TrendRow, version: number, data: TrendVersionData, locale: string, isFavorite: boolean): TrendDetail | null {
  const shown = toCard(row, data, locale, isFavorite)
  if (!shown) return null
  // The page's `original` (with its length and preview start) replaces the card's; both are the shown original.
  const { original: _cardOriginal, ...card } = shown
  const keys = new Set(data.slots.map((s) => s.key))
  const original = originalOf(data)
  return {
    ...card,
    version,
    previewSec: data.previewStart === null ? null : PREVIEW_SEC,
    ...(original ? { original } : {}),
    engine: nodaroMotionEngineOf(engineOf(data)),
    engineName: nodaroMotionEngineName(engineOf(data)),
    resolutions: [...CAST_SWAP_RESOLUTIONS_BY_ENGINE[engineOf(data)]],
    slots: data.slots.map((s) => {
      const hint = pickText(s.hint, locale)
      const defaults = slotDefaults(s)
      return {
        key: s.key,
        label: pickText(s.label, locale) ?? s.key,
        kind: s.kind,
        required: s.required,
        ...(hint ? { hint } : {}),
        ...(s.hintImageUrl ? { hintImageUrl: s.hintImageUrl } : {}),
        chips: shownChips(s),
        ...(defaults ? { defaults } : {}),
      }
    }),
    examples: listedExamples(data).map((ex) => {
      const slots: Record<string, string[]> = {}
      for (const [k, v] of Object.entries(ex.slots)) if (keys.has(k)) slots[k] = [...v]
      return { ...videoOf(ex), slots }
    }),
  }
}

/** The trend at `slug` with its published version, or null (a 404) unless it is published. */
async function findPublished(slug: string): Promise<{ row: TrendRow; version: number; data: TrendVersionData | null } | null> {
  if (!SLUG_RE.test(slug)) return null
  const row = await getTrendBySlug(slug)
  if (!row || row.status !== "published" || row.publishedVersion === null) return null
  return { row, version: row.publishedVersion, data: await getVersion(row.id, row.publishedVersion) }
}

// ── runs ────────────────────────────────────────────────────────────────────

/** The Cast Swap route's own Idempotency-Key bounds, checked before dispatch (its refusal is not passed on). */
const IDEMPOTENCY_KEY_MIN = 8
const IDEMPOTENCY_KEY_MAX = 200

function trendRunError(reply: FastifyReply, e: TrendRunError) {
  switch (e.code) {
    case "prompt_too_long":
      // The composed length would tell the hidden trend prompt's length.
      return err(reply, 400, e.code, "Your details are too long for this trend. Shorten them and try again.")
    case "source_missing":
      return err(reply, 503, "trend_unavailable", "This trend is not available right now.")
    // Its stored face mask does not match its marks (publishing requires one): nothing the caller
    // can change and nothing a retry fixes until the trend is updated — the documented
    // `409 trend_unavailable` (docs/api-integration.md), never the internal code.
    case "face_mask_required":
      return err(reply, 409, "trend_unavailable", "This trend cannot run until it is updated.")
    default:
      return err(reply, 400, e.code, e.message, {
        ...(e.slot !== undefined ? { slot: e.slot } : {}),
        ...(e.chip !== undefined ? { chip: e.chip } : {}),
      })
  }
}

/**
 * The shared front half of estimate and run: the body, the published trend,
 * the composed engine body and the engine check. Null after replying.
 */
async function prepareRun(req: FastifyRequest, reply: FastifyReply): Promise<{ composed: ComposedTrendRun; sessionId?: string } | null> {
  const parsed = trendRunRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    badRequest(reply, parsed.error)
    return null
  }
  const { slug } = req.params as { slug: string }
  const found = await findPublished(slug)
  if (!found) {
    notFound(reply)
    return null
  }
  if (!found.data) {
    err(reply, 503, "trend_unavailable", "This trend is not available right now.")
    return null
  }

  let composed: ComposedTrendRun
  try {
    // `example` numbers the examples as the trend's page lists them: on a trend that hides its original,
    // translated to the stored numbering the run is composed and recorded in (public-examples.ts).
    const example = storedExampleRequest(found.data, parsed.data.example)
    const { example: _public, ...rest } = parsed.data
    const request = { ...rest, ...(example !== undefined ? { example } : {}) }
    composed = composeTrendRun({ id: found.row.id, slug: found.row.slug, version: found.version, data: found.data }, request)
  } catch (e) {
    if (e instanceof TrendRunError) {
      trendRunError(reply, e)
      return null
    }
    throw e
  }

  if (!engineSupports(composed)) {
    err(reply, 503, "engine_unsupported", "Trends are not available on this platform version yet.")
    return null
  }
  // Estimate and run alike, so the quote prices what the run sends.
  await followPreviewMasking(composed, {
    userId: req.userId!,
    trendId: found.row.id,
    previewJobId: parsed.data.previewJobId,
    log: req.log,
  })
  withoutUnsupportedFields(composed)
  return { composed, ...(parsed.data.sessionId ? { sessionId: parsed.data.sessionId } : {}) }
}

// ── routes ──────────────────────────────────────────────────────────────────

export async function trendRoutes(app: FastifyInstance) {
  app.get("/v1/trends", { config: PUBLIC_READ_LIMIT }, async (req, reply) => {
    const userId = publicReader(req, reply)
    if (userId === undefined) return
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) return badRequest(reply, parsed.error)
    const { q, tag, favorites, locale: rawLocale, cursor, limit } = parsed.data
    const onlyFavorites = favorites === "1" || favorites === "true"
    // A guest has no favorites: listing them is an account read.
    if (onlyFavorites && userId === null) return err(reply, 401, "unauthorized", "Authentication required")

    try {
      const [locale, page] = await Promise.all([
        resolveLocale(req, userId, rawLocale),
        listPublished({
          ...(q?.trim() ? { q } : {}),
          ...(tag ? { tag } : {}),
          ...(onlyFavorites && userId !== null ? { favoritesOf: userId } : {}),
          ...(cursor ? { cursor } : {}),
          limit,
        }),
      ])
      const favs =
        userId === null
          ? new Set<string>()
          : onlyFavorites
            ? new Set(page.rows.map((r) => r.id))
            : await favoriteIds(userId, page.rows.map((r) => r.id))
      const data = page.rows.flatMap((r) => {
        const card = toCard(r, r.data, locale, favs.has(r.id))
        return card ? [card] : []
      })
      // Once the answer is built: a failure above is never cached.
      publicReadCache(reply, userId)
      return { data, next: page.next }
    } catch (e) {
      if (e instanceof InvalidTrendCursorError) return err(reply, 400, "validation_error", "Invalid cursor")
      return unavailableOrInternal(reply, req, e, "Failed to list trends")
    }
  })

  // Registered before /:slug (and `runs` can never be a slug: migration 549).
  app.get("/v1/trends/runs", async (req, reply) => {
    const userId = reader(req, reply)
    if (!userId) return
    const parsed = runsQuery.safeParse(req.query)
    if (!parsed.success) return badRequest(reply, parsed.error)
    const { trend, cursor, limit } = parsed.data
    const after = cursor ? decodeCursor(cursor) : null
    if (cursor && !after) return err(reply, 400, "validation_error", "Invalid cursor")

    // A run is read from its own stamp (`input_data.trend`), never from the
    // catalog: it stays readable after its trend moves on or is unpublished.
    // A Full Quality version is listed as its own run (it carries the stamp),
    // only the newest try of each draft (`listedRunsPage`).
    const read = async (from: Keyset | null, n: number) => {
      let query = supabase
        .from("jobs")
        .select(RUN_JOB_COLS)
        .is(TRASHED_JOB_COLUMN, null)
        // A child job (a run's step) is shown only through its run, as on every job list.
        .is(CHILD_JOB_COLUMN, null)
        .eq("user_id", userId)
        .filter("input_data->>type", "eq", "cast-swap")
        .not("input_data->trend", "is", null)
      if (trend) query = query.filter("input_data->trend->>slug", "eq", trend)
      if (from) query = query.or(afterKeyset("created_at", "id", from))
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(n)
      if (error) throw error
      return (data ?? []) as unknown as RunJobRow[]
    }

    try {
      const page = await listedRunsPage(read, after, limit, userId)
      const next = page.next ? encodeCursor(page.next) : null
      if (page.rows.length === 0) return { data: [], next }
      return { data: await toTrendRuns(page.rows, userId), next }
    } catch (e) {
      return unavailableOrInternal(reply, req, e, "Failed to list trend runs")
    }
  })

  // One run, in the list's shape: the caller's own top-level trend run, else 404.
  app.get("/v1/trends/runs/:jobId", async (req, reply) => {
    const userId = reader(req, reply)
    if (!userId) return
    const { jobId } = req.params as { jobId: string }
    if (!UUID_RE.test(jobId)) return err(reply, 404, "not_found", "Run not found")
    try {
      const { data, error } = await supabase
        .from("jobs")
        .select(RUN_JOB_COLS)
        .is(TRASHED_JOB_COLUMN, null)
        .eq("id", jobId)
        .eq("user_id", userId)
        .filter("input_data->>type", "eq", "cast-swap")
        .not("input_data->trend", "is", null)
        .is("parent_job_id", null)
        .maybeSingle()
      if (error) throw new Error(`Could not read job ${jobId}: ${error.message}`)
      if (!data) return err(reply, 404, "not_found", "Run not found")
      const [run] = await toTrendRuns([data as unknown as RunJobRow], userId)
      if (!run) return err(reply, 404, "not_found", "Run not found")
      return { data: run }
    } catch (e) {
      return unavailableOrInternal(reply, req, e, "Failed to read the trend run")
    }
  })

  // Registered before /:slug (and `tags` can never be a slug: migration 555).
  app.get("/v1/trends/tags", { config: PUBLIC_READ_LIMIT }, async (req, reply) => {
    const userId = publicReader(req, reply)
    if (userId === undefined) return
    const parsed = detailQuery.safeParse(req.query)
    if (!parsed.success) return badRequest(reply, parsed.error)
    try {
      const [locale, usage] = await Promise.all([resolveLocale(req, userId, parsed.data.locale), publishedTagUsage()])
      let labels = new Map<string, TagLabels>()
      try {
        labels = await readTagLabels(usage.map((u) => u.tag))
      } catch (e) {
        // Labels are a nicety: a database without migration 555 yet (staging
        // runs ahead of main) lists every tag as itself.
        if (!(e instanceof TrendsUnavailableError)) throw e
        req.log.warn("trends: tag labels unavailable, listing tags as themselves")
      }
      const data: TrendTag[] = usage.map(({ tag, count }) => ({ tag, label: tagLabel(tag, labels.get(tag), locale), count }))
      publicReadCache(reply, userId)
      return { data }
    } catch (e) {
      return unavailableOrInternal(reply, req, e, "Failed to list the trend tags")
    }
  })

  app.get("/v1/trends/:slug", { config: PUBLIC_READ_LIMIT }, async (req, reply) => {
    const userId = publicReader(req, reply)
    if (userId === undefined) return
    const parsed = detailQuery.safeParse(req.query)
    if (!parsed.success) return badRequest(reply, parsed.error)
    const { slug } = req.params as { slug: string }
    try {
      const found = await findPublished(slug)
      if (!found?.data) return notFound(reply)
      const [locale, favs] = await Promise.all([
        resolveLocale(req, userId, parsed.data.locale),
        userId === null ? new Set<string>() : favoriteIds(userId, [found.row.id]),
      ])
      const detail = toDetail(found.row, found.version, found.data, locale, favs.has(found.row.id))
      if (!detail) return notFound(reply)
      publicReadCache(reply, userId)
      return { data: detail }
    } catch (e) {
      return unavailableOrInternal(reply, req, e, "Failed to read trend")
    }
  })

  app.post(
    "/v1/trends/:slug/estimate",
    { preHandler: requireAppScope("workflows:execute"), config: WRITE_LIMIT },
    async (req, reply) => {
      if (!req.userId) return err(reply, 401, "unauthorized", "Authentication required")
      try {
        const prepared = await prepareRun(req, reply)
        if (!prepared) return reply
        const res = await engineRequest(app, req, "/v1/cast-swap/estimate", prepared.composed.body)
        if (res.statusCode < 200 || res.statusCode >= 300) return publicRefusal(reply, res)
        const parsed = parseJson(res.body)
        const quote = isRec(parsed) && isRec(parsed.data) ? parsed.data : parsed
        if (!isRec(quote) || typeof quote.totalCredits !== "number") {
          return err(reply, 502, "engine_error", "Nodaro Motion answered unexpectedly.")
        }
        const expected = typeof quote.expectedCredits === "number" ? quote.expectedCredits : quote.totalCredits
        // The neutral key names only (an engine before 0.395.0 also, or only, sends the old ones).
        const privacyCredits = privacyCreditsOf(quote)
        return {
          data: {
            expectedCredits: expected,
            holdCredits: quote.totalCredits,
            breakdown: neutralBreakdown(quote.breakdown),
            // A retry of a refused clip: charged only if it runs (not in the hold).
            ...(privacyCredits !== undefined ? { privacyCredits } : {}),
          },
        }
      } catch (e) {
        return unavailableOrInternal(reply, req, e, "Failed to estimate the trend run")
      }
    },
  )

  app.post(
    "/v1/trends/:slug/runs",
    { preHandler: requireAppScope("workflows:execute"), config: WRITE_LIMIT },
    async (req, reply) => {
      if (!req.userId) return err(reply, 401, "unauthorized", "Authentication required")
      try {
        const prepared = await prepareRun(req, reply)
        if (!prepared) return reply
        const { composed, sessionId } = prepared
        // The run's job carries the caller's client origin (checked as any
        // job's: not a slug is a 400 before anything runs) and surface.
        const origin = resolveRequestOrigin(req)

        // A run is filed in no session yet, but the session is still checked
        // here, so a client that sends one learns now that it may not use it:
        // the caller's own (filing a job in it is a session write —
        // `assets:write` for an OAuth app, and for an MCP session, whose grant
        // reaches this internal hop through `mcpInject`'s scope), else a 404.
        if (sessionId) {
          if (!UUID_RE.test(sessionId)) return err(reply, 404, "not_found", "Session not found")
          if (!grantMayWriteSessions(callerGrantOf(req))) {
            return err(reply, 404, "not_found", "Session not found")
          }
          const own = await findOwnSession(req, req.userId, sessionId)
          if (own.error) return unavailableOrInternal(reply, req, own.error, "Failed to start the trend run")
          if (!own.data) return err(reply, 404, "not_found", "Session not found")
        }

        const key = req.headers["idempotency-key"]
        if (typeof key === "string" && key && (key.length < IDEMPOTENCY_KEY_MIN || key.length > IDEMPOTENCY_KEY_MAX)) {
          return err(reply, 400, "validation_error", "Idempotency-Key must be 8–200 characters.")
        }
        const res = await engineRequest(
          app,
          req,
          "/v1/cast-swap",
          composed.body,
          typeof key === "string" && key ? { "idempotency-key": key } : {},
          { ...(origin ? { origin } : {}), source: deriveJobSource(req) },
        )
        if (res.statusCode < 200 || res.statusCode >= 300) return publicRefusal(reply, res)
        const jobId = jobIdOf(res.body)
        if (!jobId) return err(reply, 502, "engine_error", "Nodaro Motion did not return a job id.")
        return reply.status(202).send({ data: { jobId } })
      } catch (e) {
        return unavailableOrInternal(reply, req, e, "Failed to start the trend run")
      }
    },
  )

  const favorite = (on: boolean) => async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.userId) return err(reply, 401, "unauthorized", "Authentication required")
    const { slug } = req.params as { slug: string }
    try {
      const found = await findPublished(slug)
      if (!found) return notFound(reply)
      await setFavorite(req.userId, found.row.id, on)
      return reply.status(204).send()
    } catch (e) {
      return unavailableOrInternal(reply, req, e, "Failed to save the favorite")
    }
  }
  app.put("/v1/trends/:slug/favorite", { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT }, favorite(true))
  app.delete("/v1/trends/:slug/favorite", { preHandler: requireAppScope("assets:write"), config: WRITE_LIMIT }, favorite(false))
}
