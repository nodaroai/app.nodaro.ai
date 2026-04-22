"use client"

import { memo } from "react"
import { cn } from "@/lib/utils"
import "./camera-motions.css"

interface CameraMotionPreviewProps {
  readonly motionId: string
  readonly className?: string
  /** When true, the preview renders at the full width of its container with aspect-square. */
  readonly fill?: boolean
}

/** SVG mountain silhouette used for the parallax depth layer. */
function MountainSilhouette() {
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
      <polygon
        points="0,20 12,7 24,13 38,4 52,10 66,5 78,12 90,7 100,10 100,20"
        fill="currentColor"
      />
    </svg>
  )
}

/**
 * Animated preview for a single camera motion.
 * Renders a stylized scene (sky, horizon, parallax mountains, subject) and
 * applies the motion-specific animation class defined in camera-motions.css.
 */
export const CameraMotionPreview = memo(function CameraMotionPreview({
  motionId,
  className,
  fill = true,
}: CameraMotionPreviewProps) {
  const overlay: "pov" | "ots" | null =
    motionId === "pov" ? "pov" : motionId === "over-the-shoulder" ? "ots" : null

  return (
    <div
      aria-hidden="true"
      className={cn("cm-root", `cm-motion-${motionId}`, fill && "w-full aspect-square", className)}
    >
      <div className="cm-viewport">
        <div className="cm-scene">
          <div className="cm-sky" />
          <div className="cm-ground" />
          <div className="cm-horizon" />
          <div className="cm-depth-far">
            <MountainSilhouette />
          </div>
          <div className="cm-depth-near cm-depth-near-left" />
          <div className="cm-depth-near cm-depth-near-right" />
          <div className="cm-subject-group">
            <div className="cm-subject">
              <div className="cm-subject-head" />
              <div className="cm-subject-body" />
            </div>
          </div>
          {overlay === "pov" && <div className="cm-overlay-pov" />}
          {overlay === "ots" && <div className="cm-overlay-ots" />}
        </div>
      </div>
    </div>
  )
})
