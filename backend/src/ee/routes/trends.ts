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
 * map each job to the `TrendRun` whitelist. A Full Quality version of a draft is a run of its own.
 *
 * Reads need `jobs:read` for an OAuth app; estimate and run `workflows:execute`
 * (as the Cast Swap MCP verb); favorites `assets:write` (as the gallery's).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { LANGUAGES } from "@nodaro/shared/i18n"
import { CAST_SWAP_RESOLUTIONS_BY_ENGINE } from "@nodaro/shared/models"
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
import { pickText } from "../lib/trends/localize.js"
import { publishedTagUsage, readTagLabels, tagLabel, type TagLabels } from "../lib/trends/tags.js"
import { TrendRunError, composeTrendRun, type ComposedTrendRun } from "../lib/trends/compose.js"
import {
  RUN_JOB_COLS,
  SLOT_KINDS,
  engineRequest,
  engineSupports,
  followPreviewMasking,
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
  CastSwapEngine,
  Choice,
  TrendResolution,
  TrendRow,
  TrendSlot,
  TrendSlotKind,
  TrendVersionData,
} from "../lib/trends/types.js"

export type { TrendRun } from "../lib/trends/run-helpers.js"

// ── public shapes (mirrored by the SDK) ─────────────────────────────────────

type Chips = Partial<Record<"body" | "outfit" | "hair" | "coat" | "shape" | "finish", Choice>>

export interface TrendCard {
  id: string
  slug: string
  name: string
  description?: string
  tags: string[]
  badges: string[]
  /** Example 1, else (a trend with no example) the original's display copy. */
  cover: { videoUrl: string; posterUrl?: string; width: number; height: number }
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
 * uploaded file a run edits). `previewStartSec` is where the 4 s preview
 * starts, sent whenever the trend offers one (0 included).
 */
export interface TrendOriginal {
  videoUrl: string
  posterUrl?: string
  width: number
  height: number
  durationSec: number
  previewStartSec?: number
}

export interface TrendDetail extends TrendCard {
  version: number
  previewSec: 4 | null
  /** Absent only on a version whose source has no display copy (none can publish since). */
  original?: TrendOriginal
  /** The video engine every run of this trend uses (the person never chooses it). */
  engine: CastSwapEngine
  /**
   * The resolutions a run of this trend may ask for, its default first:
   * Seedance 2.5 `["480p", "720p", "1080p"]` (480p is the draft), Kling 4
   * `["720p", "1080p"]` (no draft).
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
  /** May be empty: a trend can be published with only its original. */
  examples: Array<{ videoUrl: string; posterUrl?: string; width: number; height: number; slots: Record<string, string[]> }>
}


// ── constants ───────────────────────────────────────────────────────────────

/** Same shape as migration 549's CHECK on `trends.slug`. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOCALES: ReadonlySet<string> = new Set(LANGUAGES.map((l) => l.id))
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

// ── locale ──────────────────────────────────────────────────────────────────

/** `?locale=` when it is a platform language, else the profile's preferredLocale, else English. */
async function resolveLocale(req: FastifyRequest, userId: string, raw: string | undefined): Promise<string> {
  if (raw && LOCALES.has(raw)) return raw
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
 * (or without a source, which no published version has) has no card.
 */
function toCard(row: TrendRow, data: TrendVersionData, locale: string, isFavorite: boolean): TrendCard | null {
  if (!data.source) return null
  const cover = data.examples[0] ?? data.source.display
  if (!cover) return null
  const description = pickText(data.description, locale)
  return {
    id: row.id,
    slug: row.slug,
    name: pickText(data.name, locale) ?? "",
    ...(description ? { description } : {}),
    tags: [...row.tags],
    badges: [...row.badges],
    cover: {
      videoUrl: cover.videoUrl,
      ...(cover.posterUrl ? { posterUrl: cover.posterUrl } : {}),
      width: cover.width,
      height: cover.height,
    },
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

/** The source's display copy as the trend's original, or undefined when the version has none. */
function originalOf(data: TrendVersionData): TrendOriginal | undefined {
  const display = data.source?.display
  if (!display) return undefined
  return {
    videoUrl: display.videoUrl,
    ...(display.posterUrl ? { posterUrl: display.posterUrl } : {}),
    width: display.width,
    height: display.height,
    durationSec: display.durationSec,
    ...(data.previewStart !== null ? { previewStartSec: data.previewStart } : {}),
  }
}

function toDetail(row: TrendRow, version: number, data: TrendVersionData, locale: string, isFavorite: boolean): TrendDetail | null {
  const card = toCard(row, data, locale, isFavorite)
  if (!card) return null
  const keys = new Set(data.slots.map((s) => s.key))
  const original = originalOf(data)
  return {
    ...card,
    version,
    previewSec: data.previewStart === null ? null : PREVIEW_SEC,
    ...(original ? { original } : {}),
    engine: engineOf(data),
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
    examples: data.examples.map((ex) => {
      const slots: Record<string, string[]> = {}
      for (const [k, v] of Object.entries(ex.slots)) if (keys.has(k)) slots[k] = [...v]
      return {
        videoUrl: ex.videoUrl,
        ...(ex.posterUrl ? { posterUrl: ex.posterUrl } : {}),
        width: ex.width,
        height: ex.height,
        slots,
      }
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

/** The quote's breakdown: only its own entries whose values are finite numbers. */
function numericEntries(v: unknown): Record<string, number> {
  if (!isRec(v)) return {}
  return Object.fromEntries(
    Object.entries(v).filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1])),
  )
}

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
    composed = composeTrendRun({ id: found.row.id, slug: found.row.slug, version: found.version, data: found.data }, parsed.data)
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
  return { composed, ...(parsed.data.sessionId ? { sessionId: parsed.data.sessionId } : {}) }
}

// ── routes ──────────────────────────────────────────────────────────────────

export async function trendRoutes(app: FastifyInstance) {
  app.get("/v1/trends", async (req, reply) => {
    const userId = reader(req, reply)
    if (!userId) return
    const parsed = listQuery.safeParse(req.query)
    if (!parsed.success) return badRequest(reply, parsed.error)
    const { q, tag, favorites, locale: rawLocale, cursor, limit } = parsed.data
    const onlyFavorites = favorites === "1" || favorites === "true"

    try {
      const [locale, page] = await Promise.all([
        resolveLocale(req, userId, rawLocale),
        listPublished({
          ...(q?.trim() ? { q } : {}),
          ...(tag ? { tag } : {}),
          ...(onlyFavorites ? { favoritesOf: userId } : {}),
          ...(cursor ? { cursor } : {}),
          limit,
        }),
      ])
      const favs = onlyFavorites
        ? new Set(page.rows.map((r) => r.id))
        : await favoriteIds(userId, page.rows.map((r) => r.id))
      return {
        data: page.rows.flatMap((r) => {
          const card = toCard(r, r.data, locale, favs.has(r.id))
          return card ? [card] : []
        }),
        next: page.next,
      }
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
  app.get("/v1/trends/tags", async (req, reply) => {
    const userId = reader(req, reply)
    if (!userId) return
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
      return { data }
    } catch (e) {
      return unavailableOrInternal(reply, req, e, "Failed to list the trend tags")
    }
  })

  app.get("/v1/trends/:slug", async (req, reply) => {
    const userId = reader(req, reply)
    if (!userId) return
    const parsed = detailQuery.safeParse(req.query)
    if (!parsed.success) return badRequest(reply, parsed.error)
    const { slug } = req.params as { slug: string }
    try {
      const found = await findPublished(slug)
      if (!found?.data) return notFound(reply)
      const [locale, favs] = await Promise.all([
        resolveLocale(req, userId, parsed.data.locale),
        favoriteIds(userId, [found.row.id]),
      ])
      const detail = toDetail(found.row, found.version, found.data, locale, favs.has(found.row.id))
      if (!detail) return notFound(reply)
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
          return err(reply, 502, "engine_error", "Cast Swap answered unexpectedly.")
        }
        const expected = typeof quote.expectedCredits === "number" ? quote.expectedCredits : quote.totalCredits
        const masking = quote.maskingCredits
        return {
          data: {
            expectedCredits: expected,
            holdCredits: quote.totalCredits,
            breakdown: numericEntries(quote.breakdown),
            // Face masking "auto": charged only if the masked retry runs (not in the hold).
            ...(typeof masking === "number" && Number.isFinite(masking) ? { maskingCredits: masking } : {}),
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
        if (!jobId) return err(reply, 502, "engine_error", "Cast Swap did not return a job id.")
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
