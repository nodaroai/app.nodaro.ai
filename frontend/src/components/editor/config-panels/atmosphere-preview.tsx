"use client"

import { memo } from "react"
import { cn } from "@/lib/utils"
import "./atmosphere.css"

interface AtmospherePreviewProps {
  readonly atmosphereId: string
  readonly className?: string
}

/**
 * Animated preview for a single atmosphere choice. Renders a frame + subject
 * with an overlay pseudo-element that animates the environmental effect
 * (drifting fog, falling rain, rotating god rays, floating particles).
 * Animations are subtle — the picker shows many tiles at once.
 */
export const AtmospherePreview = memo(function AtmospherePreview({
  atmosphereId,
  className,
}: AtmospherePreviewProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("atmosphere-preview", `atmosphere-preview--${atmosphereId}`, className)}
    >
      <div className="atmosphere-preview__frame">
        <div className="atmosphere-preview__subject" />
      </div>
    </div>
  )
})
