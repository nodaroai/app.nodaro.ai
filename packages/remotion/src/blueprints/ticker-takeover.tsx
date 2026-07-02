import React from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { BlueprintProps } from "./types"
import { FONT_MAP, withRtlFallback } from "../lib/font-registry"
import { directionStyle } from "../lib/text-direction"
import { readableTextColor } from "./color"
import { caretBlinkVisible, caretMarginStyle, typedCharCount, TYPING_FRACTION } from "./typewriter-reveal"
import { easeOutQuad } from "./motion"

interface Params {
  leadIn: string
  options: string[]
  hero: string
  accentColor?: string
}

/** The lead-in phrase types over the first quarter of the window. */
export const TYPE_FRACTION = 0.25
/** The accent word cycles options until this fraction. */
export const CYCLE_END_FRACTION = 0.55
/** The hero has landed and holds alone from this fraction on. */
export const HOLD_FRACTION = 0.75
/** Within the collision window, contact (hero strikes the text) happens at this fraction. */
const CONTACT_FRACTION = 0.35
/** Where the hero pauses at the moment of contact (unit multiples of width). */
const CONTACT_X = 0.12
/** How far off-screen left the struck text group is ejected. */
const EJECT_X = -1.5

export type TakeoverPhase = "type" | "cycle" | "collision" | "hold"

/**
 * Timeline state for the ticker-takeover shot at `frame` within a window of
 * `durationInFrames`, for `optionCount` cycling options.
 *
 * - `typedFraction`: 0→1 progress of the lead-in typing (done by TYPE_FRACTION).
 * - `optionIndex`: which option the accent slot shows (visits each once, in order).
 * - `heroX`: hero centre offset in unit multiples of width — starts ≥1 (off-screen
 *   right), crashes fast to CONTACT_X, then settles heavy to 0. Monotonic.
 * - `textGroupX`: the lead-in group's offset — 0 until contact, then shoved
 *   strictly left toward EJECT_X (displacement, never a fade).
 * Pure function — safe to unit-test without a render.
 */
export function takeoverPositions(
  frame: number,
  durationInFrames: number,
  optionCount: number,
): { typedFraction: number; optionIndex: number; heroX: number; textGroupX: number; phase: TakeoverPhase } {
  const typeEnd = durationInFrames * TYPE_FRACTION
  const cycleEnd = durationInFrames * CYCLE_END_FRACTION
  const holdStart = durationInFrames * HOLD_FRACTION

  const phase: TakeoverPhase =
    frame < typeEnd ? "type" : frame < cycleEnd ? "cycle" : frame < holdStart ? "collision" : "hold"

  const typedFraction = Math.max(0, Math.min(1, frame / Math.max(1, typeEnd)))

  // The ticker steps through each option once across the cycle window.
  let optionIndex = 0
  if (frame >= typeEnd) {
    const cycleT = Math.min(1, (frame - typeEnd) / Math.max(1, cycleEnd - typeEnd))
    optionIndex = Math.min(optionCount - 1, Math.floor(cycleT * optionCount))
  }

  // Hero trajectory: off-screen right → fast crash to CONTACT_X → heavy settle to 0.
  const collisionWindow = Math.max(1, holdStart - cycleEnd)
  const contactFrame = cycleEnd + collisionWindow * CONTACT_FRACTION
  let heroX: number
  if (frame < cycleEnd) {
    heroX = 1.1
  } else if (frame < contactFrame) {
    // Incoming with momentum: quadratic ease-in reads as acceleration into frame.
    const t = (frame - cycleEnd) / Math.max(1, contactFrame - cycleEnd)
    heroX = 1.1 - (1.1 - CONTACT_X) * (t * t)
  } else if (frame < holdStart) {
    // Heavy landing: long quadratic decay from contact to rest — mass, not zip.
    const t = (frame - contactFrame) / Math.max(1, holdStart - contactFrame)
    heroX = CONTACT_X * (1 - t) * (1 - t)
  } else {
    heroX = 0
  }

  // The struck text group: pinned at 0 until contact, then ejected left with an
  // impulse (fast immediately, decelerating) — displacement, never opacity.
  let textGroupX = 0
  if (frame >= contactFrame) {
    const t = Math.min(1, (frame - contactFrame) / Math.max(1, holdStart - contactFrame))
    textGroupX = EJECT_X * easeOutQuad(t)
  }

  return { typedFraction, optionIndex, heroX, textGroupX, phase }
}

export function TickerTakeover({ params, durationInFrames, brand }: BlueprintProps) {
  const { leadIn, options, hero, accentColor } = params as unknown as Params
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  const fontFamily = withRtlFallback(FONT_MAP["Montserrat"] ?? "Montserrat")
  const primaryColor = readableTextColor(brand.backgroundColor)
  const emphasisColor = accentColor ?? primaryColor

  const { optionIndex, heroX, textGroupX, phase } = takeoverPositions(
    frame,
    durationInFrames,
    options.length,
  )

  // Lead-in types over the type window (reuses the typewriter timing curve,
  // scaled so its TYPING_FRACTION-sized window lands exactly on TYPE_FRACTION).
  const typeWindowFrames = Math.max(1, Math.round((durationInFrames * TYPE_FRACTION) / TYPING_FRACTION))
  const chars = typedCharCount(frame, typeWindowFrames, leadIn.length)
  const visibleLeadIn = leadIn.slice(0, chars)

  // Option slot rolls vertically: each step slides the stack up one line.
  const lineFontSize = Math.round(height * 0.07)
  const heroFontSize = Math.round(height * 0.14)
  const lineHeight = Math.round(lineFontSize * 1.3)

  // Resting-hero aliveness: low-amplitude deterministic jitter composed onto the
  // landed scale (never a yoyo around the entrance value).
  const heroJitterScale = phase === "hold" ? 1 + 0.006 * Math.sin(frame * 0.21) : 1
  const heroJitterRot = phase === "hold" ? 0.25 * Math.sin(frame * 0.13) : 0

  const caretVisible = phase === "type" && caretBlinkVisible(frame)
  const leadInDir = directionStyle(leadIn)

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        backgroundColor: brand.backgroundColor,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Lead-in + cycling accent word — one group, shoved as one mass on impact */}
      <div
        style={{
          position: "absolute",
          display: "flex",
          alignItems: "baseline",
          gap: Math.round(width * 0.012),
          transform: `translateX(${textGroupX * width}px)`,
          fontFamily,
          fontSize: lineFontSize,
          fontWeight: 600,
          color: primaryColor,
          whiteSpace: "nowrap",
          ...leadInDir,
        }}
      >
        <span>
          {visibleLeadIn}
          <span
            style={{
              color: emphasisColor,
              opacity: caretVisible ? 1 : 0,
              ...caretMarginStyle(),
            }}
          >
            |
          </span>
        </span>
        {/* Vertical ticker slot — visible only once typing is done */}
        {phase !== "type" && (
          <span
            style={{
              display: "inline-block",
              height: lineHeight,
              lineHeight: `${lineHeight}px`,
              overflow: "hidden",
              verticalAlign: "bottom",
            }}
          >
            <span
              style={{
                display: "inline-block",
                transform: `translateY(${-optionIndex * lineHeight}px)`,
                transition: "none",
              }}
            >
              {options.map((opt, i) => (
                <span
                  key={i}
                  style={{
                    display: "block",
                    height: lineHeight,
                    lineHeight: `${lineHeight}px`,
                    color: emphasisColor,
                    fontWeight: 700,
                    ...directionStyle(opt),
                  }}
                >
                  {opt}
                </span>
              ))}
            </span>
          </span>
        )}
      </div>

      {/* The hero — crashes in from the right, lands heavy, holds alone */}
      {heroX < 1.05 && (
        <div
          style={{
            position: "absolute",
            transform: `translateX(${heroX * width}px) scale(${heroJitterScale}) rotate(${heroJitterRot}deg)`,
            fontFamily,
            fontSize: heroFontSize,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            color: emphasisColor,
            whiteSpace: "nowrap",
            ...directionStyle(hero),
          }}
        >
          {hero}
        </div>
      )}
    </div>
  )
}
