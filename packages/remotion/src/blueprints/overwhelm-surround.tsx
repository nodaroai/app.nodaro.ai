import React from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { BlueprintProps } from "./types"
import { FONT_MAP } from "../lib/font-registry"
import { readableTextColor } from "./color"

interface Params {
  surfaces: Array<{ label: string }>
  markers: string[]
  subjectLabel: string
  demands: string[]
  accentColor?: string
}

/** Surface cards finish assembling by this fraction of the window. */
const ASSEMBLY_END_FRACTION = 0.2
/** Density markers scatter in until the morph begins. */
export const MORPH_START_FRACTION = 0.4
/** The morph completes and the close-in begins at this fraction. */
export const CLOSE_IN_START_FRACTION = 0.6
/** Frames between consecutive demand-bubble entries. */
const BUBBLE_STAGGER_FRAMES = 3
/** A bubble travels for this many frames from entry to its resting ring. */
const BUBBLE_TRAVEL_FRAMES = 30
/** Bubbles stop at this distance (unit multiples of the close-in radius) — surrounded, not touched. */
export const BUBBLE_STOP_DISTANCE = 0.28

/**
 * Timeline state for the overwhelm-surround shot at `frame` for demand bubble
 * `demandIndex` (of `demandCount`).
 *
 * - `morphProgress`: 0 before MORPH_START, quadratic-eased 0→1 across the morph
 *   window, 1 from CLOSE_IN_START on (content fade → container reshape → subject).
 * - `bubbleEntered` / `bubbleDistance`: each demand bubble enters staggered
 *   after CLOSE_IN_START and travels inward from 1 to BUBBLE_STOP_DISTANCE
 *   (quadratic ease-out), clamped so it never crosses the stop-short ring.
 *
 * Deliberately exposes NO camera/world transform — the claustrophobia comes
 * from the world crowding the subject; the frame itself never moves.
 * Pure function — safe to unit-test without a render.
 */
export function surroundState(
  frame: number,
  durationInFrames: number,
  _demandCount: number,
  demandIndex: number,
): { morphProgress: number; bubbleDistance: number; bubbleEntered: boolean } {
  const morphStart = durationInFrames * MORPH_START_FRACTION
  const closeInStart = durationInFrames * CLOSE_IN_START_FRACTION

  let morphProgress = 0
  if (frame >= closeInStart) {
    morphProgress = 1
  } else if (frame > morphStart) {
    const t = (frame - morphStart) / Math.max(1, closeInStart - morphStart)
    morphProgress = 1 - (1 - t) * (1 - t)
    if (morphProgress > 0.999) morphProgress = 1
  }

  const entryFrame = closeInStart + demandIndex * BUBBLE_STAGGER_FRAMES
  const bubbleEntered = frame >= entryFrame && frame > closeInStart
  let bubbleDistance = 1
  if (bubbleEntered) {
    const t = Math.min(1, (frame - entryFrame) / BUBBLE_TRAVEL_FRAMES)
    const eased = 1 - (1 - t) * (1 - t)
    bubbleDistance = 1 - (1 - BUBBLE_STOP_DISTANCE) * eased
  }

  return { morphProgress, bubbleDistance, bubbleEntered }
}

/**
 * Deterministic scatter position for density-marker `index` — golden-angle
 * placement inside the unit box (no RNG; same index always maps to the same
 * point). The component scales x/y to its marker field.
 */
export function scatterPoint(index: number): { x: number; y: number } {
  const GOLDEN_ANGLE = 2.399963229728653
  const r = 0.35 + 0.6 * ((index * 0.618034) % 1)
  const theta = index * GOLDEN_ANGLE
  return { x: Math.max(-1, Math.min(1, r * Math.cos(theta))), y: Math.max(-1, Math.min(1, r * Math.sin(theta) * 0.6)) }
}

export function OverwhelmSurround({ params, durationInFrames, brand }: BlueprintProps) {
  const { surfaces, markers, subjectLabel, demands, accentColor } = params as unknown as Params
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  const fontFamily = FONT_MAP["Montserrat"] ?? "Montserrat"
  const primaryColor = readableTextColor(brand.backgroundColor)
  const emphasisColor = accentColor ?? primaryColor

  const cx = width / 2
  const cy = height / 2
  const { morphProgress } = surroundState(frame, durationInFrames, demands.length, 0)

  // ── Phase 1: surface cards assemble (staggered scale-in; center hero-sized) ──
  const assemblyEnd = Math.max(1, durationInFrames * ASSEMBLY_END_FRACTION)
  const centerIdx = Math.floor(surfaces.length / 2)
  const cardW = Math.round(width * 0.24)
  const cardH = Math.round(height * 0.3)
  const cardGap = Math.round(width * 0.28)

  // ── Phase 2: density markers scatter in ──
  const markerStart = assemblyEnd
  const markerWindow = Math.max(1, durationInFrames * MORPH_START_FRACTION - markerStart)

  // ── Phase 4: demand bubbles close in radially ──
  const closeInRadius = Math.min(width, height) * 0.42

  const surfaceFontSize = Math.round(height * 0.035)
  const markerFontSize = Math.round(height * 0.024)
  const subjectFontSize = Math.round(height * 0.034)
  const demandFontSize = Math.round(height * 0.026)

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
      }}
    >
      {/* Surface cards (the recognizable "too many tools" context) */}
      {surfaces.map((surface, i) => {
        const enterStart = i * 6
        const t = Math.max(0, Math.min(1, (frame - enterStart) / Math.max(1, assemblyEnd - enterStart)))
        const entrance = 1 - (1 - t) * (1 - t)
        const isCenter = i === centerIdx
        const resting = isCenter ? 1 : 0.86
        // Low-amplitude float so the context feels live, composed onto the resting scale.
        const float = Math.sin(frame * 0.05 + i * 1.7) * 4
        const x = cx + (i - centerIdx) * cardGap
        // The center card is the morph subject — it fades/reshapes; flanks persist.
        const cardOpacity = isCenter ? entrance * (1 - morphProgress) : entrance
        const reshape = isCenter ? 1 - 0.38 * morphProgress : 1
        if (cardOpacity <= 0) return null
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: cy + float,
              width: cardW,
              height: cardH,
              transform: `translate(-50%, -50%) scale(${entrance * resting * reshape})`,
              opacity: cardOpacity,
              borderRadius: Math.round(cardH * (0.08 + 0.42 * (isCenter ? morphProgress : 0))),
              border: `2px solid ${emphasisColor}66`,
              backgroundColor: `${emphasisColor}12`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily,
              fontSize: surfaceFontSize,
              fontWeight: 600,
              color: primaryColor,
            }}
          >
            {surface.label}
          </div>
        )
      })}

      {/* Density markers — pure "look how much" chips, no internal animation */}
      {markers.map((marker, i) => {
        const p = scatterPoint(i)
        const enterStart = markerStart + (i * markerWindow) / Math.max(1, markers.length)
        const t = Math.max(0, Math.min(1, (frame - enterStart) / 8))
        const entrance = 1 - (1 - t) * (1 - t)
        if (entrance <= 0) return null
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: cx + p.x * width * 0.4,
              top: cy + p.y * height * 0.44,
              transform: `translate(-50%, -50%) scale(${entrance})`,
              opacity: 0.85 * entrance,
              padding: `${Math.round(height * 0.008)}px ${Math.round(width * 0.01)}px`,
              borderRadius: 999,
              border: `1.5px solid ${primaryColor}33`,
              fontFamily,
              fontSize: markerFontSize,
              fontWeight: 500,
              color: primaryColor,
              whiteSpace: "nowrap",
            }}
          >
            {marker}
          </div>
        )
      })}

      {/* The subject — revealed beneath the morphing center card */}
      {morphProgress > 0 && (
        <div
          style={{
            position: "absolute",
            left: cx,
            top: cy,
            transform: `translate(-50%, -50%) scale(${0.8 + 0.2 * morphProgress})`,
            opacity: morphProgress,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: Math.round(height * 0.012),
          }}
        >
          {/* Simple person glyph: circle head + shoulders arc, drawn with SVG */}
          <svg
            width={Math.round(height * 0.16)}
            height={Math.round(height * 0.16)}
            viewBox="0 0 100 100"
          >
            <circle cx="50" cy="34" r="18" fill="none" stroke={emphasisColor} strokeWidth="6" />
            <path
              d="M 16 92 Q 50 58 84 92"
              fill="none"
              stroke={emphasisColor}
              strokeWidth="6"
              strokeLinecap="round"
            />
          </svg>
          <div
            style={{
              fontFamily,
              fontSize: subjectFontSize,
              fontWeight: 700,
              color: primaryColor,
            }}
          >
            {subjectLabel}
          </div>
        </div>
      )}

      {/* Demand bubbles — close in from all compass points, stop short, hold */}
      {demands.map((demand, i) => {
        const { bubbleDistance, bubbleEntered } = surroundState(
          frame,
          durationInFrames,
          demands.length,
          i,
        )
        if (!bubbleEntered) return null
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / demands.length
        const arrival = Math.max(0, Math.min(1, (1 - bubbleDistance) / (1 - BUBBLE_STOP_DISTANCE)))
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: cx + Math.cos(angle) * bubbleDistance * closeInRadius * 2.2,
              top: cy + Math.sin(angle) * bubbleDistance * closeInRadius * 1.6,
              transform: "translate(-50%, -50%)",
              opacity: 0.35 + 0.65 * arrival,
              padding: `${Math.round(height * 0.012)}px ${Math.round(width * 0.014)}px`,
              borderRadius: 999,
              border: `2px solid ${emphasisColor}`,
              backgroundColor: `${emphasisColor}22`,
              fontFamily,
              fontSize: demandFontSize,
              fontWeight: 600,
              color: primaryColor,
              whiteSpace: "nowrap",
            }}
          >
            {demand}
          </div>
        )
      })}
    </div>
  )
}
