import type { WorkflowNode, WorkflowEdge, FieldMappings } from "@/types/nodes"
import type { NodeRefItem } from "@/lib/node-refs"

export type VariableDisplayMode = "raw" | "annotated" | "resolved"

export interface SourceNodeInfo {
  readonly id: string
  readonly type: string
  readonly label: string
  readonly value: string
  readonly providerCategory?: string
  readonly sourceHandle?: string
  readonly targetHandle?: string
  readonly nodeData?: Record<string, unknown>
  readonly edgeOutputMode?: string
}

export interface ConfigProps<T> {
  readonly data: T
  readonly onUpdate: (d: Record<string, unknown>) => void
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly fieldMappings: FieldMappings
  readonly onMapField: (field: string, sourceNodeId: string | null) => void
  readonly nodes: ReadonlyArray<WorkflowNode>
  readonly onUpdateNode?: (nodeId: string, data: Record<string, unknown>) => void
  readonly nodeRefs?: ReadonlyArray<NodeRefItem>
  readonly refMap?: Map<string, string>
  readonly variableDisplayMode?: VariableDisplayMode
}
