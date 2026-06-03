"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ShieldCheck, Type, Check, X } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { buildLlmCreditIdentifier, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import type { QACheckData } from "@/types/nodes"

function QACheckNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as QACheckData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const credits = useModelCredits(buildLlmCreditIdentifier("qa-check", nodeData.llmModel || LLM_FEATURE_DEFAULTS["qa-check"]), 1)

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<ShieldCheck className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<ShieldCheck className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={220}
        topToolbarContent={
                      <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
        }
        handles={[
          { id: "in",       type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
          { id: "approved", type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
          { id: "rejected", type: "source", position: Position.Right, customStyle: { top: '56px',              right: '-29px' }, external: true },
        ]}
      >
        <p className="text-muted-foreground truncate max-w-[180px]">
          {nodeData.checkType} ({nodeData.provider})
        </p>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="qa-check" handleId="in"       type="target" position={Position.Left}  label="Input"    color={HANDLE_COLORS.control} icon={<Type />}  side="left"  top="calc(100% - 24px)" />
      <HandleWithPopover nodeId={id} nodeType="qa-check" handleId="approved" type="source" position={Position.Right} label="Approved" color={HANDLE_COLORS.approve} icon={<Check />} side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="qa-check" handleId="rejected" type="source" position={Position.Right} label="Rejected" color={HANDLE_COLORS.negative} icon={<X />}     side="right" top="56px" />
    </div>
  )
}

export const QACheckNode = memo(QACheckNodeComponent)
