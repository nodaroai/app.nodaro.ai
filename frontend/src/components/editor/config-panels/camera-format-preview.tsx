"use client"

import { memo } from "react"
import { cn } from "@/lib/utils"
import "./camera-format.css"

interface CameraFormatPreviewProps {
  readonly cameraFormatId: string
  readonly className?: string
}

/**
 * Static preview for a single camera/film-stock choice. The base scene stays
 * simple while format-specific layers communicate capture medium: gate/perfs,
 * grain, aspect crop, tape scanlines, instant-film border, phone frame, etc.
 */
export const CameraFormatPreview = memo(function CameraFormatPreview({
  cameraFormatId,
  className,
}: CameraFormatPreviewProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "camera-format-preview",
        `camera-format-preview--${cameraFormatId}`,
        className,
      )}
    >
      <div className="camera-format-preview__frame">
        <div className="camera-format-preview__image">
          <div className="camera-format-preview__sky" />
          <div className="camera-format-preview__ground" />
          <div className="camera-format-preview__horizon" />
          <div className="camera-format-preview__distant-block camera-format-preview__distant-block--left" />
          <div className="camera-format-preview__distant-block camera-format-preview__distant-block--right" />
          <div className="camera-format-preview__subject" />
        </div>
        <div className="camera-format-preview__gate camera-format-preview__gate--left" />
        <div className="camera-format-preview__gate camera-format-preview__gate--right" />
        <div className="camera-format-preview__letterbox camera-format-preview__letterbox--top" />
        <div className="camera-format-preview__letterbox camera-format-preview__letterbox--bottom" />
        <div className="camera-format-preview__phone-frame" />
        <div className="camera-format-preview__timestamp" />
        <div className="camera-format-preview__scan" />
        <div className="camera-format-preview__grain" />
        <div className="camera-format-preview__damage" />
      </div>
    </div>
  )
})
