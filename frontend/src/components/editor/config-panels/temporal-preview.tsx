"use client"

import { memo } from "react"
import { cn } from "@/lib/utils"
import "./temporal.css"

interface TemporalPreviewProps {
  readonly temporalId: string
  readonly className?: string
}

/**
 * Animated preview for a single temporal choice. Renders a frame + subject
 * with overlays that animate the temporal character: a metronome bar at the
 * bottom ticks at the chosen speed for the Speed group, freeze variants
 * pause subject or world, direction variants slide arrows left/right,
 * shutter variants apply blur / stutter / stop-motion steps to the subject.
 */
export const TemporalPreview = memo(function TemporalPreview({
  temporalId,
  className,
}: TemporalPreviewProps) {
  const showBar = isSpeedCategory(temporalId)
  return (
    <div
      aria-hidden="true"
      className={cn("temporal-preview", `temporal-preview--${temporalId}`, className)}
    >
      <div className="temporal-preview__frame">
        <div className="temporal-preview__subject" />
        {showBar && <div className="temporal-preview__bar" />}
      </div>
    </div>
  )
})

/** Which ids belong to the "speed" category and therefore render the bar. */
const SPEED_IDS = new Set([
  "real-time",
  "slow-motion",
  "super-slow-mo",
  "time-lapse",
  "hyper-lapse",
  "speed-ramp",
])

function isSpeedCategory(id: string): boolean {
  return SPEED_IDS.has(id)
}
