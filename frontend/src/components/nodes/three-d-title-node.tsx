import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Box, ImageIcon, Loader2, AlertCircle } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credits"
import { NodeJobProgress } from "./node-job-progress"
import { buildLlmCreditIdentifier, LLM_FEATURE_DEFAULTS } from "@nodaro-shared/llm-models"
import type { ThreeDTitleData } from "@/types/nodes"

function ThreeDTitleNodeComponent({ id, data, selected }: NodeProps) {
  const currentNodeData = useWorkflowStore((s) => s.nodes.find((n) => n.id === id)?.data) as ThreeDTitleData | undefined
  const nodeData = currentNodeData ?? (data as ThreeDTitleData)
  const credits = useModelCredits(buildLlmCreditIdentifier("3d-title", nodeData.llmModel || LLM_FEATURE_DEFAULTS["3d-title"]), 15)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const isRunning = status === "running"
  const titlePlan = nodeData.titlePlan as Record<string, unknown> | undefined

  const objectCount = titlePlan
    ? ((titlePlan.objects as unknown[])?.length ?? 0)
    : 0

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<Box className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Box className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={isRunning}
      hideHeader
      topToolbarContent={
        !isRunning ? (
          <RunNodeButton nodeId={id} credits={credits} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
        ) : undefined
      }
      handles={[
        { id: "background", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
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

        {!isRunning && titlePlan && (
          <div className="flex items-center justify-center h-16 rounded-md bg-[#ff0073]/5 border border-[#ff0073]/20">
            <div className="text-center">
              <div className="text-sm font-medium text-[#ff0073]">
                {objectCount} objects 3D
              </div>
              <div className="text-[10px] text-muted-foreground">{nodeData.durationSeconds}s</div>
            </div>
          </div>
        )}

        {status === "failed" && !titlePlan && (
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

        {!isRunning && !titlePlan && status !== "failed" && (
          <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <Box className="w-5 h-5" />
          </div>
        )}

        <div className="text-muted-foreground text-[10px] line-clamp-1">
          {nodeData.titlePrompt?.trim()
            ? nodeData.titlePrompt
            : "No prompt set"}
        </div>
      </div>
    </BaseNode>
    <HandleIcon icon={<ImageIcon />} color="pink" side="left" top="calc(100% - 20px)" />
    <HandleIcon icon={<Box />} color="pink" side="right" top="20px" />
    </div>
  )
}

export const ThreeDTitleNode = memo(ThreeDTitleNodeComponent)
