import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Layers, Film, Loader2, AlertCircle } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credits"
import { NodeJobProgress } from "./node-job-progress"
import { buildLlmCreditIdentifier, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import type { LottieOverlayData } from "@/types/nodes"

function LottieOverlayNodeComponent({ id, data, selected }: NodeProps) {
  const currentNodeData = useWorkflowStore((s) => s.nodes.find((n) => n.id === id)?.data) as LottieOverlayData | undefined
  const nodeData = currentNodeData ?? (data as LottieOverlayData)
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
        { id: "in", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 50px)', left: '-29px' }, hideHandle: true },
        { id: "lottie", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
        { id: "composition", type: "source", position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
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
    <HandleIcon icon={<Film />} color="steel" side="left" top="calc(100% - 50px)" />
    <HandleIcon icon={<Layers />} color="steel" side="left" top="calc(100% - 20px)" />
    <HandleIcon icon={<Film />} color="steel" top="20px" />
    </div>
  )
}

export const LottieOverlayNode = memo(LottieOverlayNodeComponent)
