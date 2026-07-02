import React from "react"
import { useCurrentFrame, useVideoConfig, spring } from "remotion"
import type { OverlayCommonProps } from "./subtitle-overlay"
import { POSITION_Y } from "./overlay-position"
import { directionStyle, rowDirectionFromCaptions } from "./text-direction"

/** Sentence visible; each word springs vertically when it becomes active. */
export const BouncyOverlay: React.FC<OverlayCommonProps> = ({
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
      fontSize, color, fontWeight: 700, lineHeight: 1.2,
      ...(backgroundColor ? { background: backgroundColor, padding: "0.3em 0.6em", borderRadius: "0.4em", display: "inline-block" } : {}),
      // Joined full-line text drives the row's base direction so word order
      // follows the language, reordering sibling word <span>s visually
      // without touching DOM/timing order — see the logoRowDirection
      // pattern in blueprints/logo-assemble-lockup.tsx. Structurally this
      // overlay lays sibling word <span>s out the same way karaoke/
      // word-highlight do.
      direction: rowDirectionFromCaptions(captions),
    }}>
      {captions.map((c, i) => {
        const localFrame = frame - (c.startMs / 1000) * fps
        const bounce = localFrame >= 0 && localFrame < fps
          ? spring({ frame: localFrame, fps, config: { damping: 6, stiffness: 200 } })
          : 1
        const dy = (1 - bounce) * -20
        return (
          <span key={i} style={{
            display: "inline-block",
            transform: `translateY(${dy}px)`,
            ...directionStyle(c.text),
          }}>
            {c.text}
          </span>
        )
      })}
    </div>
  )
}
