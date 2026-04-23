"use client"

import { memo } from "react"
import { cn } from "@/lib/utils"
import "./lighting.css"

interface LightingPreviewProps {
  readonly lightingId: string
  readonly className?: string
}

/**
 * Static preview for a single lighting choice. Renders a frame + subject
 * silhouette with a tint and shadow placement that communicates the
 * lighting character: time-of-day choices warm or cool the ambient,
 * style choices vary shadow shape on the subject, direction choices
 * place a bright spot on the appropriate side. No animations — lighting
 * is a setup, not a motion.
 */
export const LightingPreview = memo(function LightingPreview({
  lightingId,
  className,
}: LightingPreviewProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("lighting-preview", `lighting-preview--${lightingId}`, className)}
    >
      <div className="lighting-preview__frame">
        <div className="lighting-preview__subject" />
      </div>
    </div>
  )
})
