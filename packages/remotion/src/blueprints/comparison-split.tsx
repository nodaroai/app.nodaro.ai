import React from "react"
import { useCurrentFrame, useVideoConfig } from "remotion"
import type { BlueprintProps } from "./types"
import { directionStyle } from "../lib/text-direction"
import { readableTextColor } from "./color"
import { resolveBlueprintAccent, resolveHeadingType, resolveBodyType } from "../lib/brand"

interface Params {
  left: string
  right: string
  leftBadge?: string
  rightBadge?: string
  accentColor?: string
}

/** Panels complete their entrance by this many frames. */
const ENTRANCE_FRAMES = 12
/** Badges pop after this fraction of the total duration. */
const BADGE_FRACTION = 0.78

/**
 * Returns a 0→1 smooth progress value for a panel entrance over the first
 * `ENTRANCE_FRAMES` frames (quadratic ease-out, no bounce).
 * Used mirrored for both the left and right panels.
 * Pure function — safe to unit-test without a render.
 */
export function sideEntranceProgress(frame: number, durationFrames: number): number {
  const entranceEnd = Math.min(ENTRANCE_FRAMES, durationFrames)
  if (frame <= 0) return 0
  if (frame >= entranceEnd) return 1
  const t = frame / entranceEnd
  // Quadratic ease-out: fast start, smooth deceleration, no bounce.
  return 1 - (1 - t) * (1 - t)
}

export function ComparisonSplit({ params, durationInFrames, brand }: BlueprintProps) {
  const { left, right, leftBadge, rightBadge, accentColor } =
    params as unknown as Params
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  const primaryColor = readableTextColor(brand.backgroundColor)
  const emphasisColor = resolveBlueprintAccent(accentColor, brand, primaryColor)
  const leftType = resolveHeadingType(brand, left, { weight: 700, tracking: "-0.02em" })
  const rightType = resolveHeadingType(brand, right, { weight: 700, tracking: "-0.02em" })
  const leftBadgeType = resolveBodyType(brand, leftBadge ?? "", { weight: 700 })
  const rightBadgeType = resolveBodyType(brand, rightBadge ?? "", { weight: 700 })

  // Panel entrance — both panels slide in from their respective sides simultaneously.
  const entrance = sideEntranceProgress(frame, durationInFrames)

  // Left panel slides in from the left (translateX: -width → 0).
  const leftX = -(1 - entrance) * (width * 0.5)
  // Right panel slides in from the right (translateX: +width → 0).
  const rightX = (1 - entrance) * (width * 0.5)

  // Badges pop in via scale-up near the end of the reveal.
  const badgeStartFrame = Math.round(durationInFrames * BADGE_FRACTION)
  const badgeEntranceEnd = badgeStartFrame + 10
  const badgeT = Math.max(
    0,
    Math.min(1, (frame - badgeStartFrame) / Math.max(1, badgeEntranceEnd - badgeStartFrame)),
  )
  // Quadratic ease-out for badge pop.
  const badgeProgress = 1 - (1 - badgeT) * (1 - badgeT)
  const badgeScale = 0.7 + 0.3 * badgeProgress
  const badgeOpacity = badgeProgress

  const panelW = Math.round(width * 0.44)
  const panelH = Math.round(height * 0.72)
  const panelRadius = Math.round(Math.min(panelW, panelH) * 0.04)
  const labelFontSize = Math.round(height * 0.08)
  const badgeFontSize = Math.round(height * 0.038)
  const badgePadV = Math.round(height * 0.018)
  const badgePadH = Math.round(width * 0.018)
  const dividerW = Math.round(width * 0.003)
  const dividerH = Math.round(height * 0.55)

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
        overflow: "hidden",
      }}
    >
      {/* Left panel */}
      <div
        style={{
          width: panelW,
          height: panelH,
          borderRadius: panelRadius,
          border: `2px solid ${emphasisColor}`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          transform: `translateX(${leftX}px)`,
          marginRight: Math.round(width * 0.01),
          flexShrink: 0,
        }}
      >
        <div
          style={{
            ...leftType,
            fontSize: labelFontSize,
            color: primaryColor,
            textAlign: "center",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            padding: `0 ${Math.round(panelW * 0.08)}px`,
            ...directionStyle(left),
          }}
        >
          {left}
        </div>

        {/* Optional left badge — bottom center of the panel */}
        {leftBadge != null && (
          <div
            style={{
              position: "absolute",
              bottom: Math.round(panelH * 0.06),
              backgroundColor: emphasisColor,
              borderRadius: Math.round(badgeFontSize * 0.5),
              padding: `${badgePadV}px ${badgePadH}px`,
              transform: `scale(${badgeScale})`,
              opacity: badgeOpacity,
            }}
          >
            <div
              style={{
                ...leftBadgeType,
                fontSize: badgeFontSize,
                color: brand.backgroundColor,
                whiteSpace: "nowrap",
                ...directionStyle(leftBadge),
              }}
            >
              {leftBadge}
            </div>
          </div>
        )}
      </div>

      {/* Center divider — appears with the panels */}
      <div
        style={{
          width: dividerW,
          height: dividerH,
          backgroundColor: emphasisColor,
          opacity: entrance,
          flexShrink: 0,
        }}
      />

      {/* Right panel */}
      <div
        style={{
          width: panelW,
          height: panelH,
          borderRadius: panelRadius,
          border: `2px solid ${emphasisColor}`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          transform: `translateX(${rightX}px)`,
          marginLeft: Math.round(width * 0.01),
          flexShrink: 0,
        }}
      >
        <div
          style={{
            ...rightType,
            fontSize: labelFontSize,
            color: primaryColor,
            textAlign: "center",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            padding: `0 ${Math.round(panelW * 0.08)}px`,
            ...directionStyle(right),
          }}
        >
          {right}
        </div>

        {/* Optional right badge — bottom center of the panel */}
        {rightBadge != null && (
          <div
            style={{
              position: "absolute",
              bottom: Math.round(panelH * 0.06),
              backgroundColor: emphasisColor,
              borderRadius: Math.round(badgeFontSize * 0.5),
              padding: `${badgePadV}px ${badgePadH}px`,
              transform: `scale(${badgeScale})`,
              opacity: badgeOpacity,
            }}
          >
            <div
              style={{
                ...rightBadgeType,
                fontSize: badgeFontSize,
                color: brand.backgroundColor,
                whiteSpace: "nowrap",
                ...directionStyle(rightBadge),
              }}
            >
              {rightBadge}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
