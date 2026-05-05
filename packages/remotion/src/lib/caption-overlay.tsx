import React from "react"
import type { Caption } from "@remotion/captions"
import type { KineticCaptionStyle, CaptionStyle as SharedCaptionStyle } from "@nodaro/shared"
import { SubtitleOverlay } from "./subtitle-overlay"
import { WordHighlightOverlay } from "./word-highlight-overlay"
import { KaraokeOverlay } from "./karaoke-overlay"
import { TikTokPagesOverlay } from "./tiktok-pages-overlay"
import { WordPopOverlay } from "./word-pop-overlay"
import { BouncyOverlay } from "./bouncy-overlay"

// Re-export for backward compat with consumers that imported these names
// from this module (e.g. captions-style-preview, overlay-primitives test).
export type KineticStyle = KineticCaptionStyle
export type CaptionStyle = SharedCaptionStyle

export interface CaptionOverlayProps {
  captions: readonly Caption[]
  style: CaptionStyle
  position: "top" | "center" | "bottom"
  fontSize: number
  color: string
  backgroundColor?: string
}

export const CaptionOverlay: React.FC<CaptionOverlayProps> = ({ style, ...rest }) => {
  switch (style) {
    case "subtitle":      return <SubtitleOverlay      {...rest} />
    case "word-highlight": return <WordHighlightOverlay {...rest} />
    case "karaoke":        return <KaraokeOverlay        {...rest} />
    case "tiktok-words":   return <TikTokPagesOverlay    {...rest} />
    case "word-pop":       return <WordPopOverlay        {...rest} />
    case "bouncy":         return <BouncyOverlay         {...rest} />
  }
}
