"use client"

import { memo } from "react"
import { cn } from "@/lib/utils"
import "./lens.css"

interface LensPreviewProps {
  readonly lensId: string
  readonly variant?: "scene" | "hybrid"
  readonly className?: string
}

/**
 * Static preview for a single lens choice. The scene variant is available for
 * contextual previews; the hybrid variant shows an oversized lens with a
 * minimal near/far image inside the glass.
 */
export const LensPreview = memo(function LensPreview({
  lensId,
  variant = "scene",
  className,
}: LensPreviewProps) {
  const isHybrid = variant === "hybrid"

  return (
    <div
      aria-hidden="true"
      className={cn(
        "lens-preview",
        `lens-preview--${variant}`,
        `lens-preview--${lensId}`,
        className,
      )}
    >
      <div className="lens-preview__frame">
        {isHybrid ? (
          <div className="lens-preview__lens-badge">
            <div className="lens-preview__lens-glass">
              <div className="lens-preview__image-sky" />
              <div className="lens-preview__image-ground" />
              <div className="lens-preview__image-edge lens-preview__image-edge--left" />
              <div className="lens-preview__image-edge lens-preview__image-edge--right" />
              <div className="lens-preview__image-far" />
              <div className="lens-preview__image-near" />
              <div className="lens-preview__image-bokeh lens-preview__image-bokeh--a" />
              <div className="lens-preview__image-bokeh lens-preview__image-bokeh--b" />
              <div className="lens-preview__image-flare" />
            </div>
            <div className="lens-preview__lens-highlight" />
          </div>
        ) : (
          <>
            <div className="lens-preview__sky" />
            <div className="lens-preview__backdrop lens-preview__backdrop--far" />
            <div className="lens-preview__backdrop lens-preview__backdrop--near" />
            <div className="lens-preview__horizon" />
            <div className="lens-preview__ground">
              <div className="lens-preview__rail lens-preview__rail--left" />
              <div className="lens-preview__rail lens-preview__rail--right" />
              <div className="lens-preview__range lens-preview__range--near" />
              <div className="lens-preview__range lens-preview__range--mid" />
              <div className="lens-preview__range lens-preview__range--far" />
            </div>
            <div className="lens-preview__focus-plane" />
            <div className="lens-preview__bokeh lens-preview__bokeh--a" />
            <div className="lens-preview__bokeh lens-preview__bokeh--b" />
            <div className="lens-preview__bokeh lens-preview__bokeh--c" />
            <div className="lens-preview__subject" />
            <div className="lens-preview__tilt-band lens-preview__tilt-band--top" />
            <div className="lens-preview__tilt-band lens-preview__tilt-band--bottom" />
            <div className="lens-preview__letterbox lens-preview__letterbox--top" />
            <div className="lens-preview__letterbox lens-preview__letterbox--bottom" />
            <div className="lens-preview__flare" />
          </>
        )}
      </div>
    </div>
  )
})
