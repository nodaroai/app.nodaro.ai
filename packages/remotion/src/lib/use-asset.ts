import { interpolate, useCurrentFrame } from "remotion"

/**
 * Calculate opacity for a crossfade transition between media segments.
 * NOTE: useCurrentFrame() returns local frames inside a <Sequence>, starting from 0.
 */
export function useAssetTransition(
  assetIndex: number,
  assetCount: number,
  framesPerAsset: number,
  transitionFrames: number,
): { opacity: number; visible: boolean } {
  const frame = useCurrentFrame() // local frame within the Sequence (0-based)

  if (frame > framesPerAsset + transitionFrames) {
    return { opacity: 0, visible: false }
  }

  let opacity = 1

  // Fade in (not for the first asset)
  if (transitionFrames > 0 && assetIndex > 0 && frame < transitionFrames) {
    opacity = interpolate(frame, [0, transitionFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  }

  // Fade out (not for the last asset)
  if (transitionFrames > 0 && assetIndex < assetCount - 1 && frame > framesPerAsset - transitionFrames) {
    opacity = interpolate(frame, [framesPerAsset - transitionFrames, framesPerAsset], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  }

  return { opacity, visible: opacity >= 0 }
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
