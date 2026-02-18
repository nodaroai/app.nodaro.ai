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
  spring,
  useVideoConfig,
} from "remotion"
import type { RenderVideoInputProps } from "../types"

/**
 * Social Reel template: 9:16 format, fast zoom/slide transitions,
 * large word-highlight captions for social media.
 */
export const SocialReel: React.FC<RenderVideoInputProps> = (props) => {
  const {
    mediaAssets,
    audioTrackLocalPath,
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

        // Fast zoom-in entrance
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
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                ),
              }}
            >
              {asset.type === "image" ? (
                <Img
                  src={staticFile(asset.localPath)}
                  style={{
                    width,
                    height,
                    objectFit: "cover",
                    transform: `scale(${scale})`,
                  }}
                />
              ) : (
                <Video
                  src={staticFile(asset.localPath)}
                  style={{ width, height, objectFit: "cover" }}
                />
              )}
            </AbsoluteFill>
          </Sequence>
        )
      })}

      {/* Large word-highlight captions */}
      {captions.enabled && textOverlays.map((overlay, i) => {
        if (frame < overlay.startFrame || frame > overlay.endFrame) return null
        const words = overlay.text.split(/\s+/)
        const totalFrames = overlay.endFrame - overlay.startFrame
        const progress = (frame - overlay.startFrame) / totalFrames
        const highlightIndex = Math.min(Math.floor(progress * words.length), words.length - 1)

        const yPos = captions.position === "top" ? "12%" : captions.position === "center" ? "50%" : "82%"

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: yPos,
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

      {/* Standard text overlays */}
      {textOverlays.filter((o) => !captions.enabled).map((overlay, i) => {
        if (frame < overlay.startFrame || frame > overlay.endFrame) return null
        return (
          <div
            key={`txt-${i}`}
            style={{
              position: "absolute",
              bottom: "15%",
              left: "50%",
              transform: "translateX(-50%)",
              color: overlay.color,
              fontSize: overlay.fontSize,
              fontWeight: "bold",
              textShadow: "2px 2px 8px rgba(0,0,0,0.8)",
              textAlign: "center",
              maxWidth: "85%",
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
