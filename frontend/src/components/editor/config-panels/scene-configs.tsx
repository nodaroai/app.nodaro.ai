import type { ConfigProps } from "./types"
import type { SceneNodeFrontendData } from "@/types/nodes"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { useSceneHelper } from "@/hooks/use-scene-helper"
import { SceneHelperButtons } from "./scene-helper-buttons"
import { SceneHelperModal } from "./scene-helper-modal"

/**
 * SceneConfig — Phase 1B.2 read-only config panel for the pipeline-managed
 * SceneNode. Scene data is written by the Scene Director LLM and persisted
 * on `pipeline_entities.metadata.scene_node_data`; the canvas node mirrors
 * that shape. Users approve / reject each scene through the pipeline panel
 * (see Section L), not through this config panel.
 *
 * Mutable fields: only `view_mode` (storyboard / scripting / default / video).
 * Phase 1B.3 adds §6.11 Scene-Context helper buttons (Audit Prompt, Improve
 * Prompt, Generate Motion, Optimize for Model, Add B-Roll, Bridge to Next,
 * Anchor Style) that mutate `data.shots` and `data.scene_anchor_keyframe` via
 * Accept-gated patches. The 3 vision-keyframe helpers render disabled with a
 * "Pending Phase 1C" tooltip.
 */
export function SceneConfig({ data, onUpdate }: ConfigProps<SceneNodeFrontendData>) {
  // pipeline_id is written by canvas-materializer when the scene is created;
  // pipeline_entity_id is the bound row in pipeline_entities. The §6.11 helper
  // buttons stay disabled until both are present.
  const pipelineId = data.pipeline_id
  const sceneEntityId = data.pipeline_entity_id
  const { state, invoke, reset } = useSceneHelper(pipelineId, sceneEntityId)

  return (
    <div className="space-y-3">
      <div>
        <Label>Scene</Label>
        <div className="text-sm">{data.description || data.label || `Scene ${data.scene_index}`}</div>
      </div>
      <div>
        <Label>Beat</Label>
        <div className="text-sm">{data.emotional_beat}</div>
      </div>
      <div>
        <Label>Duration</Label>
        <div className="text-sm">{data.duration_seconds}s</div>
      </div>
      <div>
        <Label>Shots</Label>
        <div className="text-sm">{data.shots.length} planned</div>
      </div>
      <div>
        <Label>Image model</Label>
        <div className="text-sm">{data.image_model}</div>
      </div>
      <div>
        <Label>Video model</Label>
        <div className="text-sm">{data.video_model}</div>
      </div>
      <div>
        <Label>Input mode</Label>
        <div className="text-sm">{data.shot_input_mode}</div>
      </div>
      <div>
        <Label>View mode</Label>
        <Select
          value={data.view_mode ?? "storyboard"}
          onValueChange={(v) =>
            onUpdate({ view_mode: v as "default" | "storyboard" | "video" | "scripting" })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default</SelectItem>
            <SelectItem value="storyboard">Storyboard</SelectItem>
            <SelectItem value="scripting">Scripting</SelectItem>
            <SelectItem value="video">Video</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="text-xs text-zinc-500 italic">
        Edit through the pipeline panel; this node is pipeline-managed in Phase 1B.2.
      </div>
      <div className="space-y-2 pt-3 border-t border-zinc-200">
        <Label>Helpers</Label>
        <SceneHelperButtons
          pipelineId={pipelineId}
          sceneEntityId={sceneEntityId}
          data={data}
          isLoading={state.status === "loading"}
          onInvoke={(name) => {
            // Per-helper default args. The dispatch is centralized here so the
            // button component stays presentation-only.
            if (
              name === "audit_prompt" ||
              name === "add_broll" ||
              name === "anchor_scene_style"
            ) {
              void invoke(name, undefined)
              return
            }
            if (name === "improve_prompt") {
              // Phase 1B.3 simplicity: improve every shot's action+motion.
              // Phase 1B.4 will let the user select shot_ids + targets.
              void invoke(name, {
                shot_ids: ["all"],
                field_targets: ["action", "motion_prompt"],
              })
              return
            }
            if (name === "generate_motion") {
              void invoke(name, { shot_ids: ["all"] })
              return
            }
            if (name === "optimize_for_model") {
              void invoke(name, { target_model: data.video_model })
              return
            }
            if (name === "bridge_to_next_scene") {
              // Default to the second shot if it exists. User refines in 1B.4.
              const target = data.shots[1]?.shot_id
              if (target) void invoke(name, { target_shot_id: target })
              return
            }
            // audit_images / fix_continuity / validate_match_cut: disabled at
            // the button level (Phase 1C). No dispatch needed.
          }}
        />
      </div>
      <SceneHelperModal
        state={state}
        data={data}
        onAccept={(patch) => {
          onUpdate(patch)
          reset()
        }}
        onReject={reset}
      />
    </div>
  )
}
