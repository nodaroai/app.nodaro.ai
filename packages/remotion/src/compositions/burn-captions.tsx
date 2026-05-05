import React from "react"
import { AbsoluteFill } from "remotion"
import { TimelineClip } from "../lib/timeline-clip"
import { CaptionOverlay } from "../lib/caption-overlay"
import type { BurnCaptionsInputProps } from "../types"

/**
 * Burns kinetic captions onto a base video. Consumed by render-worker via
 * the "burn-captions" planType. inputProps nested under `.plan` to match
 * buildPlanRender's wrapping (render-worker.ts:191).
 */
export const BurnCaptions: React.FC<BurnCaptionsInputProps> = ({ plan }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <TimelineClip src={plan.sourceVideo} />
      <CaptionOverlay
        captions={plan.captions}
        style={plan.style}
        position={plan.position}
        fontSize={plan.fontSize}
        color={plan.color}
        backgroundColor={plan.backgroundColor}
      />
    </AbsoluteFill>
  )
}
