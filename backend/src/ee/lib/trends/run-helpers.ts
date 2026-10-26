/**
 * What the public trend routes (`ee/routes/trends.ts`) and the admin ones
 * (`ee/routes/admin-trends.ts`) share about trend RUNS:
 *
 * - reading a run back: the `TrendRun` whitelist mapper over a Cast Swap job
 *   row (redacted first, then mapped field by field). A Full Quality version
 *   of a draft is a run of its own (`fullQualityOf` names the draft); a draft
 *   only points at it (`fullQuality`: its job id and status, never its
 *   result);
 * - listing runs: only the NEWEST Full Quality try of each draft is listed
 *   (running, done, or its last failure); an older, superseded try is left out
 *   of every list (`listedRunsPage`) and stays readable only by its id;
 * - dispatching one: the engine-support check against the loaded Cast Swap
 *   engine, and the INTERNAL request to the Cast Swap route as the caller
 *   (the only way a run can carry `trendRun`), with the web spend surface;
 * - answering when it fails: an engine refusal as the public routes may
 *   show it (`publicRefusal`), and a database without the trend tables as
 *   503 `not_available` (`unavailableOrInternal`).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { WORKSPACE_HEADER_LOWER } from "@nodaro/shared/organizations"
import { config } from "../../../lib/config.js"
import { supabase } from "../../../lib/supabase.js"
import { callerGrantOf, withJobSubmissionContext, type TrustedJobProvenance } from "../../../lib/job-submission-context.js"
import { resolveWebSurfaceFlag } from "../../../middleware/credit-guard.js"
import { redactPrivateJobData, TRASHED_JOB_COLUMN } from "../../../lib/public-job-data.js"
import { creditStatusMapFor, creditsChargedOf } from "../../../lib/job-credit-status.js"
import { sideHoldChargesFor } from "../../../lib/job-step-charge.js"
import { getPluginSupports } from "../../../lib/private-plugins/supports-registry.js"
import { sendInternalError } from "../../../lib/http-errors.js"
import { isMissingTableError } from "../../../lib/postgrest-errors.js"
import { faceMaskTargetsOf, faceMaskingZoneSchema, withResolvedZone, type FaceMaskingZone } from "../../../lib/cast-swap-face-masking.js"
import { TrendsUnavailableError } from "./store.js"
import { privacyOutcomeOf } from "../../../lib/nodaro-motion-quote.js"
import { castSwapEnginesOf, withWireLengthKey } from "../../../lib/cast-swap-engines.js"
import type { ComposedTrendRun, TrendRunDisplay, TrendRunDisplaySlot } from "./compose.js"
import {
  CAST_SWAP_ENGINE_WHEN_OMITTED,
  castSwapEngineFrom,
  nodaroMotionEngineName,
  nodaroMotionEngineOf,
  type NodaroMotionEngine,
} from "@nodaro/shared/models"
import type { CastSwapEngine, Choice, TrendSlotKind } from "./types.js"

// ── the public run shape (mirrored by the SDK) ──────────────────────────────

export interface TrendRun {
  jobId: string
  status: string
  progress: number | null
  error: { code?: string; message: string } | null
  createdAt: string
  completedAt: string | null
  trend: TrendRunDisplay["trend"]
  /** 1-based example used for empty optional slots; 0 = the trend had no example. */
  example: number
  slots: TrendRunDisplay["slots"]
  details?: string
  preview: boolean
  resolution: string
  draft: boolean
  /**
   * The engine the run was made on, by its public id: `"motion-pro"` (every
   * run before the choice) or `"motion-lite"`. A job stores either vocabulary
   * (an engine that knows the public ids records those).
   */
  engine: NodaroMotionEngine
  /** Its name: "Nodaro Motion Pro" or "Nodaro Motion Lite". */
  engineName: string
  videoUrl: string | null
  posterUrl: string | null
  creditsCharged: number | null
  /**
   * A Full Quality version: the draft run it was made from (which may be gone
   * since). Null for any other run. Such a run is listed on its own, with its
   * own status, output and charge.
   */
  fullQualityOf: string | null
  /**
   * A draft's newest Full Quality try, when one was started: a pointer only.
   * Its result and charge are on that run, listed on its own; older tries of
   * the draft are not listed.
   */
  fullQuality: { jobId: string; status: string } | null
  fullQualityUntil: string | null
}

type Chips = Partial<Record<"body" | "outfit" | "hair" | "coat" | "shape" | "finish", Choice>>

export const SLOT_KINDS: readonly TrendSlotKind[] = ["person", "location", "product", "pet"]
const CHIP_KEYS = ["body", "outfit", "hair", "coat", "shape", "finish"] as const
/** A completed draft run (or Kling 4 run at 720p) can be redone in Full Quality for this long. */
const FULL_QUALITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * A run's engine (internal id), from its stored input in either vocabulary (an
 * engine that knows Nodaro Motion's public ids records those): Seedance 2.5
 * when it names none (every run before the choice) or names no engine.
 */
export function runEngineOf(input: Rec): CastSwapEngine {
  return castSwapEngineFrom(input.engine) ?? CAST_SWAP_ENGINE_WHEN_OMITTED
}

/**
 * Whether a run can be redone in Full Quality (once completed, within the
 * window): a Seedance 2.5 draft (the same take at 1080p), or a Kling 4 run at
 * 720p (a new take at 1080p from the same inputs). A Full Quality version
 * itself never is.
 */
export function fullQualityEligible(input: Rec): boolean {
  if (input.fullQualityOf != null) return false
  if (input.draft === true) return true
  return runEngineOf(input) === "kling-4" && input.resolution === "720p"
}

export const RUN_JOB_COLS =
  "id, status, progress, input_data, output_data, error_message, error_hint, created_at, started_at, completed_at, usage_log_id"

export type Rec = Record<string, unknown>
export const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v)
export const str = (v: unknown): string | null => (typeof v === "string" ? v : null)

/** What the run lists read off a job row. */
export interface RunJobRow {
  id: string
  status: string
  progress: number | null
  input_data: unknown
  output_data: unknown
  error_message: string | null
  error_hint: unknown
  created_at: string
  started_at: string | null
  completed_at: string | null
  usage_log_id: string | null
}

// ── reading a run back ──────────────────────────────────────────────────────

function displayTrend(v: unknown): TrendRunDisplay["trend"] | null {
  if (!isRec(v)) return null
  const id = str(v.id), slug = str(v.slug), name = str(v.name)
  if (!id || !slug || name === null || typeof v.version !== "number") return null
  return { id, slug, version: v.version, name }
}

/** A run's display slots (from its `input_data.slots`), whitelisted. */
export function displaySlots(v: unknown): TrendRunDisplaySlot[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((s): TrendRunDisplaySlot[] => {
    if (!isRec(s)) return []
    const key = str(s.key), label = str(s.label)
    const kind = SLOT_KINDS.find((k) => k === s.kind)
    if (!key || label === null || !kind) return []
    const chips: Chips = {}
    for (const c of CHIP_KEYS) if (s[c] === "new" || s[c] === "original") chips[c] = s[c] as Choice
    return [{
      key,
      label,
      kind,
      images: Array.isArray(s.images) ? s.images.filter((i): i is string => typeof i === "string") : [],
      fromExample: s.fromExample === true,
      ...chips,
    }]
  })
}

/** A Cast Swap job's result video and poster, from its output. */
export function outputVideo(output: unknown): { videoUrl: string | null; posterUrl: string | null } {
  if (!isRec(output)) return { videoUrl: null, posterUrl: null }
  return {
    videoUrl: str(output.videoUrl),
    posterUrl: str(output.thumbnailUrl) ?? str(output.posterUrl),
  }
}

/**
 * A failed (or cancelled) run's error; any other run has none, whatever its
 * `error_message` still holds.
 *
 * PUBLIC: the stored `error_message` is NEVER passed on — an engine or
 * provider failure can quote any part of the hidden input (the source clip, a
 * role name, the trend prompt), whole or in pieces, so no filter over it is
 * safe. The code is the job's failure kind when it is a public one, else
 * `cancelled` / `failed`.
 *
 * ADMIN (the test-run list): the real message and kind, since admins author
 * the hidden data.
 */
const RUN_FAILED_MESSAGE = "This run didn't finish."
const PUBLIC_FAILURE_KINDS: ReadonlySet<string> = new Set(["safety-block", "policy-block", "credits"])

export type RunAudience = "public" | "admin"

function runError(row: RunJobRow, audience: RunAudience): TrendRun["error"] {
  if (row.status !== "failed" && row.status !== "cancelled") return null
  const kind = isRec(row.error_hint) ? str(row.error_hint.kind) : null
  if (audience === "admin") return { ...(kind ? { code: kind } : {}), message: row.error_message || RUN_FAILED_MESSAGE }
  const code = kind && PUBLIC_FAILURE_KINDS.has(kind) ? kind : row.status === "cancelled" ? "cancelled" : "failed"
  return { code, message: RUN_FAILED_MESSAGE }
}

export type CreditStatusMap = Awaited<ReturnType<typeof creditStatusMapFor>>

/** A Cast Swap job row → `TrendRun`, or null when it is not a trend run. */
export function toTrendRun(
  raw: RunJobRow,
  fq: RunJobRow | undefined,
  credits: CreditStatusMap,
  sideCharges: ReadonlyMap<string, number>,
  audience: RunAudience = "public",
): TrendRun | null {
  // Redaction first (drops every `__` key), then the whitelist below.
  const row = redactPrivateJobData(raw)
  const input = isRec(row.input_data) ? row.input_data : {}
  const trend = displayTrend(input.trend)
  if (!trend) return null
  const { videoUrl, posterUrl } = outputVideo(row.output_data)
  const draft = input.draft === true
  const eligible = fullQualityEligible(input)
  const completedAt = row.completed_at ?? null
  const fullQualityUntil =
    eligible && row.status === "completed" && completedAt && !Number.isNaN(Date.parse(completedAt))
      ? new Date(Date.parse(completedAt) + FULL_QUALITY_WINDOW_MS).toISOString()
      : null
  const details = str(input.details)
  const fqRow = fq && eligible ? redactPrivateJobData(fq) : null
  return {
    jobId: row.id,
    status: row.status,
    progress: typeof row.progress === "number" ? row.progress : null,
    error: runError(row, audience),
    createdAt: row.created_at,
    completedAt,
    trend,
    example: typeof input.example === "number" ? input.example : 1,
    slots: displaySlots(input.slots),
    ...(details ? { details } : {}),
    preview: input.preview === true,
    resolution: str(input.resolution) ?? "480p",
    draft,
    engine: nodaroMotionEngineOf(runEngineOf(input)),
    engineName: nodaroMotionEngineName(runEngineOf(input)),
    videoUrl: row.status === "completed" ? videoUrl : null,
    posterUrl: row.status === "completed" ? posterUrl : null,
    creditsCharged: creditsChargedOf(row.usage_log_id, credits, row.id, sideCharges),
    fullQualityOf: str(input.fullQualityOf),
    fullQuality: fqRow ? { jobId: fqRow.id, status: fqRow.status } : null,
    fullQualityUntil,
  }
}

/**
 * The newest Full Quality try of each of `draftIds` (by created_at, then id —
 * the lists' own order), by draft id, owned by `owners` (one user, or
 * several). A draft can have several tries (a failed or cancelled one can be
 * tried again); only the newest counts. Throws on a database error.
 */
export async function fullQualityByDraft(draftIds: string[], owners: string | string[]): Promise<Map<string, RunJobRow>> {
  const out = new Map<string, RunJobRow>()
  if (draftIds.length === 0) return out
  let query = supabase.from("jobs").select(`${RUN_JOB_COLS}, fullQualityOf:input_data->>fullQualityOf`).is(TRASHED_JOB_COLUMN, null)
  query = typeof owners === "string" ? query.eq("user_id", owners) : query.in("user_id", owners)
  const { data, error } = await query
    .filter("input_data->>type", "eq", "cast-swap")
    .in("input_data->>fullQualityOf", draftIds)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
  if (error) throw new Error(`Could not read Full Quality runs: ${error.message}`)
  for (const r of (data ?? []) as unknown as Array<RunJobRow & { fullQualityOf?: unknown }>) {
    const of = str(r.fullQualityOf) ?? (isRec(r.input_data) ? str(r.input_data.fullQualityOf) : null)
    if (of && !out.has(of)) out.set(of, r)
  }
  return out
}

/** The draft a Full Quality try was made from, or null for any other run. */
function fullQualityOfRow(r: RunJobRow): string | null {
  return isRec(r.input_data) ? str(r.input_data.fullQualityOf) : null
}

/**
 * The Full Quality tries among `rows` that a newer try of the same draft
 * supersedes, by job id. Read from the database, not from `rows`: the newest
 * try can be on an earlier page.
 */
async function supersededTries(rows: RunJobRow[], owners: string | string[]): Promise<Set<string>> {
  const tries = rows.flatMap((r) => {
    const of = fullQualityOfRow(r)
    return of ? [{ id: r.id, of }] : []
  })
  if (tries.length === 0) return new Set()
  const newest = await fullQualityByDraft([...new Set(tries.map((t) => t.of))], owners)
  return new Set(tries.filter((t) => { const n = newest.get(t.of); return !!n && n.id !== t.id }).map((t) => t.id))
}

/** A position in a newest-first run list (`created_at`, then `id`). */
export interface RunKeyset {
  at: string
  id: string
}

/** How many reads one page may take when superseded tries are skipped. */
const MAX_PAGE_READS = 5

/**
 * One page of a newest-first run list without superseded Full Quality tries.
 * `read(after, n)` answers up to `n` rows after `after` (null = from the
 * start), newest first. Rows are read until the page is full, the list ends,
 * or `MAX_PAGE_READS` reads were made; in that last case the page can be
 * short (even empty) and `next` resumes after the last row read, so a long
 * run of hidden tries never stalls the cursor. Throws on a database error.
 */
export async function listedRunsPage<T extends RunJobRow>(
  read: (after: RunKeyset | null, n: number) => Promise<T[]>,
  after: RunKeyset | null,
  limit: number,
  owners: string | string[],
): Promise<{ rows: T[]; next: RunKeyset | null }> {
  const keyOf = (r: T): RunKeyset => ({ at: r.created_at, id: r.id })
  const listed: T[] = []
  let cursor = after
  for (let reads = 0; reads < MAX_PAGE_READS; reads++) {
    const batch = await read(cursor, limit + 1)
    const hidden = await supersededTries(batch, owners)
    for (const r of batch) if (!hidden.has(r.id)) listed.push(r)
    if (listed.length > limit) {
      const page = listed.slice(0, limit)
      return { rows: page, next: keyOf(page[page.length - 1]!) }
    }
    if (batch.length <= limit) return { rows: listed, next: null }
    cursor = keyOf(batch[batch.length - 1]!)
  }
  return { rows: listed, next: cursor }
}

/** Map a page of run rows to `TrendRun`s, with their credits and, for drafts, their newest Full Quality job. */
export async function toTrendRuns(
  page: RunJobRow[],
  owners: string | string[],
  audience: RunAudience = "public",
): Promise<TrendRun[]> {
  if (page.length === 0) return []
  const drafts = page.filter((r) => isRec(r.input_data) && fullQualityEligible(r.input_data)).map((r) => r.id)
  const [fqByDraft, credits, sideCharges] = await Promise.all([
    fullQualityByDraft(drafts, owners),
    creditStatusMapFor(page.map((r) => r.usage_log_id)),
    sideHoldChargesFor(page.map((r) => r.id)),
  ])
  return page.flatMap((r) => {
    const run = toTrendRun(r, fqByDraft.get(r.id), credits, sideCharges, audience)
    return run ? [run] : []
  })
}

// ── dispatching a run ───────────────────────────────────────────────────────

/**
 * Whether the loaded Cast Swap engine can run this: it declares trend runs,
 * every slot kind the trend uses, fixed references when the trend has some,
 * face masking when the trend masks (and what its masks cover,
 * `faceMaskTargets`), a trend pre prompt when it has one, the trend's video
 * engine, and the requested resolution.
 */
export function engineSupports(composed: ComposedTrendRun): boolean {
  const cs = getPluginSupports().castSwap
  if (!cs || cs.trendRun !== true) return false
  if (!castSwapEnginesOf(cs).includes(composed.needs.engine)) return false
  for (const kind of composed.needs.roleKinds) if (!cs.roleKinds.includes(kind)) return false
  if (composed.needs.fixedReferences && cs.fixedReferences !== true) return false
  if (composed.needs.faceMasking && cs.faceMasking !== true) return false
  // An engine that does not declare the target strips it and masks heads: never send it a face-only trend.
  if (composed.needs.faceMaskTarget && !faceMaskTargetsOf(cs).includes(composed.needs.faceMaskTarget)) return false
  if (composed.needs.trendPrePrompt && cs.trendPrePrompt !== true) return false
  // A trend with marks runs on its stored mask only, never masked per run: the engine must take it
  // (`withoutUnsupportedStoredMask` would strip it) and honour `required` (an older one strips that too).
  if (composed.needs.storedFaceMask && (cs.storedFaceMask !== true || cs.storedFaceMaskRequired !== true)) return false
  return cs.resolutions.includes(composed.body.resolution)
}

/**
 * The body without `storedFaceMask` when the loaded engine does not declare
 * it takes one (`castSwap.storedFaceMask`): such an engine would refuse or
 * drop a field it does not know, so the run masks per run instead, and the
 * estimate quotes that. Called by the estimate, the run and the admin test
 * run alike, after `followPreviewMasking`. Mutates `composed.body`.
 */
export function withoutUnsupportedStoredMask(composed: ComposedTrendRun): void {
  if (composed.body.storedFaceMask && getPluginSupports().castSwap?.storedFaceMask !== true) {
    delete composed.body.storedFaceMask
  }
}

/**
 * A full run follows its preview's face masking. Only when the trend's masking
 * is "auto" and the body to send is not itself a preview (`composed.body.preview`,
 * what the engine gets, not a separate flag): the request's `previewJobId`
 * is read, and when it is the caller's own completed preview run of THIS
 * trend (`input_data.trend.id`, not a Full Quality job) whose output says the
 * faces were masked (`output_data.privacy.applied === true`, or the old
 * `faceMasking`), the run is
 * sent with `mode: "always"` and the trend's other masking settings, so it
 * does not first try unmasked what the preview already showed is refused.
 * When the trend leaves `fill` out, the run takes the fill the preview was
 * masked with (its resolved `input_data.__faceMasking.fill`): the engine's
 * default can change between the two, and the full run should look like the
 * preview the user approved. The zone likewise: when the trend leaves it out
 * (`composed.maskingZoneLeftOut`), the run takes the margins the preview ran
 * with (`input_data.__faceMasking.zone`); a preview stored with no zone (made
 * before the default margins) or `zone: null` ran with none, so the run is
 * sent with none (all four 0). A stored zone that is not a valid one leaves
 * the trend's (the default margins). A trend's own zone, null or 0 included,
 * still wins. The trend's stored face mask (`storedFaceMask`) is kept: the
 * engine uses it for the masked attempt.
 *
 * Anything else (no such job, another user's, another trend's, a full run, not
 * completed, not masked, a database error) leaves the body as it is: no
 * error, and nothing that tells whether the job exists. Mutates
 * `composed.body.faceMasking` (its own copy, from `composeTrendRun`).
 */
export async function followPreviewMasking(
  composed: ComposedTrendRun,
  opts: {
    userId: string
    trendId: string
    previewJobId: string | undefined
    log?: { warn: (obj: object, msg: string) => void }
  },
): Promise<void> {
  const masking = composed.body.faceMasking
  if (!opts.previewJobId || composed.body.preview || masking?.mode !== "auto") return
  const { data, error } = await supabase
    .from("jobs")
    .select("id, user_id, status, input_data, output_data")
    .is(TRASHED_JOB_COLUMN, null)
    .eq("id", opts.previewJobId)
    .eq("user_id", opts.userId)
    .maybeSingle()
  if (error) {
    opts.log?.warn({ err: error.message }, "trend run: could not read the preview job; masking stays auto")
    return
  }
  const row = isRec(data) ? data : null
  if (!row || row.user_id !== opts.userId || row.status !== "completed") return
  const input = isRec(row.input_data) ? row.input_data : null
  if (!input || input.type !== "cast-swap" || input.preview !== true || input.fullQualityOf != null) return
  if (!isRec(input.trend) || input.trend.id !== opts.trendId) return
  // `privacy`, else the old `faceMasking` (an engine before 0.394.0).
  if (privacyOutcomeOf(row.output_data)?.applied !== true) return
  const previewFill = isRec(input.__faceMasking) ? input.__faceMasking.fill : undefined
  const fill = masking.fill ?? (previewFill === "blur" || previewFill === "depth" ? previewFill : undefined)
  const zone = composed.maskingZoneLeftOut ? previewZone(input.__faceMasking) : undefined
  composed.body.faceMasking = withResolvedZone({
    ...masking,
    mode: "always",
    ...(fill ? { fill } : {}),
    ...(zone !== undefined ? { zone } : {}),
  })
}

/**
 * The zone a preview was masked with, from its stored `__faceMasking`: the
 * zone it carries, `null` (no margins) when it carries `null` or none at all
 * (a preview from before the default margins), or undefined when the stored
 * zone is not a valid one (the caller keeps its own).
 */
function previewZone(stored: unknown): FaceMaskingZone | null | undefined {
  const zone = isRec(stored) ? stored.zone : undefined
  if (zone === undefined || zone === null) return null
  const parsed = faceMaskingZoneSchema.safeParse(zone)
  return parsed.success ? parsed.data : undefined
}

/**
 * The Cast Swap route, reached as the caller through the internal secret —
 * the same shape as the plugin toolkit's `internalRequest` and MCP's
 * `mcpInject`. Caller headers go first so they cannot override the ones this
 * owns; the payload carries no `userId` (the auth hook would prefer it).
 *
 * The spend surface rides along (as routes/3d-scene.ts forwards it): a
 * browser-session request from a consumer surface (the Trends web app) is
 * `x-web-free-mode: true`, so the engine's credit guard holds a payg account
 * to its free pool under free-tier semantics — its own surface check would
 * read false on the internal hop (no Origin). The pool-aware flag replaces a
 * hard `paygSurfaceGuard` block here, as on 3d-scene's paid run.
 *
 * `provenance` is what the run's job carries of the caller's request: its
 * client `origin` and its surface (`source` / `source_detail`). It travels in
 * the server-side submission scope, never in the payload (the internal hop
 * ignores a body `origin` / `sessionId`). A trend run is filed in no session.
 * The caller's grant (`callerGrantOf`: an OAuth app's or an MCP session's
 * scopes) rides the same scope, so the engine route and the requests it makes
 * hold the caller to it.
 *
 * STANDING RULE: `payload` is a body the platform composed (`composeTrendRun`),
 * never a user-supplied body passed through. Any internal relay of a caller's
 * body to `/v1/cast-swap` must never forward `trendRun`: that field makes a
 * run a trend run and carries the record the trend routes show of it, so only
 * the platform's own composition may set it.
 */
export async function engineRequest(
  app: FastifyInstance,
  req: FastifyRequest,
  url: string,
  payload: object,
  headers: Record<string, string> = {},
  provenance?: Pick<TrustedJobProvenance, "origin" | "source">,
) {
  const userId = req.userId!
  const webFreeMode = await resolveWebSurfaceFlag(req)
  const carried = provenance
    ? { ...(provenance.origin ? { origin: provenance.origin } : {}), ...(provenance.source ? { source: provenance.source } : {}) }
    : undefined
  const grant = callerGrantOf(req)
  return withJobSubmissionContext({
    userId, method: "POST", url,
    ...(carried ? { provenance: carried } : {}),
    ...(grant !== undefined ? { grant } : {}),
  }, () =>
    app.inject({
      method: "POST",
      url,
      headers: {
        ...headers,
        "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        "x-internal-user-id": userId,
        ...(req.workspaceId ? { [WORKSPACE_HEADER_LOWER]: req.workspaceId } : {}),
        ...(webFreeMode ? { "x-web-free-mode": "true" } : {}),
        "content-type": "application/json",
      },
      // A Lite trend's length fit, under the key this environment's engine takes.
      payload: withWireLengthKey(payload),
    }),
  )
}

export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

/** The job id of an engine 2xx (bare, or under `data`), or null. */
export function jobIdOf(body: string): string | null {
  const parsed = parseJson(body)
  return isRec(parsed) ? (str(parsed.jobId) ?? (isRec(parsed.data) ? str(parsed.data.jobId) : null)) : null
}

/**
 * An engine refusal, as the engine gave it. ADMIN routes only: an admin
 * authors the hidden data, so the engine's own reason is theirs to see. The
 * public routes answer with `publicRefusal`.
 */
export function relay(reply: FastifyReply, res: { statusCode: number; body: string }) {
  const body = parseJson(res.body)
  if (isRec(body) && isRec(body.error)) return reply.status(res.statusCode).send(body)
  return reply
    .status(res.statusCode >= 500 ? res.statusCode : 502)
    .send({ error: { code: "engine_error", message: "Nodaro Motion answered unexpectedly." } })
}

/**
 * The engine's 400 codes the public routes keep, each with the platform's own
 * fixed text. Any other 400 is `trend_run_rejected`.
 */
const PUBLIC_400: Readonly<Record<string, string>> = {
  clip_out_of_range: "This trend's clip is outside the length a run allows.",
  preview_out_of_range: "This trend's preview runs past the end of its clip.",
  video_unreadable: "This trend's clip could not be read.",
  unsafe_url: "A picture's address is not a public http(s) address.",
  raw_reference_token: "Your details contain a reserved token ({image:, {video: or {audio:).",
  // A Kling 4 trend's own limits (the trend routes refuse a draft and 480p before the engine is asked).
  draft_unsupported: "This trend has no draft: run it at 720p or 1080p.",
  resolution_unsupported: "This trend does not run at that resolution.",
  too_many_images: "This trend's model takes fewer pictures in one run: use fewer pictures per slot.",
}

export const TREND_RUN_REJECTED = { code: "trend_run_rejected", message: "This trend couldn't run with these inputs." } as const

/**
 * An engine refusal on a PUBLIC trend route. The engine validated a body the
 * caller never saw (the source clip, the slots' role names, the references,
 * the trend prompt), so its message and `issues` can name any of them: every
 * reply here is built from fixed text, never from the engine's body.
 *
 *   402                      as given (credits, a workspace cap: the caller's own account)
 *   400 allowlisted code     that code, fixed text (PUBLIC_400)
 *   400 any other            400 trend_run_rejected
 *   401                      unauthorized
 *   403                      forbidden
 *   404                      not_found (the engine's only 404 is the session)
 *   413                      storage_limit_exceeded
 *   422 job_blocked          job_blocked, fixed text
 *   429                      rate_limited
 *   other 4xx                that status, trend_run_rejected
 *   503 host_too_old         503 engine_unsupported
 *   503 estimate_unavailable 503 estimate_unavailable
 *   any other (5xx, no JSON) 502 engine_error
 */
export function publicRefusal(reply: FastifyReply, res: { statusCode: number; body: string }) {
  const body = parseJson(res.body)
  const error = isRec(body) && isRec(body.error) ? body.error : null
  const code = error ? str(error.code) : null
  const send = (status: number, c: string, message: string) => reply.status(status).send({ error: { code: c, message } })
  const status = res.statusCode

  if (error && status === 402) return reply.status(402).send(body)
  if (error && status >= 400 && status < 500) {
    if (status === 400) {
      if (code && Object.hasOwn(PUBLIC_400, code)) return send(400, code, PUBLIC_400[code]!)
      return send(400, TREND_RUN_REJECTED.code, TREND_RUN_REJECTED.message)
    }
    if (status === 401) return send(401, "unauthorized", "Authentication required")
    if (status === 403) return send(403, "forbidden", "This run is not available to your account.")
    if (status === 404) return send(404, "not_found", "Session not found")
    if (status === 413) return send(413, "storage_limit_exceeded", "Your storage is full. Free some space and try again.")
    if (status === 422 && code === "job_blocked") return send(422, "job_blocked", "This run was blocked by the job policy.")
    if (status === 429) return send(429, "rate_limited", "Too many requests. Try again shortly.")
    return send(status, TREND_RUN_REJECTED.code, TREND_RUN_REJECTED.message)
  }
  if (status === 503 && code === "host_too_old") {
    return send(503, "engine_unsupported", "Trends are not available on this platform version yet.")
  }
  if (status === 503 && code === "estimate_unavailable") {
    return send(503, "estimate_unavailable", "The price can't be quoted right now. Try again shortly.")
  }
  return send(502, "engine_error", "Nodaro Motion answered unexpectedly.")
}

/**
 * A route's catch-all: a database without the trend tables (migration 549 not
 * applied yet — staging runs ahead of main) is 503 `not_available`, as
 * `routes/jobs.ts` answers for ratings; anything else is a 500.
 */
export function unavailableOrInternal(reply: FastifyReply, req: FastifyRequest, e: unknown, what: string) {
  if (e instanceof TrendsUnavailableError || isMissingTableError(e as { code?: string | null } | null)) {
    return reply.status(503).send({ error: { code: "not_available", message: "Trends are not available on this server yet." } })
  }
  return sendInternalError(reply, req, e, what)
}
