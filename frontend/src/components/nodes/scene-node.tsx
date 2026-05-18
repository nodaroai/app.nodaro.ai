import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { SceneNodeFrontendData } from "@/types/nodes"
import { cn } from "@/lib/utils"
import { getSceneView, type SceneViewMode } from "./scene-views/view-mode-registry"
import { PipelineStateOverlay } from "./pipeline-state-overlay"
// Side-effect imports register the views with the registry.
import "./scene-views/default-view"
import "./scene-views/storyboard-view"
import "./scene-views/scripting-view"
import "./scene-views/video-view"

function SceneNodeImpl(props: NodeProps) {
  const data = props.data as SceneNodeFrontendData
  const mode: SceneViewMode = data.view_mode ?? "storyboard"
  const ViewComponent = getSceneView(mode) ?? getSceneView("default")!
  return (
    <div className="relative animate-fade-in-scale">
      <PipelineStateOverlay state={data.pipeline_state} isStale={data.is_stale} />
      <div
        className={cn(
          "rounded-lg border-2 bg-white p-3 shadow-sm",
          props.selected ? "border-blue-500" : "border-zinc-300",
          data.pipeline_owned && "ring-1 ring-blue-200",
        )}
        data-testid="scene-node"
      >
        <Handle type="target" position={Position.Left} id="characters" style={{ top: 30 }} />
        <Handle type="target" position={Position.Left} id="location" style={{ top: 50 }} />
        <Handle type="target" position={Position.Left} id="objects" style={{ top: 70 }} />
        <Handle type="target" position={Position.Left} id="prev_last_frame" style={{ top: 90 }} />
        <ViewComponent data={data} selected={props.selected ?? false} />
        <Handle type="source" position={Position.Right} id="video" style={{ top: 30 }} />
        <Handle type="source" position={Position.Right} id="last_frame" style={{ top: 50 }} />
        <Handle type="source" position={Position.Right} id="audio_track" style={{ top: 70 }} />
      </div>
    </div>
  )
}

export const SceneNode = memo(SceneNodeImpl)
