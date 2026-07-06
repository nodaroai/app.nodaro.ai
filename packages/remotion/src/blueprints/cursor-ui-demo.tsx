import React from "react"
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion"
import type { BlueprintProps } from "./types"
import { MediaFrame } from "../lib/media-frame"
import { chaseCamera, scaleSwap, easeOutQuad } from "./motion"
import { CursorAndRipple } from "../lib/cursor-and-ripple"
import { readableTextColor } from "./color"
import { directionStyle } from "../lib/text-direction"
import { blueprintFontFamily, resolveBlueprintAccent } from "../lib/brand"

type Params = { screens: string[]; targets: { xPct: number; yPct: number }[]; labels?: string[]; cursorColor?: string; accentColor?: string }

/**
 * A brand cursor drives a screenshot-based UI through clicks/hovers while the
 * viewport chases each interaction (camera-servo-to-cursor): the `.world`
 * container is translated/scaled by `chaseCamera` so the active target
 * re-centers, the cursor eases to that target and "presses" with a ripple,
 * then the screen swaps to the next beat.
 */
export function CursorUiDemo({ params, durationInFrames, brand }: BlueprintProps) {
  const { screens, targets, labels, cursorColor, accentColor } = params as unknown as Params
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  // Guard-compliant brand wiring — brand-fill.test.ts + blueprint-rtl.test.ts require EVERY
  // blueprint .tsx to reference blueprintFontFamily(brand) + resolveBlueprintAccent + directionStyle.
  // (resolveBlueprintAccent is 3-arg: (paramAccent, brand, fallback); "#f5f5f7" = the non-text
  // decorative-accent fallback convention used by cta-morph-press/grid-card-assemble/device-surface-showcase.)
  const fontFamily = blueprintFontFamily(brand)
  const primaryColor = readableTextColor(brand.backgroundColor)
  const accent = resolveBlueprintAccent(accentColor, brand, "#f5f5f7")
  const cursor = cursorColor ?? "#ffffff"

  const cam = chaseCamera(frame, durationInFrames, targets, width, height)

  // Which beat we're in (one screen + one target per beat).
  const n = Math.max(1, targets.length)
  const segLen = durationInFrames / n
  const beat = Math.max(0, Math.min(n - 1, Math.floor(frame / segLen)))
  const nextBeat = Math.min(screens.length - 1, beat + 1)
  const localT = (frame - beat * segLen) / segLen

  // Cursor eases to this beat's target during the first 60% of the beat, then "presses".
  const arrive = easeOutQuad(Math.min(1, localT / 0.6))
  const prevTarget = targets[Math.max(0, beat - 1)] ?? targets[0]
  const tgt = targets[beat]
  const cursorX = ((prevTarget.xPct + (tgt.xPct - prevTarget.xPct) * arrive) / 100) * width
  const cursorY = ((prevTarget.yPct + (tgt.yPct - prevTarget.yPct) * arrive) / 100) * height
  const cursorSize = Math.round(height * 0.04)

  // Ripple pulses right after arrival.
  const rippleT = localT > 0.6 && localT < 0.85 ? (localT - 0.6) / 0.25 : 0
  const rippleActive = rippleT > 0
  const ripplePx = Math.round(height * 0.12)

  // Screen swaps to the next after the press.
  const e = localT > 0.85 && beat < screens.length - 1 ? easeOutQuad((localT - 0.85) / 0.15) : 0
  const swap = scaleSwap(e)
  const screenIdx = Math.min(screens.length - 1, beat)

  return (
    <AbsoluteFill style={{ backgroundColor: brand.backgroundColor, overflow: "hidden" }}>
      {/* The world — chase-camera translates + scales it so the active target re-centers */}
      <div style={{ position: "absolute", top: 0, left: 0, width, height, transform: `translate(${cam.translateX}px, ${cam.translateY}px) scale(${cam.scale})`, transformOrigin: "0 0" }}>
        {/* current UI screen */}
        <div style={{ position: "absolute", inset: 0, opacity: swap.outOpacity, transform: `scale(${swap.outScale})` }}>
          <MediaFrame src={screens[screenIdx]} fit="cover" width={width} height={height} />
        </div>
        {e > 0 && (
          <div style={{ position: "absolute", inset: 0, opacity: swap.inOpacity, transform: `scale(${swap.inScale})` }}>
            <MediaFrame src={screens[nextBeat]} fit="cover" width={width} height={height} />
          </div>
        )}
        {/* cursor + press ripple, in world space so the camera chases it */}
        <CursorAndRipple
          x={cursorX}
          y={cursorY}
          size={cursorSize}
          color={cursor}
          visible
          ripple={{ scale: 1 + 1.4 * rippleT, opacity: rippleActive ? 0.5 * (1 - rippleT * rippleT) : 0, w: ripplePx, h: ripplePx, radius: ripplePx / 2 }}
        />
      </div>

      {/* Fixed per-beat caption (outside the chased world) — labels the interaction; brand font + direction + accent bar. */}
      {(labels ?? [])[beat] ? (
        <div style={{ position: "absolute", left: width * 0.5, top: height * 0.86, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: Math.round(height * 0.012), opacity: interpolate(localT, [0, 0.12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
          <div style={{ color: primaryColor, fontFamily, fontSize: Math.round(height * 0.038), fontWeight: 700, ...directionStyle((labels ?? [])[beat]!) }}>{(labels ?? [])[beat]}</div>
          <div style={{ width: Math.round(width * 0.06), height: Math.round(height * 0.006), borderRadius: 999, backgroundColor: accent }} />
        </div>
      ) : null}
    </AbsoluteFill>
  )
}
