import React from "react"
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  staticFile,
  useCurrentFrame,
  interpolate,
} from "remotion"
import type { RenderVideoInputProps } from "../types"

/**
 * Explainer template: alternates between text overlays and images,
 * synced to optional voiceover audio.
 */
export const Explainer: React.FC<RenderVideoInputProps> = (props) => {
  const {
    mediaAssets,
    audioTrackLocalPath,
    durationInFrames,
    transitionDurationFrames,
    textOverlays,
    backgroundColor,
    width,
    height,
  } = props

  const frame = useCurrentFrame()
  const imageAssets = mediaAssets.filter((a) => a.type === "image")
  const assetCount = imageAssets.length || 1
  const framesPerSegment = Math.floor(durationInFrames / assetCount)

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {imageAssets.map((asset, i) => {
        const from = i * framesPerSegment
        return (
          <Sequence key={i} from={from} durationInFrames={framesPerSegment}>
            <AbsoluteFill>
              {/* Image slides in from the right */}
              <AbsoluteFill
                style={{
                  opacity: interpolate(
                    frame - from,
                    [0, transitionDurationFrames],
                    [0, 1],
                    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                  ),
                  transform: `translateX(${interpolate(
                    frame - from,
                    [0, transitionDurationFrames],
                    [30, 0],
                    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                  )}px)`,
                }}
              >
                <Img
                  src={staticFile(asset.localPath)}
                  style={{ width, height, objectFit: "cover" }}
                />
              </AbsoluteFill>
            </AbsoluteFill>
          </Sequence>
        )
      })}

      {/* Text overlays rendered on top */}
      {textOverlays.map((overlay, i) => {
        if (frame < overlay.startFrame || frame > overlay.endFrame) return null
        const opacity = interpolate(
          frame,
          [overlay.startFrame, overlay.startFrame + 15, overlay.endFrame - 15, overlay.endFrame],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        )

        const yPos = overlay.position === "top" ? "15%" : overlay.position === "center" ? "50%" : "80%"

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: yPos,
              left: "50%",
              transform: "translate(-50%, -50%)",
              opacity,
              color: overlay.color,
              fontSize: overlay.fontSize,
              fontWeight: "bold",
              textAlign: "center",
              textShadow: "2px 2px 12px rgba(0,0,0,0.9)",
              maxWidth: "85%",
              lineHeight: 1.3,
              zIndex: 10,
            }}
          >
            {overlay.text}
          </div>
        )
      })}

      {audioTrackLocalPath && (
        <Audio src={staticFile(audioTrackLocalPath)} />
      )}
    </AbsoluteFill>
  )
}
