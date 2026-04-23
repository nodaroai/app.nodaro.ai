"use client"

import { memo } from "react"
import { cn } from "@/lib/utils"
import "./style.css"

interface StylePreviewProps {
  readonly styleId: string
  readonly className?: string
}

/**
 * Static preview for a single image-style choice. Renders a common "sun over
 * hills" reference scene in the target style so users can compare how the same
 * composition is rendered across styles (oil paint brushstrokes vs pixel grid
 * vs watercolor washes vs comic halftone, etc.). No animations — style is a
 * rendering choice, not a kinetic effect.
 */
export const StylePreview = memo(function StylePreview({ styleId, className }: StylePreviewProps) {
  return (
    <div aria-hidden="true" className={cn("style-preview", `style-preview--${styleId}`, className)}>
      <div className="style-preview__scene">
        <div className="style-preview__sky" />
        <div className="style-preview__sun" />
        <div className="style-preview__hills" />
      </div>
    </div>
  )
})
