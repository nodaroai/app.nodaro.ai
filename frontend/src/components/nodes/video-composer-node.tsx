import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Sparkles, Film, Loader2, AlertCircle } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { NodeJobProgress } from "./node-job-progress"
import { buildLlmCreditIdentifier, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import type { VideoComposerData } from "@/types/nodes"

function VideoComposerNodeComponent({ id, data, selected }: NodeProps) {
  const currentNodeData = useWorkflowStore((s) => s.nodes.find((n) => n.id === id)?.data) as VideoComposerData | undefined
  const nodeData = currentNodeData ?? (data as VideoComposerData)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const credits = useModelCredits(buildLlmCreditIdentifier("scene-graph-ai", nodeData.llmModel || LLM_FEATURE_DEFAULTS["scene-graph-ai"]), 10)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const isRunning = status === "running"
  const sceneGraph = nodeData.sceneGraph as Record<string, unknown> | undefined

  const trackCount = sceneGraph
    ? ((sceneGraph.tracks as unknown[])?.length ?? 0)
    : 0
  const duration = nodeData.durationSeconds ?? 30

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<Sparkles className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Sparkles className="h-4 w-4" />}
      category="processing"
      credits={credits}
      selected={selected}
      isRunning={isRunning}
      hideHeader
      minWidth={220}
      topToolbarContent={
        !isRunning ? (
          <RunNodeButton nodeId={id} credits={credits} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
        ) : undefined
      }
      handles={[
        { id: "in",          type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
        { id: "composition", type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
      ]}
    >
      <div className="flex flex-col gap-1">
        {isRunning && (
          <div className="flex flex-col items-center justify-center gap-2 h-16 rounded-md bg-muted/30">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <NodeJobProgress progress={nodeData.currentJobProgress} />
          </div>
        )}

        {!isRunning && sceneGraph && (
          <div className="flex items-center justify-center h-16 rounded-md bg-[#ff0073]/5 border border-[#ff0073]/20">
            <div className="text-center">
              <div className="text-sm font-medium text-[#ff0073]">
                {trackCount} tracks
              </div>
              <div className="text-[10px] text-muted-foreground">{duration}s</div>
            </div>
          </div>
        )}

        {status === "failed" && !sceneGraph && (
          <div className="flex flex-col items-center justify-center gap-1 h-16 rounded-md bg-red-500/5 text-red-500 p-2">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="font-medium">Failed</span>
            </div>
            {nodeData.errorMessage && (
              <p className="text-[10px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>
                {nodeData.errorMessage}
              </p>
            )}
          </div>
        )}

        {!isRunning && !sceneGraph && status !== "failed" && (
          <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <Sparkles className="w-5 h-5" />
          </div>
        )}

        <div className="text-muted-foreground text-[10px] line-clamp-1">
          {nodeData.compositionPrompt?.trim()
            ? nodeData.compositionPrompt
            : "No prompt set"}
        </div>
      </div>
    </BaseNode>
    <HandleWithPopover nodeId={id} nodeType="video-composer" handleId="in"          type="target" position={Position.Left}  label="Assets"      color="#475569" icon={<Sparkles />} side="left"  top="calc(100% - 24px)" />
    <HandleWithPopover nodeId={id} nodeType="video-composer" handleId="composition" type="source" position={Position.Right} label="Composition" color="#ff0073" icon={<Film />}     side="right" top="24px" />
    </div>
  )
}

export const VideoComposerNode = memo(VideoComposerNodeComponent)
