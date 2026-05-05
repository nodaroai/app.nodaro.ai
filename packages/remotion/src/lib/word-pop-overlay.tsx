import React from "react"
import { useCurrentFrame, useVideoConfig, spring } from "remotion"
import type { OverlayCommonProps } from "./subtitle-overlay"
import { POSITION_Y } from "./overlay-position"

/** Render exactly one word at a time, springing in then out. */
export const WordPopOverlay: React.FC<OverlayCommonProps> = ({
  captions, position, fontSize, color, backgroundColor,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  const active = captions.find((c) => ms >= c.startMs && ms <= c.endMs)
  if (!active) return null
  const localFrame = frame - (active.startMs / 1000) * fps
  const enter = spring({ frame: localFrame, fps, config: { damping: 8, stiffness: 250 } })
  return (
    <div style={{
      position: "absolute", left: "5%", right: "5%", top: POSITION_Y[position],
      transform: `translateY(-50%) scale(${enter})`,
      textAlign: "center", fontSize: fontSize * 1.4,
      color, fontWeight: 900, lineHeight: 1, letterSpacing: "0.02em",
      textShadow: "0 4px 8px rgba(0,0,0,0.4)",
      ...(backgroundColor ? { background: backgroundColor, padding: "0.2em 0.5em", borderRadius: "0.4em", display: "inline-block" } : {}),
    }}>
      {active.text.trim()}
    </div>
  )
}
