import React from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { BlueprintProps } from "./types"
import { FONT_MAP } from "../lib/font-registry"
import { readableTextColor } from "./color"

interface Params {
  title: string
  subtitle?: string
  motion?: "slide-up" | "crossfade" | "wipe"
}

/** Entrance plays over at most this many frames. */
const ENTRANCE_FRAMES = 12

/**
 * Returns a 0→1 progress value for the titlecard entrance animation.
 * Rises from 0 to 1 over `min(ENTRANCE_FRAMES, durationFrames)` frames
 * using a smooth quadratic ease-out, then holds at 1.
 * Pure function of its arguments — safe to unit-test without a render.
 */
export function titlecardEntranceProgress(frame: number, durationFrames: number): number {
  const entranceEnd = Math.min(ENTRANCE_FRAMES, durationFrames)
  if (frame <= 0) return 0
  if (frame >= entranceEnd) return 1
  const t = frame / entranceEnd
  // Quadratic ease-out: fast start, smooth deceleration, no bounce.
  return 1 - (1 - t) * (1 - t)
}

export function TitlecardReveal({ params, durationInFrames, brand }: BlueprintProps) {
  const { title, subtitle, motion = "slide-up" } = params as unknown as Params
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  const progress = titlecardEntranceProgress(frame, durationInFrames)
  const fontFamily = FONT_MAP["Montserrat"] ?? "Montserrat"

  // Derive entrance-driven style per motion variant.
  // "wipe" keeps full opacity (clip reveals it); the others fade in.
  let entranceStyle: React.CSSProperties
  switch (motion) {
    case "crossfade":
      entranceStyle = { opacity: progress }
      break
    case "wipe":
      // Reveal left-to-right; no opacity change.
      entranceStyle = { clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)` }
      break
    case "slide-up":
    default:
      entranceStyle = {
        transform: `translateY(${(1 - progress) * 40}px)`,
        opacity: progress,
      }
  }

  const titleFontSize = Math.round(height * 0.1)
  const subtitleFontSize = Math.round(height * 0.045)
  const subtitleMargin = Math.round(height * 0.025)

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        backgroundColor: brand.backgroundColor,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          fontFamily,
          fontSize: titleFontSize,
          fontWeight: 700,
          color: readableTextColor(brand.backgroundColor),
          letterSpacing: "-0.02em",
          whiteSpace: "nowrap",
          textAlign: "center",
          ...entranceStyle,
        }}
      >
        {title}
      </div>

      {subtitle != null && (
        <div
          style={{
            fontFamily,
            fontSize: subtitleFontSize,
            fontWeight: 300,
            color: readableTextColor(brand.backgroundColor),
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
            textAlign: "center",
            marginTop: subtitleMargin,
            ...entranceStyle,
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  )
}
