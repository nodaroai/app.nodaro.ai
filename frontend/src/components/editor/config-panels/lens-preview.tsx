"use client"

import { memo } from "react"
import { cn } from "@/lib/utils"
import "./lens.css"

interface LensPreviewProps {
  readonly lensId: string
  readonly className?: string
}

/**
 * Static preview for a single lens choice. Renders a frame + subject sized
 * and positioned to communicate focal-length character (compression, DOF,
 * distortion). No animations — lens is an optical choice, not a motion.
 */
export const LensPreview = memo(function LensPreview({ lensId, className }: LensPreviewProps) {
  return (
    <div aria-hidden="true" className={cn("lens-preview", `lens-preview--${lensId}`, className)}>
      <div className="lens-preview__frame">
        <div className="lens-preview__subject" />
      </div>
    </div>
  )
})
