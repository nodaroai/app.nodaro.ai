import React from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { BlueprintProps } from "./types"
import { FONT_MAP } from "../lib/font-registry"

interface Params {
  items: { label: string }[]
  columns?: number
  accentColor?: string
}

/** Frames between each card's entrance start. */
const STAGGER_FRAMES = 6
/** Frames each card takes to complete its entrance. */
const ENTRANCE_FRAMES = 12

/**
 * Returns 0→1 entrance progress for the card at `index`.
 * The card begins entering at `index * STAGGER_FRAMES` and reaches 1 after
 * `ENTRANCE_FRAMES` local frames (quadratic ease-out), then holds at 1.
 * `_durationFrames` is accepted for API consistency with other progress helpers.
 * Minimum viable clip length: the last card finishes entering by frame
 * `(items-1)*STAGGER_FRAMES + ENTRANCE_FRAMES` ≈ `5*6 + 12 = 42` for 6 items,
 * so clips ≥ ~60 frames are safe.
 * Pure function — safe to unit-test without a render.
 */
export function cardEntranceProgress(
  frame: number,
  index: number,
  _durationFrames: number,
): number {
  const cardStart = index * STAGGER_FRAMES
  const localFrame = frame - cardStart
  if (localFrame <= 0) return 0
  if (localFrame >= ENTRANCE_FRAMES) return 1
  const t = localFrame / ENTRANCE_FRAMES
  // Quadratic ease-out: fast start, smooth deceleration, no bounce.
  return 1 - (1 - t) * (1 - t)
}

export function GridCardAssemble({ params, durationInFrames, brand }: BlueprintProps) {
  const { items, columns: colsOverride, accentColor = "#f5f5f7" } =
    params as unknown as Params
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  const fontFamily = FONT_MAP["Montserrat"] ?? "Montserrat"

  const clipped = items.slice(0, 6)
  const count = Math.max(1, clipped.length)

  // Auto-columns: smallest square that fits count, clamped to 2–3 per row.
  const columns = colsOverride ?? Math.min(3, Math.ceil(Math.sqrt(count)))
  const rows = Math.ceil(count / columns)

  const cardW = Math.round(width * 0.27)
  const cardH = Math.round(height * 0.21)
  const gapH = Math.round(width * 0.03)
  const gapV = Math.round(height * 0.04)

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
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, ${cardW}px)`,
          gridTemplateRows: `repeat(${rows}, ${cardH}px)`,
          columnGap: gapH,
          rowGap: gapV,
        }}
      >
        {clipped.map((item, i) => {
          // Entrance timing is fully encapsulated inside cardEntranceProgress.
          const progress = cardEntranceProgress(frame, i, durationInFrames)

          return (
            <div
              key={i}
              style={{
                width: cardW,
                height: cardH,
                borderRadius: Math.round(Math.min(cardW, cardH) * 0.1),
                border: `2px solid ${accentColor}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: progress,
                transform: `translateY(${(1 - progress) * 20}px) scale(${0.85 + 0.15 * progress})`,
              }}
            >
              <div
                style={{
                  fontFamily,
                  fontSize: Math.round(cardH * 0.2),
                  fontWeight: 700,
                  color: accentColor,
                  textAlign: "center",
                  padding: `0 ${Math.round(cardW * 0.08)}px`,
                  letterSpacing: "-0.01em",
                  lineHeight: 1.3,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {item.label}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
