import type { FastifyInstance, FastifyRequest } from "fastify"
import { castSwapEngineFrom } from "@nodaro/shared/models"
import { supabase } from "../../lib/supabase.js"
import { castSwapSpelling } from "../../lib/video-remake-paths.js"
import { loadedEngineDeliversResolution } from "../../lib/video-remake-delivered-resolution.js"
import { invalidateBalanceCache } from "../billing/balance-cache.js"
import type { BillingContext } from "../../lib/billing-context.js"

/**
 * "First Remake on us" (migration 684): an account that never paid gets its
 * FIRST Video Remake run — a direct run or a trend run — even when the run's
 * quote is above its balance. The run reserves and charges as every run does;
 * the offer covers only what the balance could not, and the balance ends at 0.
 * The offer is that first run, needed or not: a first run its
 * credits pay for alone takes it too, with a cover of 0.
 *
 * The money moves in the database, atomically (684). The cover is NEVER in
 * the account's pools: it is held on the offer row, and only the covered run's
 * own holds (its job, its descendants, its LLM side holds) draw on it, after
 * the account's own credits (reserve_credits); what they leave unused goes back
 * to the cover. The offer ends by triggers on the run job's status and on
 * every settlement of the account's holds, with a sweep behind them
 * (`sweep_first_remake_offers`): the unspent cover is dropped. This module is
 * the request side:
 *
 *  1. `firstRemakeAdmit` — the run's balance check (`checkPayerCanAfford`,
 *     the Video Remake run route only) failed: the offer, when the account
 *     may take it and the run is one it covers, admits the run with a pending
 *     cover recorded on the request; a run it does not cover is refused with
 *     its own code.
 *  2. `pendingFirstRemakeCover` — the run's fee check (the credit guard)
 *     counts the pending cover: it has not landed yet (no job id).
 *  3. `takeFirstRemakeOffer` — the run's fee reservation, now that the job
 *     exists, for EVERY Video Remake run of a personal payer: the offer is
 *     taken by the account's first run, BEFORE the fee is reserved — with the
 *     pending cover, or with none (a cover of 0) when the balance paid.
 *
 * Only a personal payer: a workspace or a deployment pays for its members'
 * runs. Only a run admitted for its cover is refused when the offer cannot be
 * taken; any other run pays and runs as before.
 */

/** The 402 code for a run the offer would have to cover but does not take. */
export const FIRST_REMAKE_OPTION_LOCKED = "first_remake_option_locked" as const

export const FIRST_REMAKE_OPTION_LOCKED_MESSAGE =
  "Your first Remake on us covers a 4-second preview with Nodaro Prism at 480p or Nodaro Pulse at 720p. Add credits to run this one."

/** The same refusal for a request whose `resolution` is the size delivered (lib/video-remake-delivered-resolution.ts). */
export const FIRST_REMAKE_OPTION_LOCKED_MESSAGE_DELIVERED =
  "Your first Remake on us covers a 4-second preview at 720p with Nodaro Prism or Nodaro Pulse. Add credits to run this one."

/** One run the offer covers. */
export interface FirstRemakeAllowedRun {
  readonly engine: "nodaro-prism" | "nodaro-pulse"
  readonly resolution: "480p" | "720p"
  readonly preview: true
}

/** The runs the offer covers: a 4 s preview, on Prism at 480p or on Pulse at 720p, each by the size the ENGINE makes. */
export const FIRST_REMAKE_ALLOWED_RUNS: readonly FirstRemakeAllowedRun[] = [
  { engine: "nodaro-prism", resolution: "480p", preview: true },
  { engine: "nodaro-pulse", resolution: "720p", preview: true },
]

/** One covered run named by the size it is DELIVERED at (a request read the new way). */
export interface FirstRemakeAllowedDeliveredRun {
  readonly engine: "nodaro-prism" | "nodaro-pulse"
  readonly resolution: "720p"
  readonly preview: true
}

/**
 * The same covered runs as `FIRST_REMAKE_ALLOWED_RUNS`, named by the size delivered: Nodaro Prism's 480p take
 * stepped up once is delivered at 720p, Nodaro Pulse's 720p is delivered as made.
 */
export const FIRST_REMAKE_ALLOWED_DELIVERED_RUNS: readonly FirstRemakeAllowedDeliveredRun[] = [
  { engine: "nodaro-prism", resolution: "720p", preview: true },
  { engine: "nodaro-pulse", resolution: "720p", preview: true },
]

/** The state of an account's offer (684 `first_remake_offer_state`). */
export type FirstRemakeOfferState = "available" | "in_use" | "used" | "not_eligible"

/** What `GET /v1/user/credits` carries while an account may still take the offer. */
export interface FirstRemakeOfferBalanceField {
  readonly status: "available" | "in_use"
  /** By the engine's size: what a request carrying `upscale` (or any request, on an engine before delivered sizes) names. */
  readonly allowed: readonly FirstRemakeAllowedRun[]
  /** By the size delivered: present only while the engine reads a request without `upscale` that way. */
  readonly allowedDelivered?: readonly FirstRemakeAllowedDeliveredRun[]
}

/** What a Video Remake estimate carries while an account may still take the offer. */
export interface FirstRemakeOfferEstimateField {
  /** Whether this request's options are ones the offer covers. */
  readonly allowed: boolean
  /** What the offer would cover of this quote: 0 when the balance pays it, or the options are not covered. */
  readonly coverCredits: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// The schema may not be there. Staging runs `dev`'s code against the database
// production shares, and migrations reach it only on a push to `main`: until
// 684 lands, none of its functions exist. Every call here goes through
// `offerRpc`, which reads a missing function or relation as "no offer" — no
// error answered, nothing logged past one line, normal billing unchanged —
// and stops asking for a while (a minute), so a request pays no extra round
// trip; it asks again after that, so the offer turns on by itself when 684
// lands.
// ---------------------------------------------------------------------------
const ABSENT_RECHECK_MS = 60_000
let absentUntil = 0
let absentLogged = false

/**
 * Whether a PostgREST / Postgres error says the function called (or its table)
 * is not there: PostgREST's own "not in the schema cache" (PGRST202 for a
 * function, PGRST205 for a table), or Postgres' undefined function / table
 * (42883 / 42P01) naming THIS function or the offer's table. Anything else —
 * a missing column, another function's error — is a real error.
 */
export function isAbsentSchemaError(error: unknown, rpcName: string): boolean {
  if (!isRecord(error)) return false
  const code = typeof error.code === "string" ? error.code : ""
  if (code === "PGRST202" || code === "PGRST205") return true
  if (code !== "42883" && code !== "42P01") return false
  const message = typeof error.message === "string" ? error.message : ""
  return message.includes(rpcName) || message.includes("first_remake_offers")
}

type OfferRpcResult = { data: unknown; error: { message?: string } | null; absent: boolean }

/** A call to one of 684's functions; `absent` when the schema is not there (no call is made while it is known absent). */
async function offerRpc(name: string, args?: Record<string, unknown>): Promise<OfferRpcResult> {
  if (Date.now() < absentUntil) return { data: null, error: null, absent: true }
  const { data, error } = args === undefined ? await supabase.rpc(name) : await supabase.rpc(name, args)
  if (error && isAbsentSchemaError(error, name)) {
    absentUntil = Date.now() + ABSENT_RECHECK_MS
    if (!absentLogged) {
      absentLogged = true
      console.info(`[first-remake] the offer's schema is not in this database yet (${name}); the offer is off until it is`)
    }
    return { data: null, error: null, absent: true }
  }
  if (!error) absentLogged = false
  else console.warn(`[first-remake] ${name} failed: ${(error as { message?: string }).message ?? "unknown error"}`)
  return { data, error: (error as { message?: string } | null) ?? null, absent: false }
}

/** Tests: forget what was learned about the schema. */
export function resetFirstRemakeSchemaCheck(): void {
  absentUntil = 0
  absentLogged = false
}

/**
 * Whether a Video Remake run body is one the offer covers, read as the engine
 * reads it: the engine in any vocabulary (`castSwapEngineFrom`; absent =
 * Nodaro Prism), its resolution (absent = the engine's default: 480p on
 * Prism, 720p on Pulse; a draft is 480p, and the legacy `quality: "draft"`
 * means 480p draft), and a preview. Everything else in the body is allowed.
 */
export function firstRemakeRunAllowed(body: unknown): boolean {
  if (!isRecord(body)) return false
  if (body.preview !== true) return false
  const engine = body.engine === undefined ? "seedance-2-5" : castSwapEngineFrom(body.engine)
  if (engine === undefined) return false
  const resolution = body.resolution
  // Read the new way, Nodaro Prism's covered run is asked by the size it delivers: 720p (its 480p take stepped up),
  // absent = 720p; 480p where the deployment offers no step (then the engine's own size). Never 1080p or 4K.
  if (engine === "seedance-2-5" && readsDeliveredResolution(body)) {
    return resolution === undefined || resolution === "480p" || resolution === "720p"
  }
  if (engine === "seedance-2-5") {
    if (resolution !== undefined && resolution !== "480p") return false
    return true
  }
  // Nodaro Pulse: 720p (its default); it has no draft.
  if (body.draft === true || body.quality === "draft") return false
  return resolution === undefined || resolution === "720p"
}

/**
 * Whether the loaded engine reads this body's `resolution` as the size delivered, as the engine decides it: it
 * declares `castSwap.deliveredResolution`, and the body is a direct run (no `trendRun`) that is no draft (`draft:
 * true`, the legacy `quality: "draft"`) and carries no `upscale` key.
 */
export function readsDeliveredResolution(body: Record<string, unknown>): boolean {
  if (!loadedEngineDeliversResolution()) return false
  return !Object.hasOwn(body, "upscale") && body.trendRun === undefined && body.draft !== true && body.quality !== "draft"
}

/** Whether the request is a Video Remake RUN (either prefix), the one route the offer admits. */
export function isVideoRemakeRunRequest(req: FastifyRequest): boolean {
  if (req.method !== "POST") return false
  const route = req.routeOptions?.url ?? (req.url.split("?")[0] ?? "")
  return castSwapSpelling(route) === "/v1/cast-swap"
}

/** Whether the request is a Video Remake QUOTE (either prefix). */
export function isVideoRemakeEstimateRequest(req: FastifyRequest): boolean {
  if (req.method !== "POST") return false
  const route = req.routeOptions?.url ?? (req.url.split("?")[0] ?? "")
  return castSwapSpelling(route) === "/v1/cast-swap/estimate"
}

/** Whether `ctx` is a personal payer: the offer is never a workspace's or a deployment's. */
export function personalPayer(ctx: BillingContext | undefined): boolean {
  return ctx === undefined || ctx.payer === "user"
}

/**
 * The account's offer and spendable balance, or null when it cannot be read
 * (a failed read offers nothing: the safe direction for credits).
 */
export async function firstRemakeOfferStatus(userId: string): Promise<{ state: FirstRemakeOfferState; balance: number } | null> {
  try {
    const { data, error, absent } = await offerRpc("first_remake_offer_status", { p_user_id: userId })
    if (absent || error || !isRecord(data)) return null
    const state = data.state
    const balance = data.balance
    if (state !== "available" && state !== "in_use" && state !== "used" && state !== "not_eligible") return null
    if (typeof balance !== "number" || !Number.isFinite(balance)) return null
    return { state, balance }
  } catch {
    return null
  }
}

/** The balance route's field: present only while the account may still take the offer. */
export async function firstRemakeOfferForBalance(userId: string, ctx: BillingContext | undefined): Promise<FirstRemakeOfferBalanceField | null> {
  if (!personalPayer(ctx)) return null
  const status = await firstRemakeOfferStatus(userId)
  if (!status || (status.state !== "available" && status.state !== "in_use")) return null
  return {
    status: status.state,
    allowed: FIRST_REMAKE_ALLOWED_RUNS,
    ...(loadedEngineDeliversResolution() ? { allowedDelivered: FIRST_REMAKE_ALLOWED_DELIVERED_RUNS } : {}),
  }
}

/** The cover a run's quote needs from a balance: never negative, 0 for an overdrawn balance (never covered). */
export function coverNeeded(quote: number, balance: number): number {
  if (balance < 0) return 0
  return Math.max(0, Math.ceil(quote) - balance)
}

// ---------------------------------------------------------------------------
// The pending cover, from the balance check to the job's fee reservation. The
// engine hands the SAME request to all three toolkit calls; a trend run's
// injected request likewise. Never on the wire: a caller cannot set it.
// ---------------------------------------------------------------------------
interface PendingCover {
  readonly quote: number
  readonly cover: number
}
const pending = new WeakMap<FastifyRequest, PendingCover>()

/** The cover the request's run was admitted with, not yet granted; undefined when none. */
export function pendingFirstRemakeCover(req: FastifyRequest): PendingCover | undefined {
  return pending.get(req)
}

export type FirstRemakeAdmit =
  | { readonly kind: "cover"; readonly cover: number }
  | { readonly kind: "locked"; readonly statusCode: 402; readonly body: unknown }

/**
 * The run's balance check failed (`credits` = the run's whole quote, as the
 * engine asks it: the holds plus what may run beside them). Null = the offer
 * changes nothing (the refusal of before is sent).
 */
export async function firstRemakeAdmit(
  req: FastifyRequest,
  ctx: BillingContext | undefined,
  credits: number,
): Promise<FirstRemakeAdmit | null> {
  const userId = req.userId
  if (!userId || !isVideoRemakeRunRequest(req) || !personalPayer(ctx)) return null
  const status = await firstRemakeOfferStatus(userId)
  if (!status || status.state !== "available") return null
  const cover = coverNeeded(credits, status.balance)
  if (cover <= 0) return null
  if (!firstRemakeRunAllowed(req.body)) {
    return {
      kind: "locked",
      statusCode: 402,
      body: {
        error: {
          code: FIRST_REMAKE_OPTION_LOCKED,
          message: isRecord(req.body) && readsDeliveredResolution(req.body) ? FIRST_REMAKE_OPTION_LOCKED_MESSAGE_DELIVERED : FIRST_REMAKE_OPTION_LOCKED_MESSAGE,
        },
        required: Math.ceil(credits),
        balance: status.balance,
      },
    }
  }
  pending.set(req, { quote: Math.ceil(credits), cover })
  return { kind: "cover", cover }
}

/**
 * The account's first Video Remake run takes the offer (the cast-swap fee's
 * reservation of the run job `jobId`, before the fee is reserved): with the
 * request's pending cover, or with none (a cover of 0) for a run the balance
 * paid. Only the Video Remake run route, model `cast-swap`, a personal payer.
 * False only when a run admitted FOR its cover could not take the offer (it
 * was taken meanwhile): the caller refuses that run. Any other failure is
 * logged and the run goes on as before. Idempotent per job.
 */
export async function takeFirstRemakeOffer(req: FastifyRequest, jobId: string, modelIdentifier: string): Promise<boolean> {
  const cover = pending.get(req)
  pending.delete(req)
  const userId = req.userId
  if (!userId || modelIdentifier !== "cast-swap" || !isVideoRemakeRunRequest(req) || !personalPayer(req.billingContext)) return cover === undefined
  try {
    const { error, absent } = await offerRpc("grant_first_remake_cover", {
      p_user_id: userId,
      p_job_id: jobId,
      p_quote: cover ? cover.quote : null,
    })
    if (absent) return cover === undefined
    invalidateBalanceCache(userId)
    if (error) {
      console.warn(`[first-remake] the offer was not taken user=${userId} job=${jobId}: ${error.message}`)
      return cover === undefined
    }
    return true
  } catch (err) {
    invalidateBalanceCache(userId)
    console.warn(`[first-remake] taking the offer failed user=${userId} job=${jobId}: ${(err as Error).message}`)
    return cover === undefined
  }
}

/**
 * The run job is about to be deleted (a refused or failed reservation): take
 * back whatever cover it holds, now — a deleted job fires no status trigger.
 * Also undoes a grant that committed although its answer was lost. Never
 * throws; the sweep finalizes an offer whose job is gone in any case.
 */
export async function abandonFirstRemakeCover(userId: string, jobId: string): Promise<void> {
  try {
    const { error } = await offerRpc("finalize_first_remake_offer", { p_job_id: jobId, p_abandoned: true })
    if (error) console.warn(`[first-remake] abandon failed job=${jobId}: ${error.message}`)
  } catch (err) {
    console.warn(`[first-remake] abandon failed job=${jobId}: ${(err as Error).message}`)
  } finally {
    invalidateBalanceCache(userId)
  }
}

/**
 * The cover a request for `jobId` (a step of the account's covered run, or the
 * run's own job) may draw on now, for the API's credit pre-checks: 0 when the
 * job is no part of a running covered run, or the read fails (the reserve
 * stays the authority). Personal payers only.
 */
export async function firstRemakeCoverAvailable(userId: string | undefined, jobId: string | undefined, ctx: BillingContext | undefined): Promise<number> {
  if (!userId || !jobId || !personalPayer(ctx)) return 0
  try {
    const { data, error, absent } = await offerRpc("first_remake_cover_available", { p_user_id: userId, p_job_id: jobId })
    if (absent || error || typeof data !== "number" || !Number.isFinite(data)) return 0
    return Math.max(0, data)
  } catch {
    return 0
  }
}

/** One thing the sweep alerts on: a finalize that raised, or an offer in use for hours. */
export interface FirstRemakeAlert {
  readonly offer_id: string
  readonly user_id: string
  readonly job_id: string | null
  readonly status: string
  readonly reason: "finalize_error" | "in_use_too_long"
  readonly detail: string | null
}

/**
 * The backstop (the billing cron): finalizes every offer still in use, and
 * logs an [ALERT] for a finalize that raised and for an offer in use for more
 * than 6 hours (each once). Never throws; returns what it alerted on.
 */
export async function sweepFirstRemakeOffers(): Promise<FirstRemakeAlert[]> {
  try {
    const { data, error, absent } = await offerRpc("sweep_first_remake_offers")
    if (absent) return []
    if (error) {
      console.warn(`[first-remake] sweep failed: ${error.message}`)
      return []
    }
    const rows = (Array.isArray(data) ? data : []) as FirstRemakeAlert[]
    for (const row of rows) {
      invalidateBalanceCache(row.user_id)
      console.error(
        `[ALERT] [first-remake] offer ${row.offer_id} (${row.status}, job ${row.job_id ?? "deleted"}): ` +
          (row.reason === "finalize_error" ? `its end failed: ${row.detail ?? "unknown"}` : `in use for over 6 hours (${row.detail ?? ""})`),
      )
    }
    return rows
  } catch (err) {
    console.warn(`[first-remake] sweep failed: ${(err as Error).message}`)
    return []
  }
}

/** What the offer adds to a quote: the sum the run's admit checks (holds + privacy + the sheet retry). */
export function quoteCreditsOf(quote: Record<string, unknown>): number | null {
  const total = quote.totalCredits
  if (typeof total !== "number" || !Number.isFinite(total)) return null
  const extra = (key: string) => (typeof quote[key] === "number" && Number.isFinite(quote[key]) ? (quote[key] as number) : 0)
  return total + extra("privacyCredits") + extra("referencesRetryCredits")
}

/** The estimate's field for `userId`, or null while the account may not take the offer. */
export async function firstRemakeOfferForEstimate(
  userId: string,
  ctx: BillingContext | undefined,
  body: unknown,
  quote: Record<string, unknown>,
): Promise<FirstRemakeOfferEstimateField | null> {
  if (!personalPayer(ctx)) return null
  const credits = quoteCreditsOf(quote)
  if (credits === null) return null
  const status = await firstRemakeOfferStatus(userId)
  if (!status || status.state !== "available") return null
  const allowed = firstRemakeRunAllowed(body)
  return { allowed, coverCredits: allowed ? coverNeeded(credits, status.balance) : 0 }
}

/**
 * The Video Remake quote (the engine's route, either prefix) carries
 * `firstRemakeOffer` while the account may take the offer: decorated on its
 * way out, so the engine is unchanged. The trend estimate, which asks this
 * route, relays it. Best effort: a failed read sends the quote as it was.
 */
export function registerFirstRemakeEstimateHook(app: FastifyInstance): void {
  app.addHook("preSerialization", async (req, reply, payload) => {
    if (!isVideoRemakeEstimateRequest(req) || reply.statusCode !== 200 || !req.userId) return payload
    if (!isRecord(payload) || typeof payload.totalCredits !== "number") return payload
    const field = await firstRemakeOfferForEstimate(req.userId, req.billingContext, req.body, payload)
    return field ? { ...payload, firstRemakeOffer: field } : payload
  })
}
