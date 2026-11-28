import type { FastifyRequest } from "fastify"
import { getVideoRouteSettings } from "./video-route-settings.js"
import { jobSubmissionParentJobId } from "../../lib/job-submission-context.js"
import { videoRequestAsRun } from "../../lib/video-request-norm.js"
import { anyModelRouted, videoRouteChoiceFor } from "../../lib/video-route-policy.js"
import { supabase } from "../../lib/supabase.js"
import type { CreditGuardOpts } from "../../middleware/credit-guard.js"
import { routedPriceIdOf } from "./video-route-listing.js"
import { quoteRoutedVideo, routedFinalizeCredits } from "./video-route-admission.js"

const MOTIONS = new Set(["generate-character-motion", "generate-location-motion", "generate-object-motion", "generate-creature-motion"])

/** Price only the affordability preflight. The job reservation always makes its own authoritative decision. */
export async function videoPreflightQuote(req: FastifyRequest, priceId: string, route: string, parse?: CreditGuardOpts["routedVideoInput"]): Promise<{ price: number; withAddons: boolean } | undefined> {
  const parsed = routedPriceIdOf(priceId)
  if (!parsed) return undefined
  if (parsed.kind === "draft-finalize") {
    const price = req.seedanceDraftFinalize ? await routedFinalizeCredits(req.seedanceDraftFinalize) : null
    return price === null ? undefined : { price, withAddons: false }
  }
  const policy = (await getVideoRouteSettings(priceId)).video_route_policy
  if (!anyModelRouted(policy)) return undefined
  const type = route.replace(/^\/v1\//, "")
  const parentJobId = jobSubmissionParentJobId(req)
  if (MOTIONS.has(type)) {
    // Motion assembles its actual prompt and resolves an entity's portrait after this guard.
    // Its atomic hold checks the finished request before any video can be enqueued.
    let service = type
    if (parentJobId) {
      const { data, error } = await supabase.from("jobs").select("job_type").eq("id", parentJobId).maybeSingle()
      if (error) throw error
      service = data?.job_type ?? type
    }
    return videoRouteChoiceFor(policy, parsed.model, service) === "alternate" ? { price: 0, withAddons: false } : undefined
  }
  if (!["generate-video", "text-to-video", "video-to-video", "lip-sync", "extend-video"].includes(type)) return undefined
  // Before the run handler's parse, authorize probing only a body that its actual route accepts.
  const body = parse?.(req.body, req)
  if (!body) return undefined
  const input = {
    ...videoRequestAsRun(body.input, req.videoNorm),
    ...(req.videoNorm?.duration !== undefined ? { duration: req.videoNorm.duration } : {}),
    ...(req.videoNorm?.resolution ? { resolution: req.videoNorm.resolution } : {}),
  }
  const price = await quoteRoutedVideo({ priceId, jobType: body.jobType, input, parentJobId })
  return price === null ? undefined : { price, withAddons: true }
}
