import type { SceneViewProps } from "./view-mode-registry"
import { registerSceneView } from "./view-mode-registry"

/**
 * VideoView — Phase 1C placeholder view-mode for the pipeline SceneNode.
 *
 * When the scene has a composite_video asset (set by Stage 7 in Phase 1C),
 * this view will render the rendered scene clip with playback controls.
 * Phase 1B.2 ships the contract only: the registry slot is wired, and the
 * view degrades gracefully when no composite is present (which is always
 * the case in 1B.2). The actual <video> element + scrubber lands in 1C.
 */
function VideoView({ data }: SceneViewProps) {
  const composite = data.composite_video
  const clips = data.generated_clips ?? []

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase text-zinc-500">Scene {data.scene_index}</div>
        <div className="text-[10px] text-zinc-500">{data.duration_seconds}s</div>
      </div>
      <div className="font-medium text-sm truncate">
        {data.label ?? data.description ?? "Untitled scene"}
      </div>
      {composite?.url ? (
        // Phase 1C will replace this with a real <video controls> element + scrubber.
        <div
          className="flex items-center justify-center aspect-video rounded-md bg-zinc-900 text-[10px] text-zinc-300"
          title={composite.asset_id}
        >
          Composite ready
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center aspect-video rounded-md border-2 border-dashed border-zinc-200 text-[10px] text-zinc-400 gap-0.5">
          <span>No composite yet</span>
          <span className="text-[9px]">{clips.length} clip{clips.length === 1 ? "" : "s"} rendered</span>
        </div>
      )}
      <div className="text-[10px] text-zinc-500">
        {data.video_model} · {data.shot_input_mode}
      </div>
    </div>
  )
}

registerSceneView("video", VideoView)
export { VideoView }
