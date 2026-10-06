import { CAPTION_SEGMENT_LEVER_KEYS, hookPlateCaptionSegments } from "@nodaro/prompts"
import {
  assembleVideoOverlayRequest,
  captionPlanPassThrough,
  combineVideosPassThrough,
  styleCaptionPlan,
  videoOverlayPassThrough,
  type PassThrough,
  type VideoOverlayNodeFields,
} from "@nodaro/shared"
import type { ResolvedInputs, SimpleNode } from "./types.js"

/**
 * The public video nodes that output their input unchanged when there is
 * nothing to do (spec R14). Asked by executeNode BEFORE the worker lane, so a
 * pass-through creates no job row and reserves nothing. Add Captions passes
 * through when a wired caption plan styles to no segment.
 */
export function passThroughFor(node: SimpleNode, inputs: ResolvedInputs): PassThrough | null {
  switch (node.type) {
    case "combine-videos":
      return combineVideosPassThrough(inputs.videoUrls ?? [])
    case "video-overlay": {
      const request = assembleVideoOverlayRequest({
        videoUrl: inputs.videoUrl ?? "",
        data: node.data as VideoOverlayNodeFields,
        wiredImageUrls: inputs.overlayImageUrls ?? [],
        planLayers: inputs.layerPlan,
      })
      if (request.planError) return null // the validator reports it in the payload builder
      return videoOverlayPassThrough({ videoUrl: inputs.videoUrl, planWired: inputs.layerPlan !== undefined, layerCount: request.layers.length })
    }
    case "add-captions": {
      if (inputs.captionPlan === undefined) return null
      const styled = styleCaptionPlan(inputs.captionPlan, node.data, { segmentsFor: hookPlateCaptionSegments, leverKeys: CAPTION_SEGMENT_LEVER_KEYS })
      if ("error" in styled) return null // the payload builder throws it before the reservation
      return captionPlanPassThrough({ videoUrl: inputs.videoUrl, planWired: true, segmentCount: styled.segments.length })
    }
    default:
      return null
  }
}
