import React from "react"
import { AbsoluteFill, Audio, Sequence } from "remotion"
import type { RenderVideoInputProps } from "../types"
import { useAssetTransition } from "../lib/use-asset"
import { MediaItem } from "../lib/media-item"
import { TextOverlayLayer } from "../lib/text-overlay"

function SlideshowSegment({
  asset,
  index,
  totalAssets,
  framesPerAsset,
  transitionFrames,
  kenBurnsEnabled,
  width,
  height,
}: {
  asset: RenderVideoInputProps["mediaAssets"][number]
  index: number
  totalAssets: number
  framesPerAsset: number
  transitionFrames: number
  kenBurnsEnabled: boolean
  width: number
  height: number
}) {
  const { opacity, visible } = useAssetTransition(index, totalAssets, framesPerAsset, transitionFrames)

  if (!visible) return null

  return (
    <AbsoluteFill style={{ opacity }}>
      <MediaItem
        asset={asset}
        width={width}
        height={height}
        kenBurnsEnabled={kenBurnsEnabled}
        kenBurnsDuration={framesPerAsset}
      />
    </AbsoluteFill>
  )
}

export function Slideshow(props: RenderVideoInputProps) {
  const {
    mediaAssets,
    audioTrackUrl,
    durationInFrames,
    transitionDurationFrames,
    textOverlays,
    backgroundColor,
    kenBurnsEnabled,
    width,
    height,
  } = props

  const visualAssets = mediaAssets.filter((a) => a.type === "image" || a.type === "video")
  const assetCount = visualAssets.length || 1
  const framesPerAsset = Math.floor(durationInFrames / assetCount)

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {visualAssets.map((asset, i) => (
        <Sequence key={i} from={i * framesPerAsset} durationInFrames={framesPerAsset + transitionDurationFrames}>
          <SlideshowSegment
            asset={asset}
            index={i}
            totalAssets={assetCount}
            framesPerAsset={framesPerAsset}
            transitionFrames={transitionDurationFrames}
            kenBurnsEnabled={kenBurnsEnabled}
            width={width}
            height={height}
          />
        </Sequence>
      ))}

      <TextOverlayLayer overlays={textOverlays} />

      {audioTrackUrl && (
        <Audio src={audioTrackUrl} />
      )}
    </AbsoluteFill>
  )
}
