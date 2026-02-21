import { useMemo } from "react"
import { MotionGraphicsRenderer } from "@remotion-pkg/compositions/motion-graphics-renderer"
import type { MotionGraphicsPlan } from "@remotion-pkg/plan-types"
import { RemotionPlayerPreview } from "./remotion-player-preview"

interface MotionGraphicsPlayerPreviewProps {
  motionPlan: Record<string, unknown>
  fps: number
}

export function MotionGraphicsPlayerPreview({ motionPlan, fps }: MotionGraphicsPlayerPreviewProps) {
  const plan = motionPlan as unknown as MotionGraphicsPlan
  const width = plan.width ?? 1920
  const height = plan.height ?? 1080
  const durationInFrames = plan.durationInFrames ?? Math.round(fps * 5)

  const inputProps = useMemo(() => ({ plan }), [plan])

  return (
    <RemotionPlayerPreview
      component={MotionGraphicsRenderer}
      inputProps={inputProps}
      durationInFrames={durationInFrames}
      fps={fps}
      width={width}
      height={height}
    />
  )
}
