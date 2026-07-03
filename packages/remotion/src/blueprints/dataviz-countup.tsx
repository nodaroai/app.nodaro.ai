import React from "react"
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion"
import type { BlueprintProps } from "./types"
import { directionStyle } from "../lib/text-direction"
import { readableTextColor } from "./color"
import { resolveBlueprintAccent, resolveHeadingType, resolveBodyType } from "../lib/brand"

interface Params {
  value: number
  prefix?: string
  suffix?: string
  label: string
  sublabel?: string
  accentColor?: string
}

/** The count-up fills this fraction of the total duration; the rest is a held hold. */
const COUNTUP_FILL = 0.8

/**
 * Returns the current animated count value: starts at 0, rises to `target`
 * over the first `COUNTUP_FILL` of `durationFrames` (quadratic ease-out),
 * then clamps at `target` for the remaining hold.
 * Pure function — safe to unit-test without a render.
 */
export function countupValue(frame: number, durationFrames: number, target: number): number {
  const countupEnd = Math.round(durationFrames * COUNTUP_FILL)
  if (frame <= 0) return 0
  if (frame >= countupEnd) return target
  const t = frame / countupEnd
  // Quadratic ease-out: fast start, smooth deceleration, no bounce.
  return target * (1 - (1 - t) * (1 - t))
}

export function DatavizCountup({ params, durationInFrames, brand }: BlueprintProps) {
  const { value, prefix = "", suffix = "", label, sublabel, accentColor } =
    params as unknown as Params
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  const textColor = readableTextColor(brand.backgroundColor)
  // accentColor is user-configurable; fall back to the contrast-safe text color
  // so the big number is never invisible on a light brand.backgroundColor.
  const numberColor = resolveBlueprintAccent(accentColor, brand, textColor)
  const labelType = resolveBodyType(brand, label, { weight: 400, tracking: "0.06em", casing: "uppercase" })
  const sublabelType = resolveBodyType(brand, sublabel ?? "", { weight: 300, tracking: "0.03em" })

  // Animated count.
  const current = countupValue(frame, durationInFrames, value)
  // Integer targets display as whole numbers; fractional targets round to 1 decimal.
  const displayValue = Number.isInteger(value)
    ? String(Math.round(current))
    : current.toFixed(1)
  const numberType = resolveHeadingType(brand, `${prefix}${displayValue}${suffix}`, {
    weight: 900,
    tracking: "-0.04em",
  })

  // Label and sublabel fade+slide up over the first 20 frames.
  const labelProgress = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.ease),
  })

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
      {/* Large eased counter */}
      <div
        style={{
          ...numberType,
          fontSize: Math.round(height * 0.22),
          color: numberColor,
          whiteSpace: "nowrap",
          lineHeight: 1,
          ...directionStyle(`${prefix}${displayValue}${suffix}`),
        }}
      >
        {prefix}{displayValue}{suffix}
      </div>

      {/* Primary label — fades and slides up */}
      <div
        style={{
          ...labelType,
          fontSize: Math.round(height * 0.055),
          color: textColor,
          whiteSpace: "nowrap",
          marginTop: Math.round(height * 0.03),
          opacity: labelProgress,
          transform: `translateY(${(1 - labelProgress) * 12}px)`,
          ...directionStyle(label),
        }}
      >
        {label}
      </div>

      {/* Optional sublabel */}
      {sublabel != null && (
        <div
          style={{
            ...sublabelType,
            fontSize: Math.round(height * 0.035),
            color: "rgba(255,255,255,0.6)",
            whiteSpace: "nowrap",
            marginTop: Math.round(height * 0.015),
            opacity: labelProgress,
            ...directionStyle(sublabel),
          }}
        >
          {sublabel}
        </div>
      )}
    </div>
  )
}
