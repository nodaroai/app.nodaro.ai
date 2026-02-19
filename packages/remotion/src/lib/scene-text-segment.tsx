import React from "react"
import { useCurrentFrame, interpolate } from "remotion"
import type { TextSegment } from "../scene-graph"

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

function getPositionStyle(position: TextSegment["position"]): React.CSSProperties {
  switch (position) {
    case "top":
      return { top: "10%", left: "50%", transform: "translateX(-50%)" }
    case "center":
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
    case "bottom":
      return { bottom: "10%", left: "50%", transform: "translateX(-50%)" }
  }
}

/**
 * Renders a single text segment with animation.
 * Used inside a <Sequence> — useCurrentFrame() returns local frame starting at 0.
 */
export function SceneTextSegment({ segment }: { segment: TextSegment }) {
  const frame = useCurrentFrame()
  const { durationInFrames, animation, text, position, fontSize, color, fontWeight, fontStyle } = segment

  const fadeFrames = Math.min(15, Math.floor(durationInFrames * 0.15))

  let opacity = 1
  let transform = getPositionStyle(position).transform ?? ""
  let content: React.ReactNode = text

  switch (animation) {
    case "fade": {
      opacity = interpolate(
        frame,
        [0, fadeFrames, durationInFrames - fadeFrames, durationInFrames],
        [0, 1, 1, 0],
        CLAMP,
      )
      break
    }

    case "slide-up": {
      opacity = interpolate(frame, [0, fadeFrames], [0, 1], CLAMP)
      const yOffset = interpolate(frame, [0, fadeFrames], [30, 0], CLAMP)
      transform += ` translateY(${yOffset}px)`
      break
    }

    case "typewriter": {
      opacity = 1
      const progress = interpolate(frame, [0, durationInFrames * 0.6], [0, 1], CLAMP)
      const charCount = Math.floor(progress * text.length)
      content = text.slice(0, charCount)
      break
    }

    case "word-highlight": {
      opacity = 1
      const words = text.split(/\s+/)
      const progress = interpolate(frame, [0, durationInFrames], [0, 1], CLAMP)
      const highlightIndex = Math.min(Math.floor(progress * words.length), words.length - 1)
      content = (
        <>
          {words.map((word, wi) => (
            <span
              key={wi}
              style={{
                color: wi === highlightIndex ? "#FFD700" : color,
                fontWeight: wi === highlightIndex ? 900 : (fontWeight ?? 700),
                marginRight: 8,
                transition: "color 0.1s",
              }}
            >
              {word}
            </span>
          ))}
        </>
      )
      break
    }

    case "none":
    default:
      break
  }

  const outOpacity = animation !== "fade"
    ? interpolate(frame, [durationInFrames - fadeFrames, durationInFrames], [1, 0], CLAMP)
    : 1

  return (
    <div
      style={{
        position: "absolute",
        ...getPositionStyle(position),
        transform,
        opacity: opacity * (animation === "fade" ? 1 : outOpacity),
        color,
        fontSize,
        fontWeight: fontWeight ?? 700,
        fontStyle: fontStyle ?? "normal",
        textShadow: "2px 2px 8px rgba(0,0,0,0.8)",
        textAlign: "center",
        maxWidth: "80%",
        zIndex: 10,
        lineHeight: 1.4,
      }}
    >
      {content}
    </div>
  )
}
