import React, { useEffect, useState } from "react"
import {
  AbsoluteFill,
  Video,
  Sequence,
  delayRender,
  continueRender,
  cancelRender,
} from "remotion"
import { Lottie, type LottieAnimationData } from "@remotion/lottie"
import type { LottieOverlayPlan, LottieOverlayItem } from "../plan-types"

interface LottieOverlayRendererProps {
  readonly plan: LottieOverlayPlan
}

/**
 * Individual overlay layer that fetches its Lottie JSON independently.
 * Uses delayRender/continueRender to ensure the animation data is loaded
 * before Remotion renders the frame.
 */
function LottieOverlayLayer({ overlay }: { readonly overlay: LottieOverlayItem }) {
  // Create render handle synchronously on mount (before first frame)
  const [handle] = useState(() => delayRender(`Loading Lottie: ${overlay.id}`))
  const [animationData, setAnimationData] = useState<LottieAnimationData | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch(overlay.src)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch Lottie ${overlay.src}: ${res.status}`)
        return res.json()
      })
      .then((json) => {
        if (!cancelled) {
          setAnimationData(json)
          continueRender(handle)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          cancelRender(err)
        }
      })

    return () => {
      cancelled = true
    }
  }, [overlay.src, handle])

  if (!animationData) return null

  const { x, y, width, height } = overlay.position

  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        width: `${width}%`,
        height: `${height}%`,
        opacity: overlay.opacity,
      }}
    >
      <Lottie
        animationData={animationData}
        loop={overlay.loop}
        playbackRate={overlay.playbackRate}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  )
}

/**
 * Remotion composition that renders Lottie overlays on top of a source video.
 * Each overlay is wrapped in a Sequence for timing control.
 */
export function LottieOverlayRenderer({ plan }: LottieOverlayRendererProps) {
  const { sourceVideo, overlays } = plan

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {/* Base video layer */}
      <AbsoluteFill>
        <Video
          src={sourceVideo}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </AbsoluteFill>

      {/* Lottie overlay layers */}
      {overlays.map((overlay) => (
        <Sequence
          key={overlay.id}
          from={overlay.startFrame}
          durationInFrames={overlay.durationInFrames}
        >
          <AbsoluteFill>
            <LottieOverlayLayer overlay={overlay} />
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
