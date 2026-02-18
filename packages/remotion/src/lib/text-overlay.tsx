import React from "react"
import { useCurrentFrame, interpolate } from "remotion"
import type { TextOverlay, CaptionPosition } from "../types"

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

function getPositionStyle(position: CaptionPosition): React.CSSProperties {
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
 * Renders text overlays that fade in/out at their specified frame ranges.
 * Used by all composition templates.
 */
export function TextOverlayLayer({
  overlays,
  fadeFrames = 10,
  style,
}: {
  overlays: readonly TextOverlay[]
  fadeFrames?: number
  style?: Partial<React.CSSProperties>
}) {
  const frame = useCurrentFrame()

  return (
    <>
      {overlays.map((overlay, i) => {
        if (frame < overlay.startFrame || frame > overlay.endFrame) return null

        const opacity = interpolate(
          frame,
          [overlay.startFrame, overlay.startFrame + fadeFrames, overlay.endFrame - fadeFrames, overlay.endFrame],
          [0, 1, 1, 0],
          CLAMP,
        )

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              ...getPositionStyle(overlay.position),
              opacity,
              color: overlay.color,
              fontSize: overlay.fontSize,
              fontWeight: "bold",
              textShadow: "2px 2px 8px rgba(0,0,0,0.8)",
              textAlign: "center",
              maxWidth: "80%",
              zIndex: 10,
              ...style,
            }}
          >
            {overlay.text}
          </div>
        )
      })}
    </>
  )
}
