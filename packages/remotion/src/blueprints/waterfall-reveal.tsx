import React from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { BlueprintProps } from "./types"
import { directionStyle, detectBaseDirection } from "../lib/text-direction"
import { easeOutQuad } from "./motion"
import { readableTextColor } from "./color"
import { resolveBlueprintAccent, resolveHeadingType, resolveBodyType } from "../lib/brand"

interface Params {
  text: string
  sublabel?: string
  accentColor?: string
}

/** Per-word stagger constants — a horizontal cascade (HF waterfall cut, X-axis). */
const WATERFALL_WORD_BEAT = 4 // frames between successive word starts
const WATERFALL_WORD_SLIDE = 6 // frames each word takes to slide+fade in
const WATERFALL_SLIDE_PX = 24 // starting X offset per word

/**
 * Local 0→1 progress of word `wordIndex` at reveal-relative `frame`.
 * Word i starts at i * WATERFALL_WORD_BEAT and completes WATERFALL_WORD_SLIDE frames later.
 * Pure — safe to unit-test without a render.
 */
export function waterfallWordProgress(frame: number, wordIndex: number): number {
  const start = wordIndex * WATERFALL_WORD_BEAT
  const t = (frame - start) / WATERFALL_WORD_SLIDE
  return Math.max(0, Math.min(1, t))
}

/**
 * Split a line into the visible words to cascade, collapsing whitespace runs and
 * dropping empties. Empty / whitespace-only input yields `[]` — the blueprint then
 * renders no words (a valid degenerate cascade). Pure — safe to unit-test.
 */
export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

export function WaterfallReveal({ params, brand }: BlueprintProps) {
  const { text, sublabel, accentColor } = params as unknown as Params
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  const primaryColor = readableTextColor(brand.backgroundColor)
  const emphasisColor = resolveBlueprintAccent(accentColor, brand, primaryColor)
  const mainType = resolveHeadingType(brand, text, { weight: 700 })
  const sublabelType = resolveBodyType(brand, sublabel ?? "", { weight: 300 })

  const words = splitWords(text)
  const lineDirection = detectBaseDirection(text)

  const mainFontSize = Math.round(height * 0.09)
  const sublabelFontSize = Math.round(height * 0.042)

  // Sublabel fades up after the last word has finished sliding in.
  const lastWordEnd = (words.length - 1) * WATERFALL_WORD_BEAT + WATERFALL_WORD_SLIDE
  const sublabelProgress = easeOutQuad(
    Math.max(0, Math.min(1, (frame - lastWordEnd) / 12)),
  )

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
          direction: lineDirection,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: `0 ${Math.round(mainFontSize * 0.3)}px`,
          ...mainType,
          fontSize: mainFontSize,
          color: primaryColor,
          maxWidth: width * 0.85,
        }}
      >
        {words.map((word, i) => {
          const p = easeOutQuad(waterfallWordProgress(frame, i))
          return (
            <span
              key={i}
              style={{
                // Direction is inherited from the row container (set once from
                // `lineDirection`); a single word needs no per-word re-detection.
                opacity: p,
                transform: `translateX(${(1 - p) * WATERFALL_SLIDE_PX}px)`,
                display: "inline-block",
              }}
            >
              {word}
            </span>
          )
        })}
      </div>

      {sublabel != null && (
        <div
          style={{
            ...directionStyle(sublabel),
            ...sublabelType,
            fontSize: sublabelFontSize,
            color: emphasisColor,
            marginTop: Math.round(height * 0.03),
            opacity: sublabelProgress,
            transform: `translateY(${(1 - sublabelProgress) * 16}px)`,
            whiteSpace: "nowrap",
          }}
        >
          {sublabel}
        </div>
      )}
    </div>
  )
}
