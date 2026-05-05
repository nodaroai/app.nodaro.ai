import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion"
import type { OverlayCommonProps } from "./subtitle-overlay"
import { POSITION_Y } from "./overlay-position"

/** Sentence visible; each word fills with `color` over its [startMs, endMs] window. */
export const KaraokeOverlay: React.FC<OverlayCommonProps> = ({
  captions, position, fontSize, color, backgroundColor,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  if (captions.length === 0) return null
  const startMs = captions[0]!.startMs
  const endMs = captions[captions.length - 1]!.endMs
  if (ms < startMs || ms > endMs) return null
  return (
    <div style={{
      position: "absolute", left: "5%", right: "5%", top: POSITION_Y[position],
      transform: "translateY(-50%)", textAlign: "center",
      fontSize, color: "#777", fontWeight: 700, lineHeight: 1.2,
      ...(backgroundColor ? { background: backgroundColor, padding: "0.3em 0.6em", borderRadius: "0.4em", display: "inline-block" } : {}),
    }}>
      {captions.map((c, i) => {
        const t = interpolate(ms, [c.startMs, c.endMs], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
        return (
          <span key={i} style={{
            background: `linear-gradient(90deg, ${color} ${t * 100}%, #777 ${t * 100}%)`,
            WebkitBackgroundClip: "text", backgroundClip: "text",
            WebkitTextFillColor: "transparent", color: "transparent",
          }}>
            {c.text}
          </span>
        )
      })}
    </div>
  )
}
