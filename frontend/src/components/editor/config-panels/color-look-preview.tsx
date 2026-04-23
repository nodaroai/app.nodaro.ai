"use client"

import { memo } from "react"
import { cn } from "@/lib/utils"
import "./color-look.css"

interface ColorLookPreviewProps {
  readonly colorLookId: string
  readonly className?: string
}

/**
 * Static preview for a single color/look choice. Renders a horizontal
 * 3-color swatch strip representing the dominant tones of the look. No
 * subject silhouette, no animations — color/look is a grade, not a
 * composition or motion. Per-id rules in `color-look.css` set the three
 * stripe colors (highlight / mid / shadow) for each entry.
 */
export const ColorLookPreview = memo(function ColorLookPreview({
  colorLookId,
  className,
}: ColorLookPreviewProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("color-look-preview", `color-look-preview--${colorLookId}`, className)}
    >
      <div className="color-look-preview__strip color-look-preview__strip--a" />
      <div className="color-look-preview__strip color-look-preview__strip--b" />
      <div className="color-look-preview__strip color-look-preview__strip--c" />
    </div>
  )
})
