import { useEffect, useState } from "react"
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  delayRender,
  continueRender,
  cancelRender,
} from "remotion"
import { Lottie, type LottieAnimationData } from "@remotion/lottie"
import { resolveLottieOverlaySrc } from "@nodaro/shared"
import type { LottieOverlayPlan, LottieOverlayItem } from "../plan-types"

interface LottieOverlayRendererProps {
  readonly plan: LottieOverlayPlan
}

function LottieOverlayLayer({ overlay }: { readonly overlay: LottieOverlayItem }) {
  const [handle] = useState(() => delayRender(`Loading Lottie: ${overlay.id}`))
  const [animationData, setAnimationData] = useState<LottieAnimationData | null>(null)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)

    // Heal legacy plans: a `src` saved before the catalog cut-over still points
    // at a dead lottie.host URL (origin 403). resolveLottieOverlaySrc rewrites
    // it to its self-hosted replacement; user-provided/already-migrated URLs
    // pass through unchanged.
    const src = resolveLottieOverlaySrc(overlay.src)

    fetch(src, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch Lottie ${src}: ${res.status}`)
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
          const message = controller.signal.aborted
            ? `Lottie fetch timed out after 30s: ${src}`
            : err instanceof Error ? err.message : String(err)
          cancelRender(new Error(message))
        }
      })
      .finally(() => clearTimeout(timeout))

    return () => {
      cancelled = true
      controller.abort()
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
        renderer={overlay.renderer}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  )
}

export function LottieOverlayRenderer({ plan }: LottieOverlayRendererProps) {
  const { sourceVideo, overlays } = plan

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {/* Base video layer */}
      <AbsoluteFill>
        <OffthreadVideo
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
