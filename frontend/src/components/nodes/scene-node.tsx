import { memo, type ReactNode } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { Clapperboard, Users, MapPin, Package, Film, Image as ImageIcon, Music } from "lucide-react"
import type { SceneNodeFrontendData } from "@/types/nodes"
import { cn } from "@/lib/utils"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { HandleIcon } from "./handle-icon"
import { EditableNodeLabel } from "./editable-node-label"
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

type HandleColor = "cyan" | "pink" | "indigo" | "steel" | "green" | "red" | "orange" | "purple" | "emerald"

/**
 * Per spec §6.9.2, the SceneNode exposes 4 input handles + 3 output handles.
 * Each handle is a transparent React Flow <Handle> hit-target with a colored
 * <HandleIcon> circle overlaid at the node edge (matching the standard node
 * handle look). A small <span> label sits just inside the edge (`left-3` /
 * `right-3`) so the semantic role stays readable in light + dark mode.
 */
const LEFT_HANDLES: ReadonlyArray<{ id: string; top: number; icon: ReactNode; color: HandleColor }> = [
  { id: "characters", top: 24, icon: <Users />, color: "pink" },
  { id: "location", top: 54, icon: <MapPin />, color: "cyan" },
  { id: "objects", top: 84, icon: <Package />, color: "emerald" },
  { id: "prev_last_frame", top: 114, icon: <Film />, color: "steel" },
]

const RIGHT_HANDLES: ReadonlyArray<{ id: string; top: number; icon: ReactNode; color: HandleColor }> = [
  { id: "video", top: 24, icon: <Film />, color: "cyan" },
  { id: "last_frame", top: 54, icon: <ImageIcon />, color: "pink" },
  { id: "audio_track", top: 84, icon: <Music />, color: "purple" },
]

function SceneNodeImpl(props: NodeProps) {
  const data = props.data as SceneNodeFrontendData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  // Phase 1C.2 — `useActiveSceneViewMode` consults the canvas-wide override
  // store first and falls back to the per-node `view_mode` (default
  // `"storyboard"`). Per-node toggle is still honored when the toolbar
  // override is `null`.
  const mode = useActiveSceneViewMode(data.view_mode ?? "storyboard")
  const ViewComponent = getSceneView(mode) ?? getSceneView("default")!
  return (
    <div className="relative animate-fade-in-scale">
      <EditableNodeLabel
        label={data.label || data.description || `Scene ${data.scene_index}`}
        icon={<Clapperboard className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(props.id, { label: newLabel })}
      />
      <PipelineStateOverlay state={data.pipeline_state} isStale={data.is_stale} />
      <div
        className={cn(
          "relative rounded-lg border-2 p-3 shadow-sm bg-white dark:bg-[#1E1E1E]",
          props.selected
            ? "border-blue-500"
            : "border-zinc-300 dark:border-[#2D2D2D]",
          data.pipeline_owned && "ring-1 ring-blue-200 dark:ring-blue-900",
        )}
        style={{ minHeight: 150 }}
        data-testid="scene-node"
      >
        {LEFT_HANDLES.map(({ id, top, icon, color }) => (
          <div key={id}>
            <Handle
              type="target"
              position={Position.Left}
              id={id}
              isConnectable
              className="!w-7 !h-7 !bg-transparent !border-0 touch-manipulation"
              style={{ top, left: "-29px", transform: "translateY(-50%)", zIndex: 30 }}
            />
            <HandleIcon icon={icon} color={color} side="left" top={`${top}px`} />
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
        {RIGHT_HANDLES.map(({ id, top, icon, color }) => (
          <div key={id}>
            <Handle
              type="source"
              position={Position.Right}
              id={id}
              isConnectable
              className="!w-7 !h-7 !bg-transparent !border-0 touch-manipulation"
              style={{ top, right: "-29px", transform: "translateY(-50%)", zIndex: 30 }}
            />
            <HandleIcon icon={icon} color={color} side="right" top={`${top}px`} />
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
