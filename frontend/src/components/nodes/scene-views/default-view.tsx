import type { SceneViewProps } from "./view-mode-registry"
import { registerSceneView } from "./view-mode-registry"
import { useT } from "@/lib/i18n"

function DefaultView({ data }: SceneViewProps) {
  const t = useT()
  const shotCount = data.shots?.length ?? 0
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs uppercase text-zinc-500 dark:text-zinc-400">{t("node.sceneN", { n: data.scene_index })}</div>
      <div className="text-xs text-zinc-600 dark:text-zinc-300">
        {shotCount === 1 ? t("node.shotCountOne", { n: shotCount }) : t("node.shotCountMany", { n: shotCount })} · {data.duration_seconds}s
      </div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
        {data.video_model} · {data.shot_input_mode}
      </div>
    </div>
  )
}

registerSceneView("default", DefaultView)
export { DefaultView }
