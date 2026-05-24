import type { SceneViewProps } from "./view-mode-registry"
import { registerSceneView } from "./view-mode-registry"

/**
 * ScriptingView — Phase 1B.2 view-mode for the pipeline SceneNode.
 *
 * Renders a screenplay-style read-out of the shot list: for each shot, the
 * action line, the dialogue line (when present), and the per-shot duration.
 * This is the view a writer or director switches to when iterating on the
 * narrative before committing to keyframes. Provider/model picks and
 * camera-language live elsewhere — this view stays close to the script.
 */
function ScriptingView({ data }: SceneViewProps) {
  const shots = data.shots ?? []

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase text-zinc-500 dark:text-zinc-400">Scene {data.scene_index}</div>
        <div className="text-[10px] text-zinc-500 dark:text-zinc-400">{data.emotional_beat}</div>
      </div>
      {data.description && (
        <p className="text-[11px] text-zinc-600 dark:text-zinc-300 line-clamp-2">{data.description}</p>
      )}
      {shots.length === 0 ? (
        <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-zinc-200 dark:border-[#2D2D2D] text-[10px] text-zinc-400 dark:text-zinc-500">
          No shots yet
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {shots.map((shot) => (
            <div
              key={shot.shot_id}
              className="flex flex-col gap-0.5 rounded border border-zinc-200 dark:border-[#2D2D2D] bg-zinc-50/60 dark:bg-[#2D2D2D]/40 p-1.5"
            >
              <div className="flex items-center justify-between text-[9px] text-zinc-500 dark:text-zinc-400">
                <span className="font-mono">{shot.shot_id}</span>
                <span>{shot.duration_seconds}s · {shot.camera.shot_type}</span>
              </div>
              <p className="text-[11px] text-zinc-700 dark:text-zinc-200 line-clamp-2">{shot.action}</p>
              {shot.dialogue_line && (
                <p className="text-[11px] italic text-zinc-600 dark:text-zinc-300 line-clamp-2">
                  &ldquo;{shot.dialogue_line}&rdquo;
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
        {shots.length} shot{shots.length === 1 ? "" : "s"} · {data.duration_seconds}s total
      </div>
    </div>
  )
}

registerSceneView("scripting", ScriptingView)
export { ScriptingView }
