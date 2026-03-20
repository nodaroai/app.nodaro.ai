"use client"

import { useMemo, type ReactNode } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

interface ParameterNodeShellProps {
  readonly id: string
  readonly label: string
  readonly icon: ReactNode
  readonly handleId: string
  readonly selected?: boolean
  readonly children: ReactNode
}

const makeHandles = (id: string) => [
  { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-6px' }, hideHandle: true },
  { id, type: "source" as const, position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
] as const

export function ParameterNodeShell({ id, label, icon, handleId, selected, children }: ParameterNodeShellProps) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const handles = useMemo(() => makeHandles(handleId), [handleId])

  return (
    <div className="relative max-w-[220px]">
      <EditableNodeLabel
        label={label}
        icon={icon}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={label}
        icon={icon}
        category="parameter"
        credits={0}
        selected={selected}
        minWidth={220}
        hideHeader
        handles={handles}
      >
        <div className="px-3 py-3">
          {children}
        </div>
      </BaseNode>
      <HandleIcon icon={icon} color="indigo" top="20px" />
    </div>
  )
}
