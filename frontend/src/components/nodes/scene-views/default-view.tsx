import type { SceneViewProps } from "./view-mode-registry"
import { registerSceneView } from "./view-mode-registry"

function DefaultView({ data }: SceneViewProps) {
  const shotCount = data.shots?.length ?? 0
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs uppercase text-zinc-500 dark:text-zinc-400">Scene {data.scene_index}</div>
      <div className="font-medium text-sm truncate text-zinc-900 dark:text-zinc-100">{data.label ?? data.description ?? "Untitled scene"}</div>
      <div className="text-xs text-zinc-600 dark:text-zinc-300">
        {shotCount} shot{shotCount === 1 ? "" : "s"} · {data.duration_seconds}s
      </div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
        {data.video_model} · {data.shot_input_mode}
      </div>
    </div>
  )
}

registerSceneView("default", DefaultView)
export { DefaultView }
