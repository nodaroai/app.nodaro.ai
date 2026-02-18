import { interpolate, useCurrentFrame } from "remotion"

/**
 * Calculate opacity for a crossfade transition between media segments.
 */
export function useAssetTransition(
  assetIndex: number,
  assetCount: number,
  framesPerAsset: number,
  transitionFrames: number,
): { opacity: number; visible: boolean } {
  const frame = useCurrentFrame()
  const startFrame = assetIndex * framesPerAsset
  const endFrame = startFrame + framesPerAsset

  if (frame < startFrame - transitionFrames || frame > endFrame + transitionFrames) {
    return { opacity: 0, visible: false }
  }

  let opacity = 1

  // Fade in
  if (transitionFrames > 0 && assetIndex > 0 && frame < startFrame + transitionFrames) {
    opacity = interpolate(frame, [startFrame, startFrame + transitionFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  }

  // Fade out
  if (transitionFrames > 0 && assetIndex < assetCount - 1 && frame > endFrame - transitionFrames) {
    opacity = interpolate(frame, [endFrame - transitionFrames, endFrame], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  }

  return { opacity, visible: opacity > 0 }
}

/**
 * Ken Burns pan/zoom effect — slow zoom-in with slight pan.
 */
export function useKenBurns(
  enabled: boolean,
  durationFrames: number,
): { scale: number; translateX: number; translateY: number } {
  const frame = useCurrentFrame()

  if (!enabled) {
    return { scale: 1, translateX: 0, translateY: 0 }
  }

  const progress = interpolate(frame % durationFrames, [0, durationFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  const scale = interpolate(progress, [0, 1], [1, 1.15])
  const translateX = interpolate(progress, [0, 1], [0, -2])
  const translateY = interpolate(progress, [0, 1], [0, -1.5])

  return { scale, translateX, translateY }
}

/**
 * Calculate which caption word should be highlighted at the current frame.
 */
export function useCaptionTiming(
  text: string,
  startFrame: number,
  endFrame: number,
): { visibleText: string; highlightedWordIndex: number } {
  const frame = useCurrentFrame()
  const words = text.split(/\s+/)
  const totalFrames = endFrame - startFrame

  if (frame < startFrame || frame > endFrame || words.length === 0) {
    return { visibleText: "", highlightedWordIndex: -1 }
  }

  const progress = (frame - startFrame) / totalFrames
  const highlightedWordIndex = Math.min(
    Math.floor(progress * words.length),
    words.length - 1,
  )

  return { visibleText: text, highlightedWordIndex }
}
