import React from "react"
import { AbsoluteFill, Sequence } from "remotion"
import type { SceneGraphInputProps, MediaTrack, TextTrack, AudioTrack } from "../scene-graph"
import { SceneMediaSegment } from "../lib/scene-media-segment"
import { SceneTextSegment } from "../lib/scene-text-segment"
import { SceneAudioTrack } from "../lib/scene-audio-track"

function RenderMediaTrack({
  track,
  width,
  height,
}: {
  track: MediaTrack
  width: number
  height: number
}) {
  return (
    <AbsoluteFill style={{ zIndex: track.zIndex }}>
      {track.segments.map((segment) => (
        <Sequence
          key={segment.id}
          from={segment.startFrame}
          durationInFrames={segment.durationInFrames}
        >
          <SceneMediaSegment
            segment={segment}
            containerWidth={width}
            containerHeight={height}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}

function RenderTextTrack({ track }: { track: TextTrack }) {
  return (
    <AbsoluteFill style={{ zIndex: track.zIndex }}>
      {track.segments.map((segment) => (
        <Sequence
          key={segment.id}
          from={segment.startFrame}
          durationInFrames={segment.durationInFrames}
        >
          <SceneTextSegment segment={segment} />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}

function RenderAudioTrack({
  track,
  totalDurationInFrames,
}: {
  track: AudioTrack
  totalDurationInFrames: number
}) {
  return (
    <SceneAudioTrack track={track} totalDurationInFrames={totalDurationInFrames} />
  )
}

/**
 * Generic Remotion composition that renders any scene graph.
 * Replaces the 4 hardcoded template compositions with one flexible renderer.
 */
export function SceneGraphRenderer({ sceneGraph }: SceneGraphInputProps) {
  const { width, height, backgroundColor, durationInFrames, tracks } = sceneGraph

  // Sort tracks by zIndex for rendering order (audio tracks have no zIndex)
  const sortedTracks = [...tracks].sort((a, b) => {
    const zA = a.type === "audio" ? -1 : a.zIndex
    const zB = b.type === "audio" ? -1 : b.zIndex
    return zA - zB
  })

  return (
    <AbsoluteFill style={{ backgroundColor, width, height }}>
      {sortedTracks.map((track) => {
        switch (track.type) {
          case "media":
            return (
              <RenderMediaTrack
                key={track.id}
                track={track}
                width={width}
                height={height}
              />
            )
          case "text":
            return <RenderTextTrack key={track.id} track={track} />
          case "audio":
            return (
              <RenderAudioTrack
                key={track.id}
                track={track}
                totalDurationInFrames={durationInFrames}
              />
            )
        }
      })}
    </AbsoluteFill>
  )
}
