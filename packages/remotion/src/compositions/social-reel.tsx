import React from "react"
import {
  AbsoluteFill,
  Audio,
  Sequence,
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
} from "remotion"
import type { RenderVideoInputProps, CaptionSettings, CaptionPosition, TextOverlay } from "../types"
import { MediaItem } from "../lib/media-item"
import { TextOverlayLayer } from "../lib/text-overlay"

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

function getCaptionYPosition(position: CaptionPosition): string {
  switch (position) {
    case "top": return "12%"
    case "center": return "50%"
    case "bottom": return "82%"
  }
}

/**
 * Word-highlight captions: highlights the current word based on playback progress.
 */
function WordHighlightCaptions({
  overlays,
  captions,
}: {
  overlays: readonly TextOverlay[]
  captions: CaptionSettings
}) {
  const frame = useCurrentFrame()

  return (
    <>
      {overlays.map((overlay, i) => {
        if (frame < overlay.startFrame || frame > overlay.endFrame) return null
        const words = overlay.text.split(/\s+/)
        const totalFrames = overlay.endFrame - overlay.startFrame
        const progress = (frame - overlay.startFrame) / totalFrames
        const highlightIndex = Math.min(Math.floor(progress * words.length), words.length - 1)

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: getCaptionYPosition(captions.position),
              left: "50%",
              transform: "translateX(-50%)",
              textAlign: "center",
              maxWidth: "90%",
              zIndex: 20,
            }}
          >
            {words.map((word, wi) => (
              <span
                key={wi}
                style={{
                  fontSize: captions.fontSize * 1.5,
                  fontWeight: 900,
                  color: wi === highlightIndex ? "#FFD700" : captions.color,
                  textShadow: "3px 3px 12px rgba(0,0,0,0.9)",
                  transition: "color 0.1s",
                  marginRight: 8,
                }}
              >
                {word}
              </span>
            ))}
          </div>
        )
      })}
    </>
  )
}

/**
 * Social Reel template: 9:16 format, spring zoom-in transitions,
 * word-highlight captions for social media.
 */
export function SocialReel(props: RenderVideoInputProps) {
  const {
    mediaAssets,
    audioTrackUrl,
    durationInFrames,
    transitionDurationFrames,
    textOverlays,
    captions,
    backgroundColor,
    width,
    height,
  } = props

  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const visualAssets = mediaAssets.filter((a) => a.type === "image" || a.type === "video")
  const assetCount = visualAssets.length || 1
  const framesPerAsset = Math.floor(durationInFrames / assetCount)

  return (
    <AbsoluteFill style={{ backgroundColor }}>
      {visualAssets.map((asset, i) => {
        const from = i * framesPerAsset
        const scaleSpring = spring({
          frame: frame - from,
          fps,
          config: { damping: 15, stiffness: 120 },
        })
        const scale = interpolate(scaleSpring, [0, 1], [1.3, 1])

        return (
          <Sequence key={i} from={from} durationInFrames={framesPerAsset + transitionDurationFrames}>
            <AbsoluteFill
              style={{
                opacity: interpolate(
                  frame - from,
                  [0, Math.min(transitionDurationFrames, 8), framesPerAsset - 5, framesPerAsset],
                  [0, 1, 1, 0],
                  CLAMP,
                ),
                transform: asset.type === "image" ? `scale(${scale})` : undefined,
              }}
            >
              <MediaItem asset={asset} width={width} height={height} />
            </AbsoluteFill>
          </Sequence>
        )
      })}

      {captions.enabled ? (
        <WordHighlightCaptions overlays={textOverlays} captions={captions} />
      ) : (
        <TextOverlayLayer
          overlays={textOverlays}
          style={{ bottom: "15%", top: undefined, maxWidth: "85%" }}
        />
      )}

      {audioTrackUrl && <Audio src={audioTrackUrl} />}
    </AbsoluteFill>
  )
}
