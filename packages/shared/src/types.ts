/**
 * Generic node/edge interfaces for structural subtyping.
 * Both frontend WorkflowNode and backend SimpleNode satisfy these.
 */

export interface GenericNode {
  id: string
  type: string
  data: Record<string, unknown>
}

export interface GenericEdge {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface CharacterDef {
  id: string
  name: string
  type: "reference" | "description"
  category?: string
  referenceImageUrl?: string
  description?: string
}
