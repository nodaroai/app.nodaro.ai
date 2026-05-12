import type { GenericNode, GenericEdge } from "./types.js"

export interface WorkflowExportCharacter {
  id: string
  nodeId: string
  name: string
  description?: string | null
  gender?: string | null
  style?: string | null
  baseOutfit?: string | null
  sourceImageUrl?: string | null
  expressions?: { name: string; url: string }[]
  poses?: { name: string; url: string }[]
  lightingVariations?: { name: string; url: string }[]
}

export interface WorkflowExportObject {
  id: string
  nodeId: string
  name: string
  description?: string | null
  style?: string | null
  sourceImageUrl?: string | null
  angles?: { name: string; url: string }[]
  materials?: { name: string; url: string }[]
  variations?: { name: string; url: string }[]
}

export interface WorkflowExportLocation {
  id: string
  nodeId: string
  name: string
  description?: string | null
  style?: string | null
  sourceImageUrl?: string | null
  timeOfDay?: { name: string; url: string }[]
  weather?: { name: string; url: string }[]
  angles?: { name: string; url: string }[]
}

export interface WorkflowExport {
  version: 1
  exportedAt: string
  name: string
  nodes: GenericNode[]
  edges: GenericEdge[]
  settings?: Record<string, unknown>
  assets?: {
    characters: WorkflowExportCharacter[]
    objects: WorkflowExportObject[]
    locations: WorkflowExportLocation[]
  }
}

const GENERATED_FIELDS = [
  "generatedResults",
  "generatedImageUrl",
  "sourceImageUrl",
  "executionStatus",
  "activeResultIndex",
  "assetId",
] as const

const NODE_EXTRA_FIELDS: Record<string, string[]> = {
  character: ["expressions", "poses", "lightingVariations", "angles", "customVariations"],
  object: ["angles", "materials", "variations", "customVariations"],
  location: ["timeOfDay", "weather", "angles", "customVariations"],
  "extract-frame": [],
}

export function stripExportContent(nodes: GenericNode[]): GenericNode[] {
  return nodes.map((node) => {
    const data = { ...(node.data as Record<string, unknown>) }
    for (const field of GENERATED_FIELDS) delete data[field]
    const extras = NODE_EXTRA_FIELDS[node.type ?? ""] ?? []
    for (const field of extras) delete data[field]
    return { ...node, data }
  })
}
