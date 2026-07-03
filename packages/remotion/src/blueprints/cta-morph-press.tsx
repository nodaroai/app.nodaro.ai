import React from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { BlueprintProps } from "./types"
import { directionStyle } from "../lib/text-direction"
import { resolveBlueprintAccent, resolveHeadingType, resolveBodyType } from "../lib/brand"

interface Params {
  label: string
  sublabel?: string
  accentColor?: string
}

/** Button entrance completes by this frame. */
const BUTTON_ENTRANCE_END = 15
/** Cursor travel begins after the button has appeared. */
const CURSOR_START_FRACTION = 0.15
/** Cursor arrives and press fires at this fraction of total duration. */
const PRESS_FRACTION = 0.7
/** Total frames of the press compression cycle (down + up). */
const COMPRESS_FRAMES = 12
/** Frames each half of the compression takes. */
const COMPRESS_HALF = 6

/**
 * Returns 0→1 progress for the cursor's travel from off-canvas (bottom-right)
 * to near the button center. Uses quadratic ease-out so the cursor decelerates
 * as it approaches the button.
 * Pure function — safe to unit-test without a render.
 */
export function cursorProgress(frame: number, durationFrames: number): number {
  const cursorStart = Math.round(durationFrames * CURSOR_START_FRACTION)
  const pressFrame = Math.round(durationFrames * PRESS_FRACTION)
  if (frame <= cursorStart) return 0
  if (frame >= pressFrame) return 1
  const t = (frame - cursorStart) / (pressFrame - cursorStart)
  // Quadratic ease-out: cursor decelerates as it approaches the button.
  return 1 - (1 - t) * (1 - t)
}

/**
 * Returns a scale factor (1 → ~0.96 → 1) representing the button compression
 * during the simulated cursor press. The press fires at `PRESS_FRACTION` of
 * total duration; the cycle lasts `COMPRESS_FRAMES` frames total (ease-in
 * down, ease-out up). Returns 1 outside the compression window.
 * Pure function — safe to unit-test without a render.
 */
export function pressCompression(frame: number, durationFrames: number): number {
  const pressFrame = Math.round(durationFrames * PRESS_FRACTION)
  const localFrame = frame - pressFrame
  if (localFrame < 0 || localFrame > COMPRESS_FRAMES) return 1
  if (localFrame <= COMPRESS_HALF) {
    // Ease-in down: 1 → 0.96 (press feels heavy, accelerates into button).
    const t = localFrame / COMPRESS_HALF
    return 1 - 0.04 * t * t
  }
  // Ease-out up: 0.96 → 1 (spring release).
  const t = (localFrame - COMPRESS_HALF) / COMPRESS_HALF
  return 0.96 + 0.04 * (1 - (1 - t) * (1 - t))
}

export function CtaMorphPress({ params, durationInFrames, brand }: BlueprintProps) {
  const { label, sublabel, accentColor } = params as unknown as Params
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  const accent = resolveBlueprintAccent(accentColor, brand, "#f5f5f7")
  const labelType = resolveHeadingType(brand, label, { weight: 700, tracking: "0.03em" })
  const sublabelType = resolveBodyType(brand, sublabel ?? "", { weight: 300, tracking: "0.04em" })

  // ── Button entrance (scale 0.6 → 1 over first BUTTON_ENTRANCE_END frames) ──
  const entranceT = Math.max(0, Math.min(1, frame / BUTTON_ENTRANCE_END))
  // Quadratic ease-out: use the same inline formula pattern as other blueprints.
  const entranceProgress = 1 - (1 - entranceT) * (1 - entranceT)
  const buttonEntranceScale = 0.6 + 0.4 * entranceProgress

  // ── Press compression ──
  const compression = pressCompression(frame, durationInFrames)

  // Combined scale: entrance scale first, then press compression on top.
  const buttonScale = buttonEntranceScale * compression

  // Button dimensions.
  const btnW = Math.round(width * 0.36)
  const btnH = Math.round(height * 0.14)
  const btnRadius = Math.round(btnH * 0.4)
  const labelFontSize = Math.round(btnH * 0.36)
  const sublabelFontSize = Math.round(height * 0.038)

  // ── Cursor position ──
  const cProgress = cursorProgress(frame, durationInFrames)
  // Cursor travels from bottom-right toward the button center-right edge.
  const cursorStartX = width * 0.88
  const cursorStartY = height * 0.78
  // Resting near the right edge of the button, slightly below center.
  const cursorEndX = width * 0.5 + btnW * 0.3
  const cursorEndY = height * 0.5 + btnH * 0.1
  const cursorX = cursorStartX + (cursorEndX - cursorStartX) * cProgress
  const cursorY = cursorStartY + (cursorEndY - cursorStartY) * cProgress
  const cursorSize = Math.round(height * 0.038)

  // ── Ripple / glow after press ──
  const pressFrame = Math.round(durationInFrames * PRESS_FRACTION)
  const rippleLocalFrame = frame - (pressFrame + COMPRESS_FRAMES)
  const rippleDuration = 24
  // Ripple is visible in the [0, rippleDuration] window after compression ends.
  const rippleActive = rippleLocalFrame >= 0 && rippleLocalFrame <= rippleDuration
  const rippleT = rippleActive ? rippleLocalFrame / rippleDuration : 0
  const rippleScale = 1 + 1.4 * rippleT   // 1× → 2.4×
  const rippleOpacity = rippleActive ? 0.55 * (1 - rippleT * rippleT) : 0

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
      {/* ── Button with ripple ── */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${buttonScale})`,
          transformOrigin: "center center",
        }}
      >
        {/* Ripple ring — expands outward from button center after press */}
        <div
          style={{
            position: "absolute",
            width: btnW,
            height: btnH,
            borderRadius: btnRadius,
            border: `2px solid ${accent}`,
            transform: `scale(${rippleScale})`,
            opacity: rippleOpacity,
            pointerEvents: "none",
          }}
        />

        {/* CTA button */}
        <div
          style={{
            width: btnW,
            height: btnH,
            borderRadius: btnRadius,
            backgroundColor: accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              ...labelType,
              fontSize: labelFontSize,
              color: brand.backgroundColor,
              whiteSpace: "nowrap",
              textAlign: "center",
              ...directionStyle(label),
            }}
          >
            {label}
          </div>
        </div>
      </div>

      {/* Optional sublabel below the button */}
      {sublabel != null && (
        <div
          style={{
            ...sublabelType,
            fontSize: sublabelFontSize,
            color: accent,
            marginTop: Math.round(height * 0.04),
            whiteSpace: "nowrap",
            opacity: entranceProgress * 0.65,
            ...directionStyle(sublabel),
          }}
        >
          {sublabel}
        </div>
      )}

      {/* ── Cursor (filled triangle — standard pointer shape) ── */}
      <svg
        width={cursorSize}
        height={Math.round(cursorSize * 1.33)}
        viewBox="0 0 18 24"
        style={{
          position: "absolute",
          left: cursorX,
          top: cursorY,
          overflow: "visible",
          opacity: cProgress > 0 ? 1 : 0,
          filter: "drop-shadow(1px 2px 3px rgba(0,0,0,0.5))",
          pointerEvents: "none",
        }}
      >
        {/* Standard mouse-pointer shape: angled tip at (0,0), body down-right */}
        <polygon
          points="0,0 0,18 5,14 8,22 11,21 8,13 14,13"
          fill="#ffffff"
          stroke="rgba(0,0,0,0.6)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}
