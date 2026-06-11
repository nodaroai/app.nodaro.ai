import React, { useMemo } from "react"
import { AbsoluteFill } from "remotion"
import { Lottie, type LottieAnimationData } from "@remotion/lottie"
import { applySlots } from "@nodaro/shared"
import type { LottieGraphicPlan } from "../plan-types"
import { useLottieInitWatchdog } from "../lib/lottie-init-watchdog"
import "../lib/font-registry"

interface LottieGraphicRendererProps {
  readonly plan: LottieGraphicPlan
}

export function LottieGraphicRenderer({ plan }: LottieGraphicRendererProps) {
  const animationData = useMemo(
    () => applySlots(plan.lottie, plan.slots, plan.slotValues) as unknown as LottieAnimationData,
    [plan],
  )
  const onAnimationLoaded = useLottieInitWatchdog("lottie-graphic")
  return (
    <AbsoluteFill style={{ backgroundColor: plan.backgroundColor }}>
      <Lottie
        animationData={animationData}
        onAnimationLoaded={onAnimationLoaded}
        style={{ width: "100%", height: "100%" }}
      />
    </AbsoluteFill>
  )
}
