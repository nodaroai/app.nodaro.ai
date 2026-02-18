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
import { useAssetTransition, useKenBurns } from "../lib/use-asset"

function MediaSegment({
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
  const kenBurns = useKenBurns(kenBurnsEnabled && asset.type === "image", framesPerAsset)

  if (!visible) return null

  const transform = kenBurnsEnabled && asset.type === "image"
    ? `scale(${kenBurns.scale}) translate(${kenBurns.translateX}%, ${kenBurns.translateY}%)`
    : undefined

  return (
    <AbsoluteFill style={{ opacity }}>
      {asset.type === "image" ? (
        <Img
          src={staticFile(asset.localPath)}
          style={{
            width,
            height,
            objectFit: "cover",
            transform,
          }}
        />
      ) : asset.type === "video" ? (
        <Video
          src={staticFile(asset.localPath)}
          style={{ width, height, objectFit: "cover" }}
        />
      ) : null}
    </AbsoluteFill>
  )
}

function TextOverlayLayer({
  overlays,
}: {
  overlays: RenderVideoInputProps["textOverlays"]
}) {
  const frame = useCurrentFrame()

  return (
    <>
      {overlays.map((overlay, i) => {
        if (frame < overlay.startFrame || frame > overlay.endFrame) return null
        const opacity = interpolate(
          frame,
          [overlay.startFrame, overlay.startFrame + 10, overlay.endFrame - 10, overlay.endFrame],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        )

        const positionStyle: React.CSSProperties =
          overlay.position === "top"
            ? { top: "10%", left: "50%", transform: "translateX(-50%)" }
            : overlay.position === "center"
              ? { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
              : { bottom: "10%", left: "50%", transform: "translateX(-50%)" }

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              ...positionStyle,
              opacity,
              color: overlay.color,
              fontSize: overlay.fontSize,
              fontWeight: "bold",
              textShadow: "2px 2px 8px rgba(0,0,0,0.8)",
              textAlign: "center",
              maxWidth: "80%",
              zIndex: 10,
            }}
          >
            {overlay.text}
          </div>
        )
      })}
    </>
  )
}

export const Slideshow: React.FC<RenderVideoInputProps> = (props) => {
  const {
    mediaAssets,
    audioTrackLocalPath,
    durationInFrames,
    transitionDurationFrames,
    textOverlays,
    backgroundColor,
    kenBurnsEnabled,
    width,
    height,
  } = props

  const imageAssets = mediaAssets.filter((a) => a.type === "image" || a.type === "video")
  const assetCount = imageAssets.length || 1
  const framesPerAsset = Math.floor(durationInFrames / assetCount)

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {imageAssets.map((asset, i) => (
        <Sequence key={i} from={i * framesPerAsset} durationInFrames={framesPerAsset + transitionDurationFrames}>
          <MediaSegment
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

      {audioTrackLocalPath && (
        <Audio src={staticFile(audioTrackLocalPath)} />
      )}
    </AbsoluteFill>
  )
}
