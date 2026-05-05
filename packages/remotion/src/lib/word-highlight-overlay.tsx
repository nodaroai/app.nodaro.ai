import React from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { Caption } from "@remotion/captions"
import type { OverlayCommonProps } from "./subtitle-overlay"
import { POSITION_Y } from "./overlay-position"

/** Renders a window of N adjacent words; the active one is colored/scaled up. */
export const WordHighlightOverlay: React.FC<OverlayCommonProps> = ({
  captions, position, fontSize, color, backgroundColor,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  const activeIdx = captions.findIndex((c) => ms >= c.startMs && ms <= c.endMs)
  if (activeIdx < 0) return null
  const window = captions.slice(Math.max(0, activeIdx - 2), Math.min(captions.length, activeIdx + 3))
  return (
    <div style={{
      position: "absolute", left: "5%", right: "5%", top: POSITION_Y[position],
      transform: "translateY(-50%)", textAlign: "center",
      fontSize, color: "#aaa", fontWeight: 700, lineHeight: 1.2,
    }}>
      {window.map((c, i) => {
        const isActive = c === captions[activeIdx]
        return (
          <span key={i} style={{
            color: isActive ? color : "#aaa",
            transform: isActive ? "scale(1.15)" : "scale(1)",
            display: "inline-block",
            ...(isActive && backgroundColor ? { background: backgroundColor, padding: "0.05em 0.2em", borderRadius: "0.3em" } : {}),
          }}>
            {c.text}
          </span>
        )
      })}
    </div>
  )
}
