import type React from "react"
import { Easing } from "remotion"
import type { MGElementAnimation, MGExitAnimation } from "../plan-types"

export const EASING_MAP: Record<string, (t: number) => number> = {
  linear: Easing.linear,
  easeIn: Easing.ease,
  easeOut: Easing.out(Easing.ease),
  easeInOut: Easing.inOut(Easing.ease),
  spring: Easing.bezier(0.22, 1, 0.36, 1),
}

export function getEasing(name?: string): ((t: number) => number) | undefined {
  if (!name) return undefined
  return EASING_MAP[name]
}

export function getWipeClipPath(progress: number, direction?: string): string {
  switch (direction) {
    case "right":
      return `inset(0 ${(1 - progress) * 100}% 0 0)`
    case "up":
      return `inset(${(1 - progress) * 100}% 0 0 0)`
    case "down":
      return `inset(0 0 ${(1 - progress) * 100}% 0)`
    case "left":
    default:
      return `inset(0 0 0 ${(1 - progress) * 100}%)`
  }
}

export function getEntranceStyle(
  progress: number,
  anim: Pick<MGElementAnimation, "type" | "direction">,
): React.CSSProperties {
  switch (anim.type) {
    case "fade":
      return { opacity: progress }
    case "scale-up":
      return { transform: `scale(${progress})`, opacity: progress }
    case "slide-up":
      return { transform: `translateY(${(1 - progress) * 40}px)`, opacity: progress }
    case "slide-down":
      return { transform: `translateY(${-(1 - progress) * 40}px)`, opacity: progress }
    case "slide-left":
      return { transform: `translateX(${(1 - progress) * 60}px)`, opacity: progress }
    case "slide-right":
      return { transform: `translateX(${-(1 - progress) * 60}px)`, opacity: progress }
    case "wipe-in":
      return { clipPath: getWipeClipPath(progress, anim.direction) }
    case "draw-path":
    case "none":
      return {}
    default:
      return {}
  }
}

export function getExitStyle(
  progress: number,
  exit: Pick<MGExitAnimation, "type">,
): React.CSSProperties {
  switch (exit.type) {
    case "fade":
      return { opacity: progress }
    case "slide-down":
      return { transform: `translateY(${(1 - progress) * 40}px)`, opacity: progress }
    case "slide-up":
      return { transform: `translateY(${-(1 - progress) * 40}px)`, opacity: progress }
    case "slide-left":
      return { transform: `translateX(${-(1 - progress) * 60}px)`, opacity: progress }
    case "slide-right":
      return { transform: `translateX(${(1 - progress) * 60}px)`, opacity: progress }
    default:
      return {}
  }
}
