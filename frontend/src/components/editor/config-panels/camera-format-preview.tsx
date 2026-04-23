"use client"

import { memo } from "react"
import { cn } from "@/lib/utils"
import "./camera-format.css"

interface CameraFormatPreviewProps {
  readonly cameraFormatId: string
  readonly className?: string
}

/**
 * Static preview for a single camera/film-stock choice. Renders a frame +
 * subject styled to communicate the capture-medium character (grain, color
 * cast, distortion, scanlines, letterbox, etc.). Mostly static — VHS and
 * security-cam get a subtle animated scanline.
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
        <div className="camera-format-preview__subject" />
      </div>
    </div>
  )
})
