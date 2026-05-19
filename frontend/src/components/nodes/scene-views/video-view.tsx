import type { SceneViewProps } from "./view-mode-registry"
import { registerSceneView } from "./view-mode-registry"

/**
 * VideoView — Phase 1C.1 playable view-mode for the pipeline SceneNode.
 *
 * Renders the composite_video produced by Stage 7 (animate_audio_edit) as a
 * native HTML5 `<video controls>` element. The shape supports either of two
 * field shapes the orchestrator may write:
 *   - The flat `composite_video_url` + `composite_video_asset_id` fields
 *     (added in Phase 1C.1 F1).
 *   - The legacy nested `composite_video: { asset_id, url }` AssetRef
 *     (kept for backward compatibility with older pipeline runs).
 *
 * Empty-state — when neither field is populated (Stage 7 hasn't run yet) we
 * render a dashed placeholder with the per-clip count so the user knows
 * progress is visible before the composite lands.
 *
 * Poster — when shots[0].keyframe_url is available we use it as the video's
 * `poster` attribute so the frame the user sees before pressing Play matches
 * the scene's opening visual.
 */
function VideoView({ data }: SceneViewProps) {
  const compositeUrl =
    data.composite_video_url ?? data.composite_video?.url ?? null
  const clips = data.generated_clips ?? []
  const firstKeyframeUrl =
    data.shots?.[0]?.keyframe_url ?? data.scene_anchor_keyframe?.url ?? undefined

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase text-zinc-500">Scene {data.scene_index}</div>
        <div className="text-[10px] text-zinc-500">{data.duration_seconds}s</div>
      </div>
      <div className="font-medium text-sm truncate">
        {data.label ?? data.description ?? "Untitled scene"}
      </div>
      {compositeUrl ? (
        <video
          controls
          src={compositeUrl}
          poster={firstKeyframeUrl}
          preload="metadata"
          className="aspect-video w-full rounded-md bg-zinc-900 object-contain"
        />
      ) : (
        <div className="flex flex-col items-center justify-center aspect-video rounded-md border-2 border-dashed border-zinc-200 text-[10px] text-zinc-400 gap-0.5">
          <span>Stage 7 will populate this view.</span>
          <span className="text-[9px]">
            {clips.length} clip{clips.length === 1 ? "" : "s"} rendered
          </span>
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
