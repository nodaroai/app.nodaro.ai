import React from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { Caption } from "@remotion/captions"
import { POSITION_Y, type OverlayPosition } from "./overlay-position"

export interface OverlayCommonProps {
  captions: readonly Caption[]
  position: OverlayPosition
  fontSize: number
  color: string
  backgroundColor?: string
}

/** Sentence-level subtitle: shows one Caption at a time, centered. */
export const SubtitleOverlay: React.FC<OverlayCommonProps> = ({
  captions, position, fontSize, color, backgroundColor,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  const active = captions.find((c) => ms >= c.startMs && ms <= c.endMs)
  if (!active) return null
  return (
    <div style={{
      position: "absolute", left: "5%", right: "5%", top: POSITION_Y[position],
      transform: "translateY(-50%)", textAlign: "center",
      fontSize, color, fontWeight: 700, lineHeight: 1.2,
      textShadow: "0 2px 4px rgba(0,0,0,0.6)",
      ...(backgroundColor ? { background: backgroundColor, padding: "0.3em 0.6em", borderRadius: "0.4em", display: "inline-block" } : {}),
    }}>
      {active.text}
    </div>
  )
}
