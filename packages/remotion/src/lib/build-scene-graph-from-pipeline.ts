import type { SceneGraph, MediaSegment, Track } from "../scene-graph"

/**
 * Phase 0 walking skeleton — build a Remotion SceneGraph from a Story→Video
 * pipeline's assembled timeline (the `GET /v1/pipelines/:id/timeline` payload):
 * each scene composite becomes one fullscreen video segment laid end-to-end,
 * with optional music + narration audio tracks layered across the whole reel.
 *
 * Timing is in FRAMES (Remotion's unit): durationInFrames = round(seconds * fps).
 * A clip with a missing/zero duration falls back to DEFAULT_CLIP_SECONDS so a
 * scene never collapses to 0 frames (which Remotion's <Sequence> rejects).
 */

export interface PipelineTimelineScene {
  readonly compositeUrl: string
  readonly durationSeconds: number
}

export interface PipelineTimelineInput {
  readonly fps: number
  readonly width: number
  readonly height: number
  readonly scenes: ReadonlyArray<PipelineTimelineScene>
  readonly musicUrl?: string
  readonly narrationUrl?: string
}

const DEFAULT_FPS = 30
const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 720
const DEFAULT_CLIP_SECONDS = 3
const MUSIC_VOLUME = 0.5
const NARRATION_VOLUME = 1

export function buildSceneGraphFromPipeline(
  input: PipelineTimelineInput,
): SceneGraph {
  const fps = input.fps > 0 ? input.fps : DEFAULT_FPS

  const segments: MediaSegment[] = []
  let cursorFrames = 0
  input.scenes.forEach((scene, index) => {
    const seconds =
      scene.durationSeconds > 0 ? scene.durationSeconds : DEFAULT_CLIP_SECONDS
    const durationInFrames = Math.max(1, Math.round(seconds * fps))
    segments.push({
      id: `scene-${index}`,
      src: scene.compositeUrl,
      mediaType: "video",
      startFrame: cursorFrames,
      durationInFrames,
      layout: { mode: "fullscreen", objectFit: "cover" },
      effects: [],
    })
    cursorFrames += durationInFrames
  })

  const durationInFrames = Math.max(1, cursorFrames)

  const tracks: Track[] = [{ type: "media", id: "scenes", zIndex: 0, segments }]
  if (input.musicUrl) {
    tracks.push({
      type: "audio",
      id: "music",
      src: input.musicUrl,
      volume: MUSIC_VOLUME,
      fadeInFrames: Math.round(fps * 0.5),
      fadeOutFrames: Math.round(fps * 0.8),
      startFrame: 0,
    })
  }
  if (input.narrationUrl) {
    tracks.push({
      type: "audio",
      id: "narration",
      src: input.narrationUrl,
      volume: NARRATION_VOLUME,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      startFrame: 0,
    })
  }

  return {
    fps,
    width: input.width > 0 ? input.width : DEFAULT_WIDTH,
    height: input.height > 0 ? input.height : DEFAULT_HEIGHT,
    durationInFrames,
    backgroundColor: "#000000",
    tracks,
  }
}
