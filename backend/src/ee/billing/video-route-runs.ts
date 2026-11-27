// @registry-lookup holds and settles one routed run, at its own fee id (reserveCreditsForJob / CreditsService.commitCredits)
/**
 * A plugin's routed multi-segment run (Generate Video Pro, Edit Video Pro) —
 * held, quoted per segment, and settled by the host end to end
 * (`PluginRoutedRunPricing`): the plugin does no routed arithmetic.
 *
 *   - {@link reserveRoutedRun}: holds the run's signed quote (charged credits,
 *     never marked up again) under its fee id and binds the token its segments
 *     are sent with to that job, its user and an expiry;
 *   - {@link quoteRowlessSegment}: each segment's quote as it is sent — the
 *     route's `quote` times the key's factor, marked up at the segment's own
 *     price id; a segment with no quote is never sent (never priced at 0);
 *   - {@link settleRoutedRunJob}: the fee plus each segment on the parent's
 *     route ledger — its reported billed cost by the one routed rule. A missing receipt keeps settlement pending.
 */
import { z } from "zod"
import type { FastifyReply, FastifyRequest } from "fastify"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { supabase } from "../../lib/supabase.js"
import { getAppSettings, settingsReadFailed } from "../../lib/app-settings.js"
import { getPluginServices } from "../../lib/private-plugins/services-registry.js"
import type { PluginAlternateRouteRequest, PluginRoutedRunPricing } from "../../lib/private-plugins/types.js"
import { bindRowlessRouteToken, rowlessRouteTokenOf, rowlessRunTokenFor, type RowlessRouteToken } from "../../lib/video-route-decision.js"
import { priceFactorKey } from "../../lib/video-route-policy.js"
import { getVideoRouteSettings } from "./video-route-settings.js"
import { deliveredTask, readRouteLedger, type RouteLedger } from "../../lib/video-route-ledger.js"
import { resolveRouteLedger } from "../../lib/video-route-resolve.js"
import { reserveCreditsForJob, type CreditReservation } from "../../middleware/credit-guard.js"
import { commitRoutedCharge, deferRoutedSettlement, releaseRejectedCharge } from "./video-route-receipt.js"
import { recordVideoRouteAlert } from "./video-route-alerts.js"
import { applyServiceMarkup } from "./service-margin.js"
import { routedQuote, routedPriceIdOf, routedSettlementCredits } from "./video-route-pricing.js"

/** Holds a routed run (see the module doc); undefined when a reply was sent. */
export async function reserveRoutedRun(
  req: FastifyRequest,
  reply: FastifyReply,
  jobId: string,
  route: PluginRoutedRunPricing,
): Promise<(CreditReservation & { token: string }) | undefined> {
  const quote = rowlessRouteTokenOf(route?.quote)
  const hold = quote?.reserveChargedCredits
  const feeId = quote?.feeId
  const unavailable = () => {
    reply.status(503).send({ error: { code: "video_route_unavailable", message: "This video cannot be started right now. Please try again." } })
    return undefined
  }
  if (!quote || (quote.stage ?? "quote") !== "quote" || typeof hold !== "number" || !(hold > 0) || typeof feeId !== "string" || !req.userId) {
    console.error(`[video-route] job ${jobId}: a routed run's quote does not verify; not held.`)
    return unavailable()
  }
  const token = bindRowlessRouteToken(route.quote, { parentJobId: jobId, userId: req.userId })
  if (!token) return unavailable()
  const reserved = await reserveCreditsForJob(req, reply, jobId, feeId, { holdCredits: hold, oncePerJob: true, routedRun: { token, env: quote.env } })
  if (!reserved) return undefined
  const durable = rowlessRunTokenFor(reserved.routedRunToken, jobId, 0)
  if (!durable || durable.userId !== req.userId || durable.feeId !== feeId || durable.reserveChargedCredits !== hold) return unavailable()
  return { ...reserved, token: reserved.routedRunToken! }
}

/** A segment's quote as it is sent: its price id, the factored USD it was quoted at, and its charged credits. */
export interface RowlessSegmentQuote {
  readonly factor: number
  readonly priceId: string
  readonly quotedUsd: number
  readonly chargedCredits: number
}

/** Throws `PriceNotConfiguredError` when the route gives no quote: the segment is then never sent. */
export async function quoteRowlessSegment(token: RowlessRouteToken, req: PluginAlternateRouteRequest): Promise<RowlessSegmentQuote> {
  const settings = await getVideoRouteSettings(token.model)
  const hasRef = req.referenceVideoUrls.length > 0
  const outputSec = req.outputSec ?? req.durationSec
  const priceId = buildVideoCreditModelIdentifier(token.model, outputSec, undefined, "image-to-video", undefined, req.resolution, hasRef)
  const factorKey = priceFactorKey({ model: token.model, resolution: req.resolution, hasRefVideo: hasRef, kind: "generate" })
  const q = routedQuote({ service: getPluginServices().alternateRoutes, request: req, priceId, factorKey, factors: settings.video_route_price_factors, settings })
  return { priceId, factor: q.factor, quotedUsd: q.usd * q.factor, chargedCredits: q.chargedCredits }
}

/** No price is payable until the supplier reports the cost of this task. */
export function rowlessSegmentCharge(seg: { billedUsd: number | null; priceId: string | null }, settings: Awaited<ReturnType<typeof getAppSettings>>): { credits: number | null; reported: boolean } {
  if (!seg.priceId || seg.billedUsd === null || !Number.isFinite(seg.billedUsd) || seg.billedUsd < 0) return { credits: null, reported: false }
  const { chargedCredits } = routedSettlementCredits({ providerCostUsd: seg.billedUsd, priceId: seg.priceId, settings })
  return { credits: chargedCredits, reported: true }
}

export interface RoutedDeliveryOptions {
  waiveFee?: boolean
  anchorsGenerated?: number
  nonVideoChargedCredits?: number
}

export const savedRoutedRunSchema = z.object({
  token: z.string().min(1),
  usageLogId: z.string().min(1),
  opts: z.object({
    waiveFee: z.boolean().optional(),
    anchorsGenerated: z.number().int().nonnegative().optional(),
    nonVideoChargedCredits: z.number().int().nonnegative().optional(),
  }).optional(),
})
export type SavedRoutedRun = z.infer<typeof savedRoutedRunSchema>

function boundedCount(value: number | undefined, max: number | undefined): number {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error("Invalid routed delivery count")
  return Math.min(value ?? 0, max ?? 0)
}

/** A run's delivery options bounded by what its signed quote covers. */
export function boundRunOptions(run: RowlessRouteToken, opts: RoutedDeliveryOptions): RoutedDeliveryOptions {
  return boundOptions(run, opts)
}

function boundOptions(run: RowlessRouteToken, opts: RoutedDeliveryOptions): RoutedDeliveryOptions {
  return {
    waiveFee: opts.waiveFee === true,
    anchorsGenerated: boundedCount(opts.anchorsGenerated, run.anchorsMax),
    nonVideoChargedCredits: boundedCount(opts.nonVideoChargedCredits, run.nonVideoChargedCreditsMax),
  }
}

export async function prepareRoutedRunSettlement(usageLogId: string, jobId: string, token: string, opts: RoutedDeliveryOptions = {}): Promise<void> {
  const run = rowlessRunTokenFor(token, jobId, 0)
  if (!run?.userId || !run.feeId) throw new Error(`Job ${jobId}: invalid routed reservation`)
  const { data, error } = await supabase.rpc("prepare_video_route_run", {
    p_job_id: jobId, p_user_id: run.userId, p_usage_log_id: usageLogId, p_fee_id: run.feeId, p_hold: run.reserveChargedCredits,
    p_token: token, p_env: run.env, p_opts: boundOptions(run, opts),
  })
  const saved = savedRoutedRunSchema.safeParse(data).data
  const verified = rowlessRunTokenFor(saved?.token, jobId, 0)
  if (error || !saved?.opts || saved.token !== token || saved.usageLogId !== usageLogId || !verified || verified.userId !== run.userId || verified.feeId !== run.feeId || verified.reserveChargedCredits !== run.reserveChargedCredits) {
    throw new Error(`Job ${jobId}: could not verify its saved routed reservation (${error?.message ?? "missing receipt"})`)
  }
}

/** What a routed run is charged, from its ledger. */
export type RoutedRunCharge =
  | {
      kind: "billed"; charged: number
      /** The bills about to be charged (a segment with no bill counted at its quote when `usedQuote`), and the segments' quotes: null when one has none. */
      billedUsd: number; quotedUsd: number | null
      usedQuote: boolean
      /** Segments billed above their own quote (the price factor follows them once the run is charged). */
      over: ReadonlyArray<{ key: string; credits: number; billedUsd: number; quotedUsd: number; quoteFactor: number; priceId: string }>
    }
  | { kind: "pending"; reason: string; cause?: "unbilled" | "nothing-delivered" }

/**
 * A routed run's charge: its fee, anchors and add-ons, plus each DELIVERED
 * segment at its real bill. A segment the route never billed is pending,
 * unless `atQuote` (an admin's decision) charges it at the quote it was sent
 * with. Pure.
 */
export function routedRunChargeOf(run: RowlessRouteToken, opts: RoutedDeliveryOptions, ledger: RouteLedger, settings: Awaited<ReturnType<typeof getAppSettings>>, atQuote: boolean): RoutedRunCharge {
  // A segment that started and was never read to an end may have been billed: nothing is settled over it.
  if ((ledger.unresolvedStarts ?? []).some((s) => s.key !== "")) return { kind: "pending", cause: "unbilled", reason: "A started segment has not been read to its end" }
  // Only delivered segments are charged: one the route ended with no result, or one given up on as unresolved, is not.
  const segments = ledger.segments.filter(deliveredTask)
  if (!segments.length) return { kind: "pending", cause: "nothing-delivered", reason: "No completed routed segment is recorded" }
  const anchors = opts.anchorsGenerated ?? 0
  const anchorCredits = anchors > 0 ? applyServiceMarkup(Math.ceil(anchors * (run.anchorUnitBase ?? 0)), settings, run.feeId ?? "") : 0
  let charged = (opts.waiveFee ? 0 : (run.feeChargedCredits ?? 0)) + anchorCredits + (opts.nonVideoChargedCredits ?? 0)
  let billedUsd = 0
  let quotedUsd: number | null = 0
  let usedQuote = false
  const over: Array<{ key: string; credits: number; billedUsd: number; quotedUsd: number; quoteFactor: number; priceId: string }> = []
  for (const seg of segments) {
    const billed = rowlessSegmentCharge(seg, settings).credits
    const quoteCredits = atQuote && seg.priceId && seg.quotedCredits !== null ? seg.quotedCredits : null
    const credits = billed ?? quoteCredits
    if (credits === null) return { kind: "pending", cause: "unbilled", reason: "A completed routed segment reported no verified bill, or has no price id" }
    if (billed === null) usedQuote = true
    charged += credits
    billedUsd += billed !== null ? (seg.billedUsd ?? 0) : (seg.quotedUsd ?? 0)
    quotedUsd = quotedUsd !== null && seg.quotedUsd !== null && seg.quotedUsd > 0 ? quotedUsd + seg.quotedUsd : null
    if (billed !== null && seg.billedUsd !== null && seg.quotedUsd !== null && seg.quotedUsd > 0 && seg.billedUsd > seg.quotedUsd && seg.priceId) {
      over.push({ key: seg.key, credits, billedUsd: seg.billedUsd, quotedUsd: seg.quotedUsd, quoteFactor: seg.quoteFactor ?? 1, priceId: seg.priceId })
    }
  }
  return { kind: "billed", charged, billedUsd, quotedUsd, usedQuote, over }
}

/** The persisted delivery, including a waived stitch fee, is authoritative on replay. */
export async function settleRoutedRunJob(usageLogId: string, jobId: string, token: string, _opts?: RoutedDeliveryOptions): Promise<void> {
  const run = rowlessRunTokenFor(token, jobId, 0)
  if (!run || !run.feeId || typeof run.feeChargedCredits !== "number") throw new Error(`job ${jobId}: its routed run token does not verify for this job`)
  const { data, error } = await supabase.from("jobs").select("status, user_id, usage_log_id, run:metadata->videoRouteRun").eq("id", jobId).maybeSingle()
  const job = z.object({ status: z.string(), user_id: z.string(), usage_log_id: z.string(), run: savedRoutedRunSchema }).safeParse(data).data
  if (error || !job || job.status !== "completed" || job.user_id !== run.userId || job.usage_log_id !== usageLogId ||
      job.run?.token !== token || job.run.usageLogId !== usageLogId || !job.run.opts) {
    return deferRoutedSettlement(jobId, "Could not verify this run's delivered result and reservation")
  }
  const settings = await getAppSettings()
  if (settingsReadFailed(settings)) return deferRoutedSettlement(jobId, "Could not read pricing settings")
  const opts = boundOptions(run, job.run.opts)
  let ledger = await readRouteLedger(jobId)
  // Before anything is charged: a segment that started and was never read to its end, or a
  // delivered one with no bill yet, is read from the route once more (lib/video-route-resolve.ts).
  if ((ledger.unresolvedStarts ?? []).length > 0 || ledger.segments.some((seg) => deliveredTask(seg) && seg.billedUsd === null)) {
    if ((await resolveRouteLedger(jobId, run.routeId)).resolved > 0) ledger = await readRouteLedger(jobId)
  }
  // An admin released it (a bill held, or one the route never reported): the hold goes back, whatever the ledger says.
  if (ledger.settle?.decision === "rejected") {
    // The loss recorded is the best known: the real bill of what was billed, the quote of what was
    // not. (A replay after the release finds the loss already recorded, and keeps it.)
    const best = routedRunChargeOf(run, opts, ledger, settings, true)
    const loss = ledger.settle.state === "waived" ? (ledger.settle.uncollected ?? 0) : best.kind === "billed" ? best.charged : (ledger.settle.credits ?? run.reserveChargedCredits ?? 0)
    return releaseRejectedCharge(usageLogId, jobId, loss, { unbilledSends: best.kind === "billed" ? best.usedQuote : true })
  }
  const charge = routedRunChargeOf(run, opts, ledger, settings, ledger.settle?.atQuote === true)
  if (charge.kind === "pending") return deferRoutedSettlement(jobId, charge.reason, charge.cause)
  // The total about to be charged against the sum of the segments' quotes; a bill held for a decision raises no factor.
  const outcome = await commitRoutedCharge(usageLogId, jobId, charge.charged, { billedUsd: charge.billedUsd, quotedUsd: charge.quotedUsd, policy: settings.video_route_policy, model: run.model, unbilledSends: charge.usedQuote })
  // A bill an admin rejected moves no price.
  if (outcome === "released") return
  for (const seg of charge.over) {
    const parsed = routedPriceIdOf(seg.priceId)
    if (!parsed) continue
    const factorKey = priceFactorKey(parsed)
    await recordVideoRouteAlert({ key: `price:${jobId}:${seg.key}`, kind: "price-increase", jobId, model: run.model, factorKey, message: `A segment's confirmed bill exceeded its quote; its charge is ${seg.credits} credits.` })
    const { raiseFactorFrom } = await import("./video-route-settlement.js")
    await raiseFactorFrom({ model: run.model, factorKey, factor: seg.quoteFactor }, seg.quoteFactor * seg.billedUsd / seg.quotedUsd, `job ${jobId} segment ${seg.key} billed above its quote`)
  }
}
