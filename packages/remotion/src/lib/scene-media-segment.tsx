import React from "react"
import { AbsoluteFill, Img, Video, useCurrentFrame, useVideoConfig, interpolate } from "remotion"
import type { MediaSegment } from "../scene-graph"
import {
  computeTransitionIn,
  computeTransitionOut,
  combineTransitions,
} from "./transition-utils"

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

/**
 * Renders a single media segment with transitions and effects.
 * Used inside a <Sequence> — useCurrentFrame() returns local frame starting at 0.
 */
export function SceneMediaSegment({
  segment,
  containerWidth,
  containerHeight,
}: {
  segment: MediaSegment
  containerWidth: number
  containerHeight: number
}) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // Transitions
  const transIn = computeTransitionIn(segment.transitionIn, frame, fps)
  const transOut = computeTransitionOut(segment.transitionOut, frame, segment.durationInFrames, fps)
  const { opacity, transform: transitionTransform } = combineTransitions(transIn, transOut)

  // Effects pipeline
  let effectTransform = ""
  let effectFilter = ""
  let effectOpacity = 1

  for (const effect of segment.effects) {
    const progress = interpolate(frame, [0, segment.durationInFrames], [0, 1], CLAMP)
    const value = interpolate(progress, [0, 1], [effect.startValue, effect.endValue])

    switch (effect.type) {
      case "ken-burns": {
        const scale = interpolate(value, [0, 1], [1, 1.15])
        const tx = interpolate(value, [0, 1], [0, -2])
        const ty = interpolate(value, [0, 1], [0, -1.5])
        effectTransform += ` scale(${scale}) translate(${tx}%, ${ty}%)`
        break
      }
      case "scale":
        effectTransform += ` scale(${value})`
        break
      case "opacity":
        effectOpacity *= value
        break
      case "blur":
        effectFilter += ` blur(${value}px)`
        break
    }
  }

  // Layout
  const { layout } = segment
  const isPositioned = layout.mode === "positioned"
  const objectFit = layout.objectFit ?? "cover"

  const containerStyle: React.CSSProperties = isPositioned
    ? {
        position: "absolute",
        left: `${layout.x ?? 0}%`,
        top: `${layout.y ?? 0}%`,
        width: `${layout.width ?? 100}%`,
        height: `${layout.height ?? 100}%`,
        overflow: "hidden",
      }
    : {
        position: "absolute",
        inset: 0,
        overflow: "hidden",
      }

  const mediaWidth = isPositioned ? "100%" : containerWidth
  const mediaHeight = isPositioned ? "100%" : containerHeight

  const transforms = [transitionTransform, effectTransform].filter(Boolean).join(" ")

  const wrapperStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    opacity: opacity * effectOpacity,
    transform: transforms || undefined,
    filter: effectFilter || undefined,
  }

  const mediaStyle: React.CSSProperties = {
    width: mediaWidth,
    height: mediaHeight,
    objectFit,
  }

  return (
    <div style={containerStyle}>
      <div style={wrapperStyle}>
        {segment.mediaType === "image" ? (
          <Img src={segment.src} style={mediaStyle} />
        ) : (
          <Video src={segment.src} style={mediaStyle} />
        )}
      </div>
    </div>
  )
}
