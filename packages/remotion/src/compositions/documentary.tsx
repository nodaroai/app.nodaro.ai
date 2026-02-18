import React from "react"
import {
  AbsoluteFill,
  Audio,
  Img,
  Video,
  Sequence,
  staticFile,
  useCurrentFrame,
  interpolate,
} from "remotion"
import type { RenderVideoInputProps } from "../types"
import { useKenBurns } from "../lib/use-asset"

/**
 * Documentary template: Ken Burns pan/zoom on images,
 * atmospheric fade transitions, narration sync.
 */

function DocumentarySegment({
  asset,
  framesPerAsset,
  width,
  height,
}: {
  asset: RenderVideoInputProps["mediaAssets"][number]
  framesPerAsset: number
  width: number
  height: number
}) {
  const frame = useCurrentFrame()
  const kenBurns = useKenBurns(asset.type === "image", framesPerAsset)

  // Long atmospheric fade in/out
  const fadeFrames = Math.min(30, Math.floor(framesPerAsset * 0.15))
  const opacity = interpolate(
    frame,
    [0, fadeFrames, framesPerAsset - fadeFrames, framesPerAsset],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  )

  const transform = asset.type === "image"
    ? `scale(${kenBurns.scale}) translate(${kenBurns.translateX}%, ${kenBurns.translateY}%)`
    : undefined

  return (
    <AbsoluteFill style={{ opacity }}>
      {asset.type === "image" ? (
        <Img
          src={staticFile(asset.localPath)}
          style={{ width, height, objectFit: "cover", transform }}
        />
      ) : (
        <Video
          src={staticFile(asset.localPath)}
          style={{ width, height, objectFit: "cover" }}
        />
      )}
    </AbsoluteFill>
  )
}

export const Documentary: React.FC<RenderVideoInputProps> = (props) => {
  const {
    mediaAssets,
    audioTrackLocalPath,
    durationInFrames,
    textOverlays,
    backgroundColor,
    width,
    height,
  } = props

  const frame = useCurrentFrame()
  const visualAssets = mediaAssets.filter((a) => a.type === "image" || a.type === "video")
  const assetCount = visualAssets.length || 1
  const framesPerAsset = Math.floor(durationInFrames / assetCount)

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {visualAssets.map((asset, i) => (
        <Sequence key={i} from={i * framesPerAsset} durationInFrames={framesPerAsset}>
          <DocumentarySegment
            asset={asset}
            framesPerAsset={framesPerAsset}
            width={width}
            height={height}
          />
        </Sequence>
      ))}

      {/* Subtle narration-style text overlays */}
      {textOverlays.map((overlay, i) => {
        if (frame < overlay.startFrame || frame > overlay.endFrame) return null
        const opacity = interpolate(
          frame,
          [overlay.startFrame, overlay.startFrame + 20, overlay.endFrame - 20, overlay.endFrame],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        )

        const yPos = overlay.position === "top" ? "8%" : overlay.position === "center" ? "50%" : "88%"

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
              fontWeight: 300,
              fontStyle: "italic",
              textAlign: "center",
              textShadow: "2px 2px 16px rgba(0,0,0,0.9)",
              maxWidth: "80%",
              lineHeight: 1.4,
              letterSpacing: "0.02em",
              zIndex: 10,
            }}
          >
            {overlay.text}
          </div>
        )
      })}

      {audioTrackLocalPath && <Audio src={staticFile(audioTrackLocalPath)} />}
    </AbsoluteFill>
  )
}
