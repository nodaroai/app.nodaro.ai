import React from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { BlueprintProps } from "./types"
import { FONT_MAP } from "../lib/font-registry"
import { readableTextColor } from "./color"

interface Params {
  text: string
  sublabel?: string
  accentColor?: string
}

/**
 * The typing window occupies the first 70% of the reveal duration.
 * After that the text holds fully typed.
 */
const TYPING_FRACTION = 0.7

/**
 * Returns the number of characters of `text` that should be visible at
 * `frame` within a reveal window of `durationFrames`.
 *
 * Typing happens over the first ~70% of the window (TYPING_FRACTION × durationFrames).
 * After that the full count is held. Always clamped to [0, totalChars].
 * Pure function — safe to unit-test without a render.
 */
export function typedCharCount(
  frame: number,
  durationFrames: number,
  totalChars: number,
): number {
  if (totalChars <= 0) return 0
  const typingEnd = Math.max(1, Math.round(durationFrames * TYPING_FRACTION))
  if (frame <= 0) return 0
  if (frame >= typingEnd) return totalChars
  // Linear progress over the typing window — each character lands on an even beat.
  const t = frame / typingEnd
  return Math.min(totalChars, Math.ceil(t * totalChars))
}

export function TypewriterReveal({ params, durationInFrames, brand }: BlueprintProps) {
  const { text, sublabel, accentColor } = params as unknown as Params
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  const fontFamily = FONT_MAP["Montserrat"] ?? "Montserrat"
  const primaryColor = readableTextColor(brand.backgroundColor)
  const emphasisColor = accentColor ?? primaryColor

  const chars = typedCharCount(frame, durationInFrames, text.length)
  const visible = text.slice(0, chars)

  // The caret blinks at ~2 Hz (every 15 frames at 30 fps) while typing.
  // It disappears once typing is done and the sublabel is shown.
  const typingEnd = Math.max(1, Math.round(durationInFrames * TYPING_FRACTION))
  const isTyping = frame < typingEnd
  const caretVisible = isTyping && Math.floor(frame / 8) % 2 === 0

  // Sublabel fades in after typing finishes (quadratic ease-out, 12-frame window).
  const sublabelStartFrame = typingEnd
  const sublabelEntranceEnd = sublabelStartFrame + 12
  const sublabelT = Math.max(
    0,
    Math.min(1, (frame - sublabelStartFrame) / Math.max(1, sublabelEntranceEnd - sublabelStartFrame)),
  )
  // Quadratic ease-out
  const sublabelProgress = 1 - (1 - sublabelT) * (1 - sublabelT)

  const mainFontSize = Math.round(height * 0.1)
  const sublabelFontSize = Math.round(height * 0.045)
  const sublabelMargin = Math.round(height * 0.03)

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
      {/* Main text + blinking caret in one inline block */}
      <div
        style={{
          fontFamily,
          fontSize: mainFontSize,
          fontWeight: 700,
          color: primaryColor,
          letterSpacing: "-0.02em",
          whiteSpace: "nowrap",
          textAlign: "center",
        }}
      >
        {visible}
        {/* Caret rendered as a coloured pipe character */}
        <span
          style={{
            color: emphasisColor,
            opacity: caretVisible ? 1 : 0,
            marginLeft: 2,
          }}
        >
          |
        </span>
      </div>

      {/* Optional sublabel — fades up after typing finishes */}
      {sublabel != null && (
        <div
          style={{
            fontFamily,
            fontSize: sublabelFontSize,
            fontWeight: 300,
            color: emphasisColor,
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
            textAlign: "center",
            marginTop: sublabelMargin,
            opacity: sublabelProgress,
            transform: `translateY(${(1 - sublabelProgress) * 16}px)`,
          }}
        >
          {sublabel}
        </div>
      )}
    </div>
  )
}
