import React from "react"
import { Audio, Sequence, useCurrentFrame, interpolate } from "remotion"
import type { AudioTrack } from "../scene-graph"

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

/**
 * Renders an audio track with fade-in/out volume control.
 */
export function SceneAudioTrack({
  track,
  totalDurationInFrames,
}: {
  track: AudioTrack
  totalDurationInFrames: number
}) {
  const frame = useCurrentFrame()
  const startFrame = track.startFrame ?? 0
  const audioDuration = totalDurationInFrames - startFrame

  let volume = track.volume

  // Fade in
  if (track.fadeInFrames > 0) {
    const fadeInProgress = interpolate(
      frame - startFrame,
      [0, track.fadeInFrames],
      [0, 1],
      CLAMP,
    )
    volume *= fadeInProgress
  }

  // Fade out
  if (track.fadeOutFrames > 0) {
    const fadeOutStart = audioDuration - track.fadeOutFrames
    const fadeOutProgress = interpolate(
      frame - startFrame,
      [fadeOutStart, audioDuration],
      [1, 0],
      CLAMP,
    )
    volume *= fadeOutProgress
  }

  return (
    <Sequence from={startFrame}>
      <Audio src={track.src} volume={volume} />
    </Sequence>
  )
}
