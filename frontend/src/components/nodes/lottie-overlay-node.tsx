import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Layers, Film, Loader2, AlertCircle } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { NodeJobProgress } from "./node-job-progress"
import { buildLlmCreditIdentifier, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import type { LottieOverlayData } from "@/types/nodes"

function LottieOverlayNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as LottieOverlayData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const credits = useModelCredits(buildLlmCreditIdentifier("lottie-overlay", nodeData.llmModel || LLM_FEATURE_DEFAULTS["lottie-overlay"]), 10)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const isRunning = status === "running"
  const overlayPlan = nodeData.overlayPlan as Record<string, unknown> | undefined

  const overlayCount = overlayPlan
    ? ((overlayPlan.overlays as unknown[])?.length ?? 0)
    : 0

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<Layers className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Layers className="h-4 w-4" />}
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
        { id: "video",       type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 56px)', left: '-29px' }, external: true },
        { id: "lottie",      type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
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

        {!isRunning && overlayPlan && (
          <div className="flex items-center justify-center h-16 rounded-md bg-[#ff0073]/5 border border-[#ff0073]/20">
            <div className="text-center">
              <div className="text-sm font-medium text-[#ff0073]">
                {overlayCount} overlays
              </div>
              <div className="text-[10px] text-muted-foreground">{nodeData.durationSeconds}s</div>
            </div>
          </div>
        )}

        {status === "failed" && !overlayPlan && (
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

        {!isRunning && !overlayPlan && status !== "failed" && (
          <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <Layers className="w-5 h-5" />
          </div>
        )}

        <div className="text-muted-foreground text-[10px] line-clamp-1">
          {nodeData.overlayPrompt?.trim()
            ? nodeData.overlayPrompt
            : "No prompt set"}
        </div>
      </div>
    </BaseNode>
    <HandleWithPopover nodeId={id} nodeType="lottie-overlay" handleId="video"       type="target" position={Position.Left}  label="Video"       color="#A78BFA" icon={<Film />}   side="left"  top="calc(100% - 56px)" />
    <HandleWithPopover nodeId={id} nodeType="lottie-overlay" handleId="lottie"      type="target" position={Position.Left}  label="Lottie"      color="#475569" icon={<Layers />} side="left"  top="calc(100% - 24px)" />
    <HandleWithPopover nodeId={id} nodeType="lottie-overlay" handleId="composition" type="source" position={Position.Right} label="Composition" color="#ff0073" icon={<Layers />} side="right" top="24px" />
    </div>
  )
}

export const LottieOverlayNode = memo(LottieOverlayNodeComponent)
