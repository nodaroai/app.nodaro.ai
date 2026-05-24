import type { SceneViewProps } from "./view-mode-registry"
import { registerSceneView } from "./view-mode-registry"

/**
 * StoryboardView — Phase 1B.2 default view-mode for the pipeline SceneNode.
 *
 * Renders the shot list as a horizontal keyframe grid: one tile per shot with
 * shot index, duration, and a thumbnail when the corresponding keyframe asset
 * is present on `data.generated_keyframes`. Phase 1B.2 always renders the
 * placeholder (keyframes are populated in Phase 1C); the tile + duration
 * layout is the user-visible contract this view owns.
 */
function StoryboardView({ data }: SceneViewProps) {
  const shots = data.shots ?? []
  const keyframes = data.generated_keyframes ?? []

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase text-zinc-500 dark:text-zinc-400">Scene {data.scene_index}</div>
        <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
          {shots.length} shot{shots.length === 1 ? "" : "s"} · {data.duration_seconds}s
        </div>
      </div>
      {shots.length === 0 ? (
        <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-zinc-200 dark:border-[#2D2D2D] text-[10px] text-zinc-400 dark:text-zinc-500">
          No shots yet
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          {shots.map((shot, idx) => {
            const keyframeUrl = keyframes[idx]?.url
            return (
              <div
                key={shot.shot_id}
                className="flex flex-col gap-0.5"
                title={`${shot.shot_id} · ${shot.action}`}
              >
                <div className="relative aspect-video rounded-sm bg-zinc-100 dark:bg-[#2D2D2D] overflow-hidden">
                  {keyframeUrl ? (
                    <img
                      src={keyframeUrl}
                      alt={shot.shot_id}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-[8px] text-zinc-400 dark:text-zinc-500">
                      {idx + 1}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between text-[8px] text-zinc-500 dark:text-zinc-400">
                  <span className="font-mono truncate">{shot.shot_id.replace(/^shot_/, "#")}</span>
                  <span>{shot.duration_seconds}s</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
        {data.video_model} · {data.shot_input_mode}
      </div>
    </div>
  )
}

registerSceneView("storyboard", StoryboardView)
export { StoryboardView }
