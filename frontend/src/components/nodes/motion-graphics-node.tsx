import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Shapes, Film, Loader2, AlertCircle } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { NodeJobProgress } from "./node-job-progress"
import { buildLlmCreditIdentifier, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import type { MotionGraphicsData } from "@/types/nodes"

function MotionGraphicsNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as MotionGraphicsData
  const credits = useModelCredits(buildLlmCreditIdentifier("motion-graphics", nodeData.llmModel || LLM_FEATURE_DEFAULTS["motion-graphics"]), 10)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const isRunning = status === "running"
  const motionPlan = nodeData.motionPlan as Record<string, unknown> | undefined

  const elementCount = motionPlan
    ? ((motionPlan.elements as unknown[])?.length ?? 0)
    : 0

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<Shapes className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Shapes className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={isRunning}
      hideHeader
      topToolbarContent={
        !isRunning ? (
          <NodeQuickStrip nodeId={id} credits={credits} isRunning={false} />
        ) : undefined
      }
      handles={[
        { id: "video",       type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
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

        {!isRunning && motionPlan && (
          <div className="flex items-center justify-center h-16 rounded-md bg-[#ff0073]/5 border border-[#ff0073]/20">
            <div className="text-center">
              <div className="text-sm font-medium text-[#ff0073]">
                {elementCount} elements
              </div>
              <div className="text-[10px] text-muted-foreground">{nodeData.durationSeconds}s</div>
            </div>
          </div>
        )}

        {status === "failed" && !motionPlan && (
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

        {!isRunning && !motionPlan && status !== "failed" && (
          <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <Shapes className="w-5 h-5" />
          </div>
        )}

        <div className="text-muted-foreground text-[10px] line-clamp-1">
          {nodeData.motionPrompt?.trim()
            ? nodeData.motionPrompt
            : "No prompt set"}
        </div>
      </div>
    </BaseNode>
    <HandleWithPopover nodeId={id} nodeType="motion-graphics" handleId="video"       type="target" position={Position.Left}  label="Video"       color={HANDLE_COLORS.video} icon={<Film />}   side="left"  top="calc(100% - 24px)" />
    <HandleWithPopover nodeId={id} nodeType="motion-graphics" handleId="composition" type="source" position={Position.Right} label="Composition" color={HANDLE_COLORS.control} icon={<Shapes />} side="right" top="24px" />
    </div>
  )
}

export const MotionGraphicsNode = memo(MotionGraphicsNodeComponent)
