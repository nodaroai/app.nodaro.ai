import type { SceneNodeFrontendData } from "@/types/nodes"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  ACTIVE_SCENE_HELPERS,
  SCENE_HELPER_NAMES,
  type SceneHelperName,
} from "@nodaro/shared"

/**
 * §6.11 Scene-Context helper buttons — one row of 10 actions on the SceneNode
 * config panel. Phase 1C.1 activated the 3 vision-keyframe helpers
 * (audit_images / fix_continuity / validate_match_cut), so all 10 helpers
 * are now first-class active actions.
 *
 * The canonical helper-name catalog lives in `@nodaro/shared`
 * (`SCENE_HELPER_NAMES` + `ACTIVE_SCENE_HELPERS`), so this component is
 * automatically in lockstep with the backend Zod schema and the type-checked
 * registry in `backend/src/routes/scene-helpers.ts`. Adding a new helper to
 * the shared list will trigger a TS error here (missing `HELPER_LABELS`
 * entry).
 *
 * A button is enabled when:
 *  - The host scene is bound to a pipeline_id + pipeline_entity_id
 *  - The scene has at least one shot (Scene Director has populated data.shots)
 *  - The helper is in `ACTIVE_SCENE_HELPERS` (currently all 10)
 *  - No helper is currently in-flight (`isLoading=false`) — prevents the
 *    double-click race that would fire two LLM calls and reserve credits
 *    twice (caller passes `state.status === "loading"` from useSceneHelper).
 */
interface Props {
  pipelineId: string | undefined
  sceneEntityId: string | undefined
  data: SceneNodeFrontendData
  isLoading: boolean
  onInvoke: (helperName: SceneHelperName) => void
}

const HELPER_LABELS: Record<
  SceneHelperName,
  { icon: string; label: string; tooltip: string }
> = {
  audit_prompt: {
    icon: "🔍",
    label: "Audit Prompt",
    tooltip: "Check shots for contradictions with the scene.",
  },
  improve_prompt: {
    icon: "✨",
    label: "Improve Prompt",
    tooltip: "Rewrite a shot's action / motion / dialogue.",
  },
  generate_motion: {
    icon: "🎬",
    label: "Generate Motion",
    tooltip: "Fill motion_prompt for shots missing one.",
  },
  optimize_for_model: {
    icon: "🎯",
    label: "Optimize for Model",
    tooltip: "Rewrite all shots for the current video_model's style.",
  },
  add_broll: {
    icon: "🎞️",
    label: "Add B-Roll",
    tooltip: "Propose insert shots (reaction / cutaway / etc.).",
  },
  bridge_to_next_scene: {
    icon: "🌉",
    label: "Bridge to Next",
    tooltip: "Generate i2i edit prompt to transition the prior shot's last frame.",
  },
  anchor_scene_style: {
    icon: "🎨",
    label: "Anchor Style",
    tooltip: "Generate a master keyframe to lock style across this scene.",
  },
  audit_images: {
    icon: "🔍",
    label: "Audit Images",
    tooltip: "Run the Image Critic on every keyframe in this scene.",
  },
  fix_continuity: {
    icon: "🔗",
    label: "Fix Continuity",
    tooltip:
      "Check a shot's keyframe against the prior shot's last frame; regenerate if continuity breaks.",
  },
  validate_match_cut: {
    icon: "🎯",
    label: "Validate Match Cut",
    tooltip:
      "Evaluate the match-cut quality between a shot and the next (requires shot_intent.is_match_cut).",
  },
}

export function SceneHelperButtons({
  pipelineId,
  sceneEntityId,
  data,
  isLoading,
  onInvoke,
}: Props) {
  const ready = !!pipelineId && !!sceneEntityId && data.shots.length > 0
  return (
    <TooltipProvider>
      <div className="flex flex-wrap gap-1">
        {SCENE_HELPER_NAMES.map((name) => {
          const meta = HELPER_LABELS[name]
          const active = ACTIVE_SCENE_HELPERS.has(name)
          const enabled = ready && active && !isLoading
          return (
            <Tooltip key={name}>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant={active ? "outline" : "ghost"}
                  disabled={!enabled}
                  onClick={() => enabled && onInvoke(name)}
                  className="text-xs"
                >
                  <span className="mr-1">{meta.icon}</span>
                  {meta.label}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{meta.tooltip}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
