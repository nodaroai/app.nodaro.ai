import type { ConfigProps } from "./types"
import type { SceneNodeFrontendData } from "@/types/nodes"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"

/**
 * SceneConfig — Phase 1B.2 read-only config panel for the pipeline-managed
 * SceneNode. Scene data is written by the Scene Director LLM and persisted
 * on `pipeline_entities.metadata.scene_node_data`; the canvas node mirrors
 * that shape. Users approve / reject each scene through the pipeline panel
 * (see Section L), not through this config panel.
 *
 * Mutable fields: only `view_mode` (storyboard / scripting / default / video).
 * Phase 1B.3 surfaces helper buttons (Audit Images, Improve Prompt, etc.) —
 * see plan §6.11. Phase 1C lands the internal pipeline execution wiring.
 */
export function SceneConfig({ data, onUpdate }: ConfigProps<SceneNodeFrontendData>) {
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
    </div>
  )
}
