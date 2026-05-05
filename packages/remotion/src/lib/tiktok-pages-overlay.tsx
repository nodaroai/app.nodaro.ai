import React, { useMemo } from "react"
import { useCurrentFrame, useVideoConfig, spring } from "remotion"
import { createTikTokStyleCaptions, type Caption } from "@remotion/captions"
import type { OverlayCommonProps } from "./subtitle-overlay"
import { POSITION_Y } from "./overlay-position"

export interface TikTokPagesOverlayProps extends OverlayCommonProps {
  combineTokensWithinMilliseconds?: number
}

/** TikTok-style 1-4 word pages via @remotion/captions::createTikTokStyleCaptions. */
export const TikTokPagesOverlay: React.FC<TikTokPagesOverlayProps> = ({
  captions, position, fontSize, color, backgroundColor,
  combineTokensWithinMilliseconds = 1200,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  const { pages } = useMemo(
    () => createTikTokStyleCaptions({ captions: captions as Caption[], combineTokensWithinMilliseconds }),
    [captions, combineTokensWithinMilliseconds],
  )
  const active = pages.find((p) => ms >= p.startMs && ms <= p.startMs + p.durationMs)
  if (!active) return null
  const enterScale = spring({ frame: frame - (active.startMs / 1000) * fps, fps, config: { damping: 12, stiffness: 200 } })
  return (
    <div style={{
      position: "absolute", left: "5%", right: "5%", top: POSITION_Y[position],
      transform: `translateY(-50%) scale(${0.9 + enterScale * 0.1})`,
      textAlign: "center", fontSize, color, fontWeight: 800, lineHeight: 1.1,
      whiteSpace: "pre",
      ...(backgroundColor ? { background: backgroundColor, padding: "0.3em 0.7em", borderRadius: "0.4em", display: "inline-block" } : {}),
    }}>
      {active.text}
    </div>
  )
}
