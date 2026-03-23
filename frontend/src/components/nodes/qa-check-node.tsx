"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ShieldCheck, Type, Check, X } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credits"
import { buildLlmCreditIdentifier, LLM_FEATURE_DEFAULTS } from "@nodaro-shared/llm-models"
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
          { id: "in", type: "target", position: Position.Left, hideHandle: true, customStyle: { top: 'calc(100% - 20px)', left: '-29px' } },
          { id: "approved", type: "source", position: Position.Right, label: "Approved", hideHandle: true, customStyle: { top: '20px', right: '-29px' } },
          { id: "rejected", type: "source", position: Position.Right, label: "Rejected", hideHandle: true, customStyle: { top: '50px', right: '-29px' } },
        ]}
      >
        <p className="text-muted-foreground truncate max-w-[180px]">
          {nodeData.checkType} ({nodeData.provider})
        </p>
      </BaseNode>
      <HandleIcon icon={<Type />} color="pink" side="left" top="calc(100% - 20px)" />
      <HandleIcon icon={<Check />} color="green" top="20px" />
      <HandleIcon icon={<X />} color="red" top="50px" />
    </div>
  )
}

export const QACheckNode = memo(QACheckNodeComponent)
