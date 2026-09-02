import type { SceneNodeFrontendData } from "@/types/nodes"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ACTIVE_SCENE_HELPERS, SCENE_HELPER_NAMES, type SceneHelperName } from "@nodaro/shared"
import { useMemo } from "react"
import { tx, useT } from "@/lib/i18n"

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

/** Live getter — a module constant would freeze the labels to the boot locale. */
export function HELPER_LABELS(): Record<
  SceneHelperName,
  { icon: string; label: string; tooltip: string }
> {
  return {
  audit_prompt: {
    icon: "🔍",
    label: tx("cfgext.shbAuditPrompt"),
    tooltip: tx("cfgext.shbAuditPromptTip"),
  },
  improve_prompt: {
    icon: "✨",
    label: tx("cfgext.shbImprovePrompt"),
    tooltip: tx("cfgext.shbImprovePromptTip"),
  },
  generate_motion: {
    icon: "🎬",
    label: tx("cfgext.shbGenerateMotion"),
    tooltip: tx("cfgext.shbGenerateMotionTip"),
  },
  optimize_for_model: {
    icon: "🎯",
    label: tx("cfgext.shbOptimizeForModel"),
    tooltip: tx("cfgext.shbOptimizeForModelTip"),
  },
  add_broll: {
    icon: "🎞️",
    label: tx("cfgext.shbAddBRoll"),
    tooltip: tx("cfgext.shbAddBRollTip"),
  },
  bridge_to_next_scene: {
    icon: "🌉",
    label: tx("cfgext.shbBridgeToNext"),
    tooltip: tx("cfgext.shbBridgeToNextTip"),
  },
  anchor_scene_style: {
    icon: "🎨",
    label: tx("cfgext.shbAnchorStyle"),
    tooltip: tx("cfgext.shbAnchorStyleTip"),
  },
  audit_images: {
    icon: "🔍",
    label: tx("cfgext.shbAuditImages"),
    tooltip: tx("cfgext.shbAuditImagesTip"),
  },
  fix_continuity: {
    icon: "🔗",
    label: tx("cfgext.shbFixContinuity"),
    tooltip: tx("cfgext.shbFixContinuityTip"),
  },
  validate_match_cut: {
    icon: "🎯",
    label: tx("cfgext.shbValidateMatchCut"),
    tooltip: tx("cfgext.shbValidateMatchCutTip"),
  },
}
}

export function SceneHelperButtons({
  pipelineId,
  sceneEntityId,
  data,
  isLoading,
  onInvoke,
}: Props) {
  const ready = !!pipelineId && !!sceneEntityId && data.shots.length > 0
  // Subscribes this row to the locale store: HELPER_LABELS() reads tx() at
  // call time, so without a live `t` dependency the labels would render
  // correctly on mount and then freeze through a language switch.
  const t = useT()
  const labels = useMemo(() => HELPER_LABELS(), [t])
  return (
    <TooltipProvider>
      <div className="flex flex-wrap gap-1">
        {SCENE_HELPER_NAMES.map((name) => {
          const meta = labels[name]
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
                  <span className="me-1">{meta.icon}</span>
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
