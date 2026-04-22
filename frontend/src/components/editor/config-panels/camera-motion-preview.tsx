"use client"

import { memo } from "react"
import { cn } from "@/lib/utils"
import "./camera-motions.css"

interface CameraMotionPreviewProps {
  readonly motionId: string
  readonly className?: string
}

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
 * Pass sizing via className (e.g. `w-full aspect-square`, `w-full aspect-[16/9]`).
 */
export const CameraMotionPreview = memo(function CameraMotionPreview({
  motionId,
  className,
}: CameraMotionPreviewProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("cm-root", `cm-motion-${motionId}`, className)}
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
          <div className="cm-foreground cm-foreground-left" />
          <div className="cm-foreground cm-foreground-right" />
          <div className="cm-orbit-marker" aria-hidden="true" />
          <div className="cm-subject-group">
            <div className="cm-subject-shadow" />
            <div className="cm-subject">
              <div className="cm-subject-head">
                <div className="cm-face cm-head-front" />
                <div className="cm-face cm-head-back" />
                <div className="cm-face cm-head-left" />
                <div className="cm-face cm-head-right" />
              </div>
              <div className="cm-subject-body">
                <div className="cm-face cm-body-front" />
                <div className="cm-face cm-body-back" />
                <div className="cm-face cm-body-left" />
                <div className="cm-face cm-body-right" />
              </div>
            </div>
          </div>
          {motionId === "pov" && <div className="cm-overlay-pov" />}
          {motionId === "over-the-shoulder" && <div className="cm-overlay-ots" />}
        </div>
      </div>
    </div>
  )
})
