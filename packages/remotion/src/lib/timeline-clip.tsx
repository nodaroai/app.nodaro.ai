import React from "react"
import { OffthreadVideo } from "remotion"

export interface TimelineClipProps {
  src: string
  /** Optional — Remotion infers from media if omitted */
  durationInFrames?: number
  muted?: boolean
}

/**
 * Single base layer media wrapper. Mirrors the convention used by AE / MG /
 * 3D-title renderers: <OffthreadVideo> at 100%×100% with object-fit cover.
 *
 * IMPORTANT: muted defaults to false so the input video's audio is preserved.
 * Free-tier silent renders happen if the default is undefined under some
 * Remotion versions.
 */
export const TimelineClip: React.FC<TimelineClipProps> = ({ src, muted = false }) => {
  return (
    <OffthreadVideo
      src={src}
      muted={muted}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  )
}
