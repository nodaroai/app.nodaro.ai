import React from "react"
import { useCurrentFrame } from "remotion"
import type {
  ColorGradeEffect,
  VignetteEffect,
  FilmGrainEffect,
  LetterboxEffect,
  NoiseOverlayEffect,
} from "../plan-types"

/**
 * Build a CSS filter string from a color-grade effect.
 */
export function buildColorGradeFilter(effect: ColorGradeEffect): string {
  const parts: string[] = []
  if (effect.brightness !== 1) parts.push(`brightness(${effect.brightness})`)
  if (effect.contrast !== 1) parts.push(`contrast(${effect.contrast})`)
  if (effect.saturation !== 1) parts.push(`saturate(${effect.saturation})`)
  // Temperature is approximated via sepia + hue-rotate
  if (effect.temperature !== 0) {
    const absTemp = Math.abs(effect.temperature)
    const sepia = absTemp / 200 // max 0.5 sepia
    parts.push(`sepia(${sepia})`)
    // Warm = positive hue rotate, cool = negative
    const hue = effect.temperature > 0 ? -10 : 180
    if (absTemp > 20) parts.push(`hue-rotate(${hue}deg)`)
  }
  return parts.length > 0 ? parts.join(" ") : "none"
}

/**
 * Vignette overlay using a radial gradient.
 */
export function VignetteOverlay({
  intensity,
  radius,
}: Pick<VignetteEffect, "intensity" | "radius">) {
  const size = Math.round(radius * 100)
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background: `radial-gradient(ellipse ${size}% ${size}% at 50% 50%, transparent 50%, rgba(0,0,0,${intensity}))`,
      }}
    />
  )
}

/**
 * Animated film grain overlay using CSS noise.
 */
export function FilmGrainOverlay({
  intensity,
  size,
  seed,
}: Pick<FilmGrainEffect, "intensity" | "size" | "seed">) {
  const frame = useCurrentFrame()
  // Use frame + seed to animate grain
  const offset = ((frame + (seed ?? 0)) * 7) % 100

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity: intensity,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 ${size * 100} ${size * 100}' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='${0.65 / size}' numOctaves='3' stitchTiles='stitch' seed='${frame + (seed ?? 0)}'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        backgroundPosition: `${offset}px ${offset}px`,
        mixBlendMode: "overlay",
      }}
    />
  )
}

/**
 * Letterbox bars (top + bottom).
 */
export function LetterboxBars({
  ratio,
  color,
  width,
  height,
}: Pick<LetterboxEffect, "ratio" | "color"> & {
  width: number
  height: number
}) {
  const currentRatio = width / height
  if (ratio <= currentRatio) return null // already wider than target

  // Calculate bar heights
  const targetHeight = width / ratio
  const barHeight = Math.round((height - targetHeight) / 2)
  if (barHeight <= 0) return null

  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: barHeight,
          backgroundColor: color,
          zIndex: 100,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: barHeight,
          backgroundColor: color,
          zIndex: 100,
        }}
      />
    </>
  )
}

/**
 * Perlin noise overlay using animated SVG turbulence.
 */
export function NoiseOverlay({
  opacity,
  scale,
  animated,
  noiseType,
}: Pick<NoiseOverlayEffect, "opacity" | "scale" | "animated" | "noiseType">) {
  const frame = useCurrentFrame()
  const seed = animated ? frame : 0
  const turbulenceType = noiseType === "simplex" ? "turbulence" : "fractalNoise"

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity,
        mixBlendMode: "overlay",
      }}
    >
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        <filter id={`noise-${seed}`}>
          <feTurbulence
            type={turbulenceType}
            baseFrequency={scale}
            numOctaves={4}
            seed={seed}
            stitchTiles="stitch"
          />
        </filter>
        <rect width="100%" height="100%" filter={`url(#noise-${seed})`} />
      </svg>
    </div>
  )
}
