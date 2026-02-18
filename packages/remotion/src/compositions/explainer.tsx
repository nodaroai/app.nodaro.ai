import React from "react"
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  useCurrentFrame,
  interpolate,
} from "remotion"
import type { RenderVideoInputProps } from "../types"
import { TextOverlayLayer } from "../lib/text-overlay"

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

/**
 * Explainer template: slide-in transitions on images with text overlays,
 * synced to optional voiceover audio.
 */
export function Explainer(props: RenderVideoInputProps) {
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
        const localFrame = frame - from
        return (
          <Sequence key={i} from={from} durationInFrames={framesPerSegment}>
            <AbsoluteFill
              style={{
                opacity: interpolate(localFrame, [0, transitionDurationFrames], [0, 1], CLAMP),
                transform: `translateX(${interpolate(localFrame, [0, transitionDurationFrames], [30, 0], CLAMP)}px)`,
              }}
            >
              <Img
                src={asset.localPath}
                style={{ width, height, objectFit: "cover" }}
              />
            </AbsoluteFill>
          </Sequence>
        )
      })}

      <TextOverlayLayer
        overlays={textOverlays}
        fadeFrames={15}
        style={{
          textShadow: "2px 2px 12px rgba(0,0,0,0.9)",
          maxWidth: "85%",
          lineHeight: 1.3,
        }}
      />

      {audioTrackLocalPath && (
        <Audio src={audioTrackLocalPath} />
      )}
    </AbsoluteFill>
  )
}
