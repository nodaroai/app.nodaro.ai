import { memo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { SceneNodeFrontendData } from "@/types/nodes"
import { cn } from "@/lib/utils"
import {
  getSceneView,
  useActiveSceneViewMode,
} from "./scene-views/view-mode-registry"
import { PipelineStateOverlay } from "./pipeline-state-overlay"
// Side-effect imports register the views with the registry.
import "./scene-views/default-view"
import "./scene-views/storyboard-view"
import "./scene-views/scripting-view"
import "./scene-views/video-view"

/**
 * Per spec §6.9.2, the SceneNode exposes 4 input handles + 3 output handles.
 * Labels are rendered as positioned <span> siblings next to each <Handle>
 * because React Flow's <Handle> is a bare anchor div with no text affordance.
 * The label sits just inside the node edge (`left-3` / `right-3`) so it's
 * readable when the node is in either light or dark mode.
 */
const LEFT_HANDLES: ReadonlyArray<{ id: string; top: number }> = [
  { id: "characters", top: 30 },
  { id: "location", top: 50 },
  { id: "objects", top: 70 },
  { id: "prev_last_frame", top: 90 },
]

const RIGHT_HANDLES: ReadonlyArray<{ id: string; top: number }> = [
  { id: "video", top: 30 },
  { id: "last_frame", top: 50 },
  { id: "audio_track", top: 70 },
]

function SceneNodeImpl(props: NodeProps) {
  const data = props.data as SceneNodeFrontendData
  // Phase 1C.2 — `useActiveSceneViewMode` consults the canvas-wide override
  // store first and falls back to the per-node `view_mode` (default
  // `"storyboard"`). Per-node toggle is still honored when the toolbar
  // override is `null`.
  const mode = useActiveSceneViewMode(data.view_mode ?? "storyboard")
  const ViewComponent = getSceneView(mode) ?? getSceneView("default")!
  return (
    <div className="relative animate-fade-in-scale">
      <PipelineStateOverlay state={data.pipeline_state} isStale={data.is_stale} />
      <div
        className={cn(
          "rounded-lg border-2 p-3 shadow-sm bg-white dark:bg-[#1E1E1E]",
          props.selected
            ? "border-blue-500"
            : "border-zinc-300 dark:border-[#2D2D2D]",
          data.pipeline_owned && "ring-1 ring-blue-200 dark:ring-blue-900",
        )}
        data-testid="scene-node"
      >
        {LEFT_HANDLES.map(({ id, top }) => (
          <div key={id}>
            <Handle type="target" position={Position.Left} id={id} style={{ top }} />
            <span
              data-testid={`handle-label-${id}`}
              className="absolute left-3 text-[10px] text-zinc-600 dark:text-zinc-300 whitespace-nowrap pointer-events-none -translate-y-1/2"
              style={{ top }}
            >
              {id}
            </span>
          </div>
        ))}
        <ViewComponent data={data} selected={props.selected ?? false} />
        {RIGHT_HANDLES.map(({ id, top }) => (
          <div key={id}>
            <Handle type="source" position={Position.Right} id={id} style={{ top }} />
            <span
              data-testid={`handle-label-${id}`}
              className="absolute right-3 text-[10px] text-zinc-600 dark:text-zinc-300 whitespace-nowrap pointer-events-none -translate-y-1/2 text-right"
              style={{ top }}
            >
              {id}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export const SceneNode = memo(SceneNodeImpl)
