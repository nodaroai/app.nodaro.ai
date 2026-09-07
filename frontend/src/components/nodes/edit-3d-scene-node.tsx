import { useT } from "@/lib/i18n"
import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Boxes, Images, Loader2, AlertCircle, History, PencilRuler, Lock } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeQuickStrip } from "./node-quick-strip"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { NodeJobProgress } from "./node-job-progress"
import { buildLlmCreditIdentifier, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import { planObjects, planRevisionId } from "@/lib/scene3d/plan-view"
import type { Edit3DSceneData } from "@/types/nodes"

function Edit3DSceneNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as Edit3DSceneData
  const credits = useModelCredits(
    buildLlmCreditIdentifier(
      "3d-scene",
      nodeData.llmModel || LLM_FEATURE_DEFAULTS["3d-scene"],
      nodeData.reasoningEffort,
    ),
    30,
  )
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.executionStatus ?? "idle"
  const isRunning = status === "running"
  const scenePlan = nodeData.scenePlan as Record<string, unknown> | undefined

  const objectCount = scenePlan ? planObjects(scenePlan).length : 0
  const revision = planRevisionId(scenePlan)
  const lockedCount = nodeData.lockedObjectIds?.length ?? 0

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<PencilRuler className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<PencilRuler className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={isRunning}
      hideHeader
      handles={[
        { id: "scene",       type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 56px)', left: '-29px' }, external: true },
        { id: "references",  type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
        { id: "composition", type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
      ]}
      topToolbarContent={
        <NodeQuickStrip nodeId={id} credits={credits} isRunning={isRunning} />
      }
    >
      <div className="flex flex-col gap-1">
        {isRunning && !scenePlan && (
          <div className="flex flex-col items-center justify-center gap-2 h-16 rounded-md bg-muted/30">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <NodeJobProgress progress={nodeData.currentJobProgress} />
          </div>
        )}

        {scenePlan && (
          <div className="relative flex items-center justify-center h-16 rounded-md bg-[#ff0073]/5 border border-[#ff0073]/20">
            {isRunning && (
              <Loader2 className="absolute top-1 right-1 w-3 h-3 animate-spin text-[#ff0073]" />
            )}
            <div className="text-center">
              <div className="text-sm font-medium text-[#ff0073]">{objectCount} objects</div>
              <div className="text-[10px] text-muted-foreground">
                {revision ? `rev ${revision.slice(0, 6)}` : "unversioned"}
                {lockedCount > 0 ? ` · ${lockedCount} locked` : ""}
              </div>
            </div>
          </div>
        )}

        {nodeData.scenePendingPlan && (
          <div className="flex items-center gap-1 text-[10px] text-amber-500">
            <History className="w-3 h-3 shrink-0" />
            <span className="line-clamp-1">New revision waiting — open the panel</span>
          </div>
        )}

        {lockedCount > 0 && !scenePlan && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Lock className="w-3 h-3 shrink-0" />
            <span>{lockedCount} locked</span>
          </div>
        )}

        {status === "failed" && (
          <div className="flex flex-col items-center justify-center gap-1 rounded-md bg-red-500/5 text-red-500 p-2">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="font-medium">{t("node.failed")}</span>
            </div>
            {nodeData.errorMessage && (
              <p className="text-[10px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>
                {nodeData.errorMessage}
              </p>
            )}
          </div>
        )}

        {!isRunning && !scenePlan && status !== "failed" && (
          <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <Boxes className="w-5 h-5" />
          </div>
        )}

        <div className="text-muted-foreground text-[10px] line-clamp-1">
          {nodeData.editPrompt?.trim() ? nodeData.editPrompt : "No edit instruction set"}
        </div>
      </div>
    </BaseNode>
    <HandleWithPopover nodeId={id} nodeType="edit-3d-scene" handleId="scene"       type="target" position={Position.Left}  label="Scene"       color={HANDLE_COLORS.control}   icon={<Boxes />}  side="left"  top="calc(100% - 56px)" />
    <HandleWithPopover nodeId={id} nodeType="edit-3d-scene" handleId="references"  type="target" position={Position.Left}  label="References"  color={HANDLE_COLORS.reference} icon={<Images />} side="left"  top="calc(100% - 24px)" />
    <HandleWithPopover nodeId={id} nodeType="edit-3d-scene" handleId="composition" type="source" position={Position.Right} label="Composition" color={HANDLE_COLORS.control}   icon={<Boxes />}  side="right" top="24px" />
    </div>
  )
}

export const Edit3DSceneNode = memo(Edit3DSceneNodeComponent)
