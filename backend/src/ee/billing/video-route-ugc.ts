import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { getVideoRouteSettings } from "./video-route-settings.js"
import { getPluginServices } from "../../lib/private-plugins/services-registry.js"
import type { PluginRoutedRunPricing } from "../../lib/private-plugins/types.js"
import { rowlessRouteToken } from "../../lib/video-route-decision.js"
import { isRoutableVideoModel, videoRouteChoiceFor, priceFactorKey, priceFactorOf } from "../../lib/video-route-policy.js"
import { routedChargedCredits, routeUsdToBaseCredits } from "./video-route-pricing.js"
import { PriceNotConfiguredError } from "./price-not-configured.js"

/** One UGC clip's planned takes and bounded, already-priced voice/reading work. */
export async function quoteUgcRoutedClip(args: {
  video: { tool: string; args: Readonly<Record<string, unknown>> }
  takes: number
  nonVideoChargedCredits: number
  hasReferenceAudio?: boolean
}): Promise<PluginRoutedRunPricing | undefined> {
  const input = args.video.args
  const model = typeof input.model === "string" ? input.model : ""
  if (!isRoutableVideoModel(model)) return undefined
  const settings = await getVideoRouteSettings(model)
  if (videoRouteChoiceFor(settings.video_route_policy, model, "ugc-clip") !== "alternate") return undefined
  const outputSec = Number(input.duration)
  const resolution = typeof input.resolution === "string" ? input.resolution : "720p"
  const references = input.reference_video_urls
  if (args.video.tool !== "generate_video" || !Number.isFinite(outputSec) || outputSec <= 0 ||
      !Number.isInteger(args.takes) || args.takes < 1 || args.takes > 10 ||
      !Number.isInteger(args.nonVideoChargedCredits) || args.nonVideoChargedCredits < 0 ||
      (references !== undefined && (!Array.isArray(references) || references.length > 0))) {
    throw new PriceNotConfiguredError("ugc-clip")
  }
  const priceId = buildVideoCreditModelIdentifier(model, outputSec, undefined, "image-to-video", undefined, resolution, false)
  const plan = {
    model, service: "ugc-clip", resolution, outputSec, referenceVideoDurationsSec: [],
    generateAudio: args.hasReferenceAudio ? false : input.generate_audio !== false,
  }
  const service = getPluginServices().alternateRoutes
  if (!service?.quotePlan) throw new PriceNotConfiguredError(priceId)
  const quote = service.quotePlan(plan)
  if (!quote?.routeId || !Number.isFinite(quote.usd) || quote.usd <= 0 ||
      !Number.isFinite(quote.billedSeconds) || quote.billedSeconds <= 0) throw new PriceNotConfiguredError(priceId)
  const factorKey = priceFactorKey({ model, resolution, hasRefVideo: false, kind: "generate" })
  const base = routeUsdToBaseCredits(quote.usd * priceFactorOf(settings.video_route_price_factors, factorKey))
  const charged = routedChargedCredits(base, priceId, settings)
  const reserveChargedCredits = charged * args.takes + args.nonVideoChargedCredits
  return {
    quote: rowlessRouteToken({
      routeId: quote.routeId, model, service: "ugc-clip", feeId: "ugc-clip", feeChargedCredits: 0,
      reserveChargedCredits, nonVideoChargedCreditsMax: args.nonVideoChargedCredits,
    }),
    segmentChargedCredits: Array.from({ length: args.takes }, () => charged),
    feeChargedCredits: 0,
    reserveChargedCredits,
  }
}
