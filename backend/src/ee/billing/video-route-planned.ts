import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { SEEDANCE_2_CONTINUATION_REF_SEC } from "@nodaro/shared/models"
import { getVideoRouteSettings } from "./video-route-settings.js"
import type { getAppSettings } from "../../lib/app-settings.js"
import { supabase } from "../../lib/supabase.js"
import { config } from "../../lib/config.js"
import { loopbackFetch } from "../../services/workflow-engine/loopback-fetch.js"
import { pluginServicesLoaded, getPluginServices } from "../../lib/private-plugins/services-registry.js"
import type { PluginAlternateRoutesService } from "../../lib/private-plugins/types.js"
import { isRoutableVideoModel, priceFactorOf, priceFactorKey, videoRouteChoiceFor } from "../../lib/video-route-policy.js"
import { rowlessRouteToken, rowlessRunTokenFor } from "../../lib/video-route-decision.js"
import { routedChargedCredits, routeUsdToBaseCredits } from "./video-route-pricing.js"
import { PriceNotConfiguredError } from "./price-not-configured.js"

export function pricePlannedVideo(plan: Parameters<NonNullable<PluginAlternateRoutesService["quotePlan"]>>[0], priceId: string, settings: Awaited<ReturnType<typeof getAppSettings>>) {
  const quotePlan = getPluginServices().alternateRoutes?.quotePlan
  if (!quotePlan) throw new PriceNotConfiguredError(priceId)
  let quote: ReturnType<typeof quotePlan>
  try {
    quote = quotePlan(plan)
  } catch {
    throw new PriceNotConfiguredError(priceId)
  }
  if (!quote || !quote.routeId || !Number.isFinite(quote.usd) || quote.usd <= 0 || !Number.isFinite(quote.billedSeconds) || quote.billedSeconds <= 0) throw new PriceNotConfiguredError(priceId)
  const key = priceFactorKey({ model: plan.model, resolution: plan.draft ? "480p" : plan.resolution, hasRefVideo: plan.referenceVideoDurationsSec.length > 0, kind: "generate" })
  const base = routeUsdToBaseCredits(quote.usd * priceFactorOf(settings.video_route_price_factors, key))
  return { routeId: quote.routeId, credits: routedChargedCredits(base, priceId, settings) }
}

/**
 * The routed pricing of a plugin's multi-segment run (Generate Video Pro, Edit
 * Video Pro) — `PluginRoutedRunPricing` — when the admin routed its model for
 * the service and the route takes its segments: each segment quoted by the
 * route as it will be sent (the first from its start, every later one with
 * the previous segment's tail as its reference clip), plus the run's own fee
 * at its default row, and the signed quote `reserveRoutedRun` holds (and binds into the token its segments are sent with).
 * Undefined means the policy selected the default route. An unavailable selected quote rejects the run.
 */
export interface PlannedRun {
  service: string
  provider: string
  resolution: string
  segmentDurations: readonly number[]
  /** The continuation tail each later segment re-seeds from (extend renders); 0 for keyframes. */
  tailSec: number
  /** Each segment's reference clips (seconds), in segment order, when they are not just the
   *  previous segment's tail (Edit Video Pro: the source before the span, the source after it). */
  segmentReferenceSec?: ReadonlyArray<ReadonlyArray<number>>
  generateAudio?: boolean
  feeBase: number
  feeId: string
  /** Keyframes: the worst-case anchor images the run may generate (base credits in all, and how many). */
  anchors?: { reserveBase: number; count: number }
}

export async function routedRunPricingAnywhere(args: PlannedRun): Promise<Awaited<ReturnType<typeof routedRunPricing>>> {
  if (!isRoutableVideoModel(args.provider)) return undefined
  if (pluginServicesLoaded()) return routedRunPricing(args)
  if (videoRouteChoiceFor((await getVideoRouteSettings(args.provider)).video_route_policy, args.provider, args.service) !== "alternate") return undefined
  const port = process.env.BACKEND_PORT || process.env.PORT || "8000"
  const res = await loopbackFetch(`http://localhost:${port}/v1/video-route/internal/plan`, {
    method: "POST",
    headers: { "X-Internal-Orchestrator-Secret": config.INTERNAL_ORCHESTRATOR_SECRET, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10_000),
  }, { label: "video route planned segments", delaysMs: [500, 1500] })
  if (!res.ok) throw new PriceNotConfiguredError(args.feeId)
  const body = await res.json() as { pricing?: Awaited<ReturnType<typeof routedRunPricing>> | null }
  if (body.pricing === undefined) throw new Error("Invalid response to video route quote")
  return body.pricing ?? undefined
}

export async function routedRunPricing(args: PlannedRun, originalRoute?: "alternate"): Promise<{ quote: string; segmentChargedCredits: number[]; feeChargedCredits: number; anchorChargedCredits?: number; reserveChargedCredits: number } | undefined> {
  if (!isRoutableVideoModel(args.provider)) return undefined
  const settings = await getVideoRouteSettings(args.provider)
  if (!originalRoute && videoRouteChoiceFor(settings.video_route_policy, args.provider, args.service) !== "alternate") return undefined
  let routeId: string | undefined
  const segmentCredits: number[] = []
  for (const [i, outputSec] of args.segmentDurations.entries()) {
    const refs = args.segmentReferenceSec?.[i] ?? (i > 0 && args.tailSec > 0 ? [args.tailSec] : [])
    const priceId = buildVideoCreditModelIdentifier(args.provider, outputSec, undefined, "image-to-video", undefined, args.resolution, refs.length > 0)
    const planned = pricePlannedVideo({
      model: args.provider, service: args.service, resolution: args.resolution, outputSec,
      referenceVideoDurationsSec: refs, generateAudio: args.generateAudio,
    }, priceId, settings)
    routeId ??= planned.routeId
    segmentCredits.push(planned.credits)
  }
  if (!routeId) return undefined
  const { applyServiceMarkup } = await import("./service-margin.js")
  const feeCredits = args.feeBase > 0 ? applyServiceMarkup(args.feeBase, settings, args.feeId) : 0
  // Keyframes anchors: held at their worst case, marked up at the run's fee id as the default hold marks them.
  const anchors = args.anchors && args.anchors.count > 0 && args.anchors.reserveBase > 0 ? args.anchors : undefined
  const anchorCredits = anchors ? applyServiceMarkup(anchors.reserveBase, settings, args.feeId) : 0
  const reserveChargedCredits = feeCredits + anchorCredits + segmentCredits.reduce((a, b) => a + b, 0)
  return {
    quote: rowlessRouteToken({
      routeId,
      model: args.provider,
      service: args.service,
      feeChargedCredits: feeCredits,
      reserveChargedCredits,
      feeId: args.feeId,
      ...(anchors ? { anchorUnitBase: anchors.reserveBase / anchors.count, anchorsMax: anchors.count } : {}),
    }),
    segmentChargedCredits: segmentCredits,
    feeChargedCredits: feeCredits,
    ...(anchors ? { anchorChargedCredits: anchorCredits } : {}),
    reserveChargedCredits,
  }
}

export function routedGenerateVideoProPricing(pricing: {
  segmentDurations: number[]; resolution?: string; tailSec: number; feeBase: number; anchorReserve?: number
}, args: { provider: string; resolution?: string; renderMethod?: string; generateAudio?: boolean; hasOpeningVideo?: boolean }, anywhere = false) {
  const quote = anywhere ? routedRunPricingAnywhere : routedRunPricing
  return quote({
    service: "generate-video-pro", provider: args.provider, resolution: pricing.resolution ?? args.resolution ?? "720p",
    segmentDurations: pricing.segmentDurations, tailSec: args.renderMethod === "keyframes" ? 0 : pricing.tailSec,
    ...(args.hasOpeningVideo && args.renderMethod !== "keyframes" ? { segmentReferenceSec: pricing.segmentDurations.map(() => [pricing.tailSec]) } : {}),
    generateAudio: args.generateAudio, feeBase: pricing.feeBase, feeId: "generate-video-pro",
    ...(pricing.anchorReserve ? { anchors: { reserveBase: pricing.anchorReserve, count: pricing.segmentDurations.length * 2 } } : {}),
  })
}

/** The reference clips each Edit Video Pro segment is sent with (seconds), from its priced plan. */
export function editVideoProSegmentReferences(pricing: {
  spanStartSec: number
  segmentDurations: readonly number[]
  refsSecReserve: number
}): number[][] {
  const n = pricing.segmentDurations.length
  // The plan's reference count: the source before the span (when there is one long enough),
  // one continuation per later segment, the source after the span (likewise).
  const refCount = Math.round(pricing.refsSecReserve / SEEDANCE_2_CONTINUATION_REF_SEC)
  const before = pricing.spanStartSec >= SEEDANCE_2_CONTINUATION_REF_SEC ? 1 : 0
  const after = Math.max(0, refCount - before - (n - 1))
  return pricing.segmentDurations.map((_, i) => [
    ...(i === 0 && before ? [SEEDANCE_2_CONTINUATION_REF_SEC] : []),
    ...(i > 0 ? [SEEDANCE_2_CONTINUATION_REF_SEC] : []),
    ...(i === n - 1 && after ? [SEEDANCE_2_CONTINUATION_REF_SEC] : []),
  ])
}

/**
 * Edit Video Pro's routed pricing (`PluginRoutedRunPricing`), or undefined when
 * the model is not routed for the service: each segment at the resolution the
 * plan reserves, with the reference clips it is sent with.
 */
export async function routedEditVideoProPricing(provider: string, pricing: {
  spanStartSec: number
  segmentDurations: number[]
  refsSecReserve: number
  reserveResolution: string
  feeBase: number
}, anywhere = false): Promise<Awaited<ReturnType<typeof routedRunPricing>>> {
  const price = anywhere ? routedRunPricingAnywhere : routedRunPricing
  return price({
    service: "edit-video-pro",
    provider,
    resolution: pricing.reserveResolution,
    segmentDurations: pricing.segmentDurations,
    tailSec: 0,
    segmentReferenceSec: editVideoProSegmentReferences(pricing),
    feeBase: pricing.feeBase,
    feeId: "edit-video-pro",
  })
}

/**
 * A Generate Video Pro CONTINUATION of a model routed for the service: the
 * segments it re-renders quoted on the route as they are sent (a keyframes
 * segment from its own anchors with no reference; an extend segment after the
 * first with the previous segment's tail), plus the run's fee — the same
 * pricing a first run gets, so a continuation never runs on the other route
 * at the other price. Undefined when not routed (the default pricing stands).
 */
export async function routedContinuationPricing(
  args: { sourceJobId?: string; sourceUserId?: string; hasOpeningVideo?: boolean; provider: string; resolution: string; segmentDurations: number[]; tailSec?: number; renderMethod?: "extend" | "keyframes"; generateAudio?: boolean },
  pricing: { feeBase: number; tailSec?: number; billFromSegment?: number; billSegments?: number[] },
): Promise<Awaited<ReturnType<typeof routedRunPricing>>> {
  let originalRoute: "alternate" | undefined
  if (args.sourceJobId || args.sourceUserId) {
    if (!args.sourceJobId || !args.sourceUserId) throw new Error("Missing continuation source or owner")
    const { data, error } = await supabase.from("jobs").select("metadata")
      .eq("id", args.sourceJobId).eq("user_id", args.sourceUserId).maybeSingle()
    if (error) throw error
    if (!data) throw new Error("Continuation source is unavailable")
    const stored = data.metadata?.videoRouteRun?.token
    if (stored === undefined || stored === null) return undefined
    const token = rowlessRunTokenFor(stored, args.sourceJobId, 0)
    if (!token || token.userId !== args.sourceUserId || token.model !== args.provider || token.service !== "generate-video-pro") throw new Error("Invalid continuation route")
    originalRoute = "alternate"
  }
  const n = args.segmentDurations.length
  const from = Math.max(1, pricing.billFromSegment ?? 1)
  const billed = pricing.billSegments ?? Array.from({ length: Math.max(0, n - from + 1) }, (_, i) => from + i)
  if (billed.length === 0) return undefined
  const tail = pricing.tailSec ?? args.tailSec ?? 0
  const keyframes = args.renderMethod === "keyframes"
  return routedRunPricing({
    service: "generate-video-pro",
    provider: args.provider,
    resolution: args.resolution,
    segmentDurations: billed.map((s) => args.segmentDurations[s - 1]!),
    tailSec: 0,
    segmentReferenceSec: billed.map((s) => (!keyframes && (s > 1 || args.hasOpeningVideo) && tail > 0 ? [tail] : [])),
    ...(args.generateAudio !== undefined ? { generateAudio: args.generateAudio } : {}),
    feeBase: pricing.feeBase,
    feeId: "generate-video-pro",
  }, originalRoute)
}
