import { useMemo } from "react"
import { LottieGraphicRenderer } from "@remotion-pkg/compositions/lottie-graphic-renderer"
import type { LottieGraphicPlan } from "@remotion-pkg/plan-types"
import { RemotionPlayerPreview } from "./remotion-player-preview"

interface LottieGraphicPlayerPreviewProps {
  motionPlan: Record<string, unknown>
  fps: number
}

export function LottieGraphicPlayerPreview({ motionPlan, fps }: LottieGraphicPlayerPreviewProps) {
  const plan = motionPlan as unknown as LottieGraphicPlan
  const width = plan.width ?? 1920
  const height = plan.height ?? 1080
  const durationInFrames = plan.durationInFrames ?? Math.round(fps * 5)

  const inputProps = useMemo(() => ({ plan }), [plan])

  return (
    <RemotionPlayerPreview
      component={LottieGraphicRenderer}
      inputProps={inputProps}
      durationInFrames={durationInFrames}
      // plan.fps is intrinsic to the authored Lottie; prefer it over node fps for parity
      fps={plan.fps ?? fps}
      width={width}
      height={height}
    />
  )
}
