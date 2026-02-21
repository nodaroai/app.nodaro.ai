import { useMemo } from "react"
import { AfterEffectsRenderer } from "@remotion-pkg/compositions/after-effects-renderer"
import type { AfterEffectsPlan } from "@remotion-pkg/plan-types"
import { RemotionPlayerPreview } from "./remotion-player-preview"

interface AfterEffectsPlayerPreviewProps {
  effectPlan: Record<string, unknown>
  fps: number
}

export function AfterEffectsPlayerPreview({ effectPlan, fps }: AfterEffectsPlayerPreviewProps) {
  const plan = effectPlan as unknown as AfterEffectsPlan
  const width = plan.width ?? 1920
  const height = plan.height ?? 1080
  const durationInFrames = plan.durationInFrames ?? Math.round(fps * 10)

  const inputProps = useMemo(() => ({ plan }), [plan])

  return (
    <RemotionPlayerPreview
      component={AfterEffectsRenderer}
      inputProps={inputProps}
      durationInFrames={durationInFrames}
      fps={fps}
      width={width}
      height={height}
    />
  )
}
