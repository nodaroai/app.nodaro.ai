import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion"
import type { BlueprintProps } from "./types"
import { directionStyle, detectBaseDirection, type TextDirection } from "../lib/text-direction"
import { resolveBlueprintAccent, resolveHeadingType, resolveBodyType } from "../lib/brand"

interface Params {
  brand: string
  tagline?: string
  accentColor?: string
}

/** Frames each letter takes to complete its entrance. */
const LETTER_ENTRANCE_FRAMES = 12
/** Fraction of total duration that the letter stagger occupies. */
const STAGGER_WINDOW_FRACTION = 0.5

/**
 * Returns 0→1 entrance progress for the letter at `index` out of `count`.
 *
 * The stagger window spans the first `STAGGER_WINDOW_FRACTION` of
 * `durationFrames`. Letters are spaced evenly across this window; each letter
 * then plays its entrance over `LETTER_ENTRANCE_FRAMES` (quadratic ease-out).
 * Pure function — safe to unit-test without a render.
 */
export function letterEntranceProgress(
  frame: number,
  index: number,
  count: number,
  durationFrames: number,
): number {
  const staggerWindow = Math.round(durationFrames * STAGGER_WINDOW_FRACTION)
  // For a single letter the stagger offset is 0 (no other letter to space against).
  const staggerPerLetter = count > 1 ? Math.floor(staggerWindow / (count - 1)) : 0
  const letterStart = index * staggerPerLetter
  const localFrame = frame - letterStart
  if (localFrame <= 0) return 0
  if (localFrame >= LETTER_ENTRANCE_FRAMES) return 1
  const t = localFrame / LETTER_ENTRANCE_FRAMES
  // Quadratic ease-out: fast start, smooth deceleration, no bounce.
  return 1 - (1 - t) * (1 - t)
}

/**
 * CSS `direction` for the brand-name row container.
 *
 * Letters are DOM-ordered in logical (reading) order and each animates via
 * per-letter opacity/translateY only (no x-offset) — the stagger is purely
 * index-based, not position-based. That means flipping the row container's
 * CSS `direction` to "rtl" is sufficient to re-flow an RTL brand name into
 * correct right-to-left visual order (index 0 lands rightmost and still
 * enters first, matching the LTR "first letter enters first" feel) without
 * touching the entrance animation at all. Pure function — safe to
 * unit-test without a render.
 */
export function logoRowDirection(brandText: string): TextDirection {
  return detectBaseDirection(brandText)
}

export function LogoAssembleLockup({ params, durationInFrames, brand }: BlueprintProps) {
  // Note: `brand` from Params (string) is destructured as `brandText` to avoid
  // shadowing `brand` from BlueprintProps (object).
  const {
    brand: brandText,
    tagline,
    accentColor,
  } = params as unknown as Params

  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  const accent = resolveBlueprintAccent(accentColor, brand, "#f5f5f7")
  const letters = brandText.split("")
  const count = letters.length
  const letterType = resolveHeadingType(brand, brandText, { weight: 900, tracking: "0.04em" })
  const taglineType = resolveBodyType(brand, tagline ?? "", {
    weight: 300,
    tracking: "0.12em",
    casing: "uppercase",
  })

  // When does the last letter finish entering?
  const staggerWindow = Math.round(durationInFrames * STAGGER_WINDOW_FRACTION)
  const staggerPerLetter = count > 1 ? Math.floor(staggerWindow / (count - 1)) : 0
  const lastLetterEnd = (count - 1) * staggerPerLetter + LETTER_ENTRANCE_FRAMES

  // Tagline fades in smoothly after all letters have settled (8-frame gap).
  const taglineStart = lastLetterEnd + 8
  const taglineEnd = taglineStart + 18
  const taglineOpacity = interpolate(frame, [taglineStart, taglineEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.ease),
  })

  const letterFontSize = Math.round(height * 0.18)
  const taglineFontSize = Math.round(height * 0.045)

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
      {/* Brand name — per-letter staggered entrance */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "baseline",
          // Flips visual letter order for RTL brand names — see logoRowDirection.
          direction: logoRowDirection(brandText),
        }}
      >
        {letters.map((letter, i) => {
          // Use the SAME formula as letterEntranceProgress (Lesson 1).
          const progress = letterEntranceProgress(frame, i, count, durationInFrames)
          return (
            <span
              key={i}
              style={{
                ...letterType,
                fontSize: letterFontSize,
                color: accent,
                display: "inline-block",
                opacity: progress,
                transform: `translateY(${(1 - progress) * 28}px)`,
                whiteSpace: "pre", // preserve space characters
              }}
            >
              {letter}
            </span>
          )
        })}
      </div>

      {/* Optional tagline — fades up after letters settle */}
      {tagline != null && (
        <div
          style={{
            ...taglineType,
            fontSize: taglineFontSize,
            color: accent,
            marginTop: Math.round(height * 0.025),
            opacity: taglineOpacity * 0.7,
            transform: `translateY(${(1 - taglineOpacity) * 10}px)`,
            whiteSpace: "nowrap",
            ...directionStyle(tagline),
          }}
        >
          {tagline}
        </div>
      )}
    </div>
  )
}
