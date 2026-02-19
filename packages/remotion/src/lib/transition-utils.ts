import { interpolate, spring } from "remotion"
import type { Transition, TransitionType } from "../scene-graph"

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

export interface TransitionResult {
  opacity: number
  transform: string | undefined
}

/**
 * Compute the CSS opacity + transform for a transition-in at a given local frame.
 * Frame 0 = start of segment; transition plays over [0, durationFrames].
 */
export function computeTransitionIn(
  transition: Transition | undefined,
  localFrame: number,
  fps: number,
): TransitionResult {
  if (!transition || transition.type === "none" || transition.durationFrames <= 0) {
    return { opacity: 1, transform: undefined }
  }

  const { type, durationFrames } = transition
  const progress = interpolate(localFrame, [0, durationFrames], [0, 1], CLAMP)

  return computeTransition(type, progress, localFrame, fps, "in")
}

/**
 * Compute the CSS opacity + transform for a transition-out at a given local frame.
 * segmentDuration = total segment frames. Transition plays over [segmentDuration - durationFrames, segmentDuration].
 */
export function computeTransitionOut(
  transition: Transition | undefined,
  localFrame: number,
  segmentDuration: number,
  fps: number,
): TransitionResult {
  if (!transition || transition.type === "none" || transition.durationFrames <= 0) {
    return { opacity: 1, transform: undefined }
  }

  const { type, durationFrames } = transition
  const outStart = segmentDuration - durationFrames
  if (localFrame < outStart) {
    return { opacity: 1, transform: undefined }
  }

  const progress = interpolate(localFrame, [outStart, segmentDuration], [1, 0], CLAMP)

  return computeTransition(type, progress, localFrame, fps, "out")
}

function computeTransition(
  type: TransitionType,
  progress: number,
  localFrame: number,
  fps: number,
  direction: "in" | "out",
): TransitionResult {
  switch (type) {
    case "fade":
    case "dissolve":
      return { opacity: progress, transform: undefined }

    case "slide-left": {
      const offset = (1 - progress) * (direction === "in" ? 100 : -100)
      return { opacity: 1, transform: `translateX(${offset}%)` }
    }

    case "slide-right": {
      const offset = (1 - progress) * (direction === "in" ? -100 : 100)
      return { opacity: 1, transform: `translateX(${offset}%)` }
    }

    case "slide-up": {
      const offset = (1 - progress) * (direction === "in" ? 100 : -100)
      return { opacity: 1, transform: `translateY(${offset}%)` }
    }

    case "slide-down": {
      const offset = (1 - progress) * (direction === "in" ? -100 : 100)
      return { opacity: 1, transform: `translateY(${offset}%)` }
    }

    case "zoom-in": {
      const scaleVal = spring({
        frame: Math.round(progress * fps * 0.5),
        fps,
        config: { damping: 15, stiffness: 120 },
      })
      const scale = direction === "in"
        ? interpolate(scaleVal, [0, 1], [1.3, 1])
        : interpolate(scaleVal, [0, 1], [1, 0.7])
      return { opacity: progress, transform: `scale(${scale})` }
    }

    case "zoom-out": {
      const scaleVal = spring({
        frame: Math.round(progress * fps * 0.5),
        fps,
        config: { damping: 15, stiffness: 120 },
      })
      const scale = direction === "in"
        ? interpolate(scaleVal, [0, 1], [0.7, 1])
        : interpolate(scaleVal, [0, 1], [1, 1.3])
      return { opacity: progress, transform: `scale(${scale})` }
    }

    case "none":
      return { opacity: 1, transform: undefined }
  }
}

/**
 * Combine transition-in and transition-out results into a single style.
 */
export function combineTransitions(
  transIn: TransitionResult,
  transOut: TransitionResult,
): { opacity: number; transform: string | undefined } {
  const opacity = transIn.opacity * transOut.opacity

  const transforms: string[] = []
  if (transIn.transform) transforms.push(transIn.transform)
  if (transOut.transform) transforms.push(transOut.transform)

  return {
    opacity,
    transform: transforms.length > 0 ? transforms.join(" ") : undefined,
  }
}
