/**
 * What the public trend routes (`ee/routes/trends.ts`) and the admin ones
 * (`ee/routes/admin-trends.ts`) share about trend RUNS:
 *
 * - reading a run back: the `TrendRun` whitelist mapper over a Cast Swap job
 *   row (redacted first, then mapped field by field), and the Full Quality
 *   jobs folded into their drafts;
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
import { withJobSubmissionContext } from "../../../lib/job-submission-context.js"
import { resolveWebSurfaceFlag } from "../../../middleware/credit-guard.js"
import { redactPrivateJobData } from "../../../lib/public-job-data.js"
import { creditStatusMapFor, creditsChargedOf } from "../../../lib/job-credit-status.js"
import { sideHoldChargesFor } from "../../../lib/job-step-charge.js"
import { getPluginSupports } from "../../../lib/private-plugins/supports-registry.js"
import { sendInternalError } from "../../../lib/http-errors.js"
import { isMissingTableError } from "../../../lib/postgrest-errors.js"
import { TrendsUnavailableError } from "./store.js"
import type { ComposedTrendRun, TrendRunDisplay, TrendRunDisplaySlot } from "./compose.js"
import type { Choice, TrendSlotKind } from "./types.js"

// ── the public run shape (mirrored by the SDK) ──────────────────────────────

export interface TrendRun {
  jobId: string
  status: string
  progress: number | null
  error: { code?: string; message: string } | null
  createdAt: string
  completedAt: string | null
  trend: TrendRunDisplay["trend"]
  example: number
  slots: TrendRunDisplay["slots"]
  details?: string
  preview: boolean
  resolution: string
  draft: boolean
  videoUrl: string | null
  posterUrl: string | null
  creditsCharged: number | null
  fullQuality: { jobId: string; status: string; videoUrl: string | null } | null
  fullQualityUntil: string | null
}

type Chips = Partial<Record<"body" | "outfit" | "hair" | "coat" | "shape" | "finish", Choice>>

export const SLOT_KINDS: readonly TrendSlotKind[] = ["person", "location", "product", "pet"]
const CHIP_KEYS = ["body", "outfit", "hair", "coat", "shape", "finish"] as const
/** A completed draft run can be redone in Full Quality for this long. */
const FULL_QUALITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

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
  const completedAt = row.completed_at ?? null
  const fullQualityUntil =
    draft && row.status === "completed" && completedAt && !Number.isNaN(Date.parse(completedAt))
      ? new Date(Date.parse(completedAt) + FULL_QUALITY_WINDOW_MS).toISOString()
      : null
  const details = str(input.details)
  const fqRow = fq ? redactPrivateJobData(fq) : null
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
    videoUrl: row.status === "completed" ? videoUrl : null,
    posterUrl: row.status === "completed" ? posterUrl : null,
    creditsCharged: creditsChargedOf(row.usage_log_id, credits, row.id, sideCharges),
    fullQuality: fqRow
      ? {
          jobId: fqRow.id,
          status: fqRow.status,
          videoUrl: fqRow.status === "completed" ? outputVideo(fqRow.output_data).videoUrl : null,
        }
      : null,
    fullQualityUntil,
  }
}

/**
 * The Full Quality job of each of `draftIds`, by draft id, owned by `owners`
 * (one user, or several). One Full Quality per draft; should there ever be
 * more, the newest wins. Throws on a database error.
 */
export async function fullQualityByDraft(draftIds: string[], owners: string | string[]): Promise<Map<string, RunJobRow>> {
  const out = new Map<string, RunJobRow>()
  if (draftIds.length === 0) return out
  let query = supabase.from("jobs").select(`${RUN_JOB_COLS}, fullQualityOf:input_data->>fullQualityOf`)
  query = typeof owners === "string" ? query.eq("user_id", owners) : query.in("user_id", owners)
  const { data, error } = await query
    .filter("input_data->>type", "eq", "cast-swap")
    .in("input_data->>fullQualityOf", draftIds)
    .order("created_at", { ascending: false })
  if (error) throw new Error(`Could not read Full Quality runs: ${error.message}`)
  for (const r of (data ?? []) as unknown as Array<RunJobRow & { fullQualityOf?: unknown }>) {
    const of = str(r.fullQualityOf) ?? (isRec(r.input_data) ? str(r.input_data.fullQualityOf) : null)
    if (of && !out.has(of)) out.set(of, r)
  }
  return out
}

/** Map a page of run rows to `TrendRun`s, with their Full Quality jobs and credits. */
export async function toTrendRuns(
  page: RunJobRow[],
  owners: string | string[],
  audience: RunAudience = "public",
): Promise<TrendRun[]> {
  if (page.length === 0) return []
  const [fqByDraft, credits, sideCharges] = await Promise.all([
    fullQualityByDraft(page.map((r) => r.id), owners),
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
 * face masking when the trend masks, a trend pre prompt when it has one, and
 * the requested resolution.
 */
export function engineSupports(composed: ComposedTrendRun): boolean {
  const cs = getPluginSupports().castSwap
  if (!cs || cs.trendRun !== true) return false
  for (const kind of composed.needs.roleKinds) if (!cs.roleKinds.includes(kind)) return false
  if (composed.needs.fixedReferences && cs.fixedReferences !== true) return false
  if (composed.needs.faceMasking && cs.faceMasking !== true) return false
  if (composed.needs.trendPrePrompt && cs.trendPrePrompt !== true) return false
  return cs.resolutions.includes(composed.body.resolution)
}

/**
 * A full run follows its preview's face masking. Only when the trend's masking
 * is "auto" and the body to send is not itself a preview (`composed.body.preview`,
 * what the engine gets, not a separate flag): the request's `previewJobId`
 * is read, and when it is the caller's own completed preview run of THIS
 * trend (`input_data.trend.id`, not a Full Quality job) whose output says the
 * faces were masked (`output_data.faceMasking.applied === true`), the run is
 * sent with `mode: "always"` and the trend's other masking settings, so it
 * does not first try unmasked what the preview already showed is refused.
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
  const output = isRec(row.output_data) ? row.output_data : null
  if (!output || !isRec(output.faceMasking) || output.faceMasking.applied !== true) return
  composed.body.faceMasking = { ...masking, mode: "always" }
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
) {
  const userId = req.userId!
  const webFreeMode = await resolveWebSurfaceFlag(req)
  return withJobSubmissionContext({ userId, method: "POST", url }, () =>
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
      payload,
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
    .send({ error: { code: "engine_error", message: "Cast Swap answered unexpectedly." } })
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
  return send(502, "engine_error", "Cast Swap answered unexpectedly.")
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
