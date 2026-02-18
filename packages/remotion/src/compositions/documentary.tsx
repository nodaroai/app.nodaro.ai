import React from "react"
import {
  AbsoluteFill,
  Audio,
  Sequence,
  useCurrentFrame,
  interpolate,
} from "remotion"
import type { RenderVideoInputProps } from "../types"
import { MediaItem } from "../lib/media-item"
import { TextOverlayLayer } from "../lib/text-overlay"

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

/**
 * Documentary segment: atmospheric fade transition with Ken Burns on images.
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
  const fadeFrames = Math.min(30, Math.floor(framesPerAsset * 0.15))
  const opacity = interpolate(
    frame,
    [0, fadeFrames, framesPerAsset - fadeFrames, framesPerAsset],
    [0, 1, 1, 0],
    CLAMP,
  )

  return (
    <AbsoluteFill style={{ opacity }}>
      <MediaItem
        asset={asset}
        width={width}
        height={height}
        kenBurnsEnabled={asset.type === "image"}
        kenBurnsDuration={framesPerAsset}
      />
    </AbsoluteFill>
  )
}

/**
 * Documentary template: Ken Burns pan/zoom on images,
 * atmospheric fade transitions, narration sync.
 */
export function Documentary(props: RenderVideoInputProps) {
  const {
    mediaAssets,
    audioTrackLocalPath,
    durationInFrames,
    textOverlays,
    backgroundColor,
    width,
    height,
  } = props

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

      <TextOverlayLayer
        overlays={textOverlays}
        fadeFrames={20}
        style={{
          fontWeight: 300,
          fontStyle: "italic",
          textShadow: "2px 2px 16px rgba(0,0,0,0.9)",
          lineHeight: 1.4,
          letterSpacing: "0.02em",
        }}
      />

      {audioTrackLocalPath && <Audio src={audioTrackLocalPath} />}
    </AbsoluteFill>
  )
}
