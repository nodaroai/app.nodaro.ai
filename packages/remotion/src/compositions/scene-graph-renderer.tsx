import React from "react"
import { AbsoluteFill, Sequence } from "remotion"
import type { SceneGraphInputProps, MediaTrack, TextTrack, AudioTrack } from "../scene-graph"
import { SceneMediaSegment } from "../lib/scene-media-segment"
import { SceneTextSegment } from "../lib/scene-text-segment"
import { SceneAudioTrack } from "../lib/scene-audio-track"

/**
 * Error boundary that catches rendering errors in individual tracks
 * and logs them instead of crashing the entire composition.
 */
class TrackErrorBoundary extends React.Component<
  { trackId: string; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { trackId: string; children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    console.error(`[scene-graph] Track "${this.props.trackId}" render error:`, error.message)
  }

  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

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
      {sortedTracks.map((track) => (
        <TrackErrorBoundary key={track.id} trackId={track.id}>
          {track.type === "media" && (
            <RenderMediaTrack
              track={track}
              width={width}
              height={height}
            />
          )}
          {track.type === "text" && (
            <RenderTextTrack track={track} />
          )}
          {track.type === "audio" && (
            <RenderAudioTrack
              track={track}
              totalDurationInFrames={durationInFrames}
            />
          )}
        </TrackErrorBoundary>
      ))}
    </AbsoluteFill>
  )
}
