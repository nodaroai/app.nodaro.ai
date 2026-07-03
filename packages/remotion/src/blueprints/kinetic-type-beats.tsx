import React from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { BlueprintProps } from "./types"
import { directionStyle } from "../lib/text-direction"
import { readableTextColor } from "./color"
import { blueprintFontFamily, resolveBlueprintAccent } from "../lib/brand"

interface Params {
  lines: string[]
  accentColor?: string
  bgColor?: string
  invert?: boolean
}

/**
 * Returns the index of the currently-active line at `frame`.
 * Lines are distributed in equal segments across `durationFrames`.
 * Pure function — safe to unit-test without a render.
 */
export function lineIndexAtFrame(frame: number, durationFrames: number, count: number): number {
  if (count <= 0) return 0
  if (durationFrames <= 0) return count - 1
  const segment = durationFrames / count
  return Math.min(count - 1, Math.floor(frame / segment))
}

/**
 * Smooth 0.8→1.0 scale over the first 10 local frames (quadratic ease-out).
 * Clamped at both ends — no bounce, no overshoot.
 * `localFrame` is frames elapsed since this line first appeared.
 * Pure function — safe to unit-test without a render.
 */
export function popScale(localFrame: number): number {
  if (localFrame <= 0) return 0.8
  if (localFrame >= 10) return 1.0
  const t = localFrame / 10
  // Quadratic ease-out: 0.8 + 0.2 × (1 − (1−t)²)
  return 0.8 + 0.2 * (1 - (1 - t) * (1 - t))
}

export function KineticTypeBeats({ params, durationInFrames, brand }: BlueprintProps) {
  const { lines, accentColor, bgColor, invert = false } = params as unknown as Params
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  const count = Math.min(4, Math.max(1, lines.length))
  const clippedLines = lines.slice(0, 4)
  const segment = durationInFrames / count
  const currentIndex = lineIndexAtFrame(frame, durationInFrames, count)

  const bg = bgColor ?? brand.backgroundColor
  const canvasBg = invert ? "#ffffff" : bg
  const defaultTextColor = invert ? bg : "#ffffff"
  const fontFamily = blueprintFontFamily(brand)
  const accent = resolveBlueprintAccent(accentColor, brand, readableTextColor(brand.backgroundColor))

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        backgroundColor: canvasBg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: Math.round(height * 0.02),
      }}
    >
      {clippedLines.map((line, i) => {
        // Render only lines that have been revealed so far.
        if (i > currentIndex) return null

        const lineStart = Math.round(i * segment)
        const localFrame = frame - lineStart
        const scale = i === currentIndex ? popScale(localFrame) : 1

        // The final line gets the accent colour and a slightly larger pop size.
        const isLast = i === count - 1
        const color = isLast ? accent : defaultTextColor
        const fontSize = isLast
          ? Math.round(height * 0.115)
          : Math.round(height * 0.1)

        return (
          <div
            key={i}
            style={{
              fontFamily,
              fontSize,
              fontWeight: 700,
              color,
              letterSpacing: "-0.02em",
              whiteSpace: "nowrap",
              textAlign: "center",
              transform: `scale(${scale})`,
              transformOrigin: "center center",
              ...directionStyle(line),
            }}
          >
            {line}
          </div>
        )
      })}
    </div>
  )
}
