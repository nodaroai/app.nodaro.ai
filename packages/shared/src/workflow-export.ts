import type { GenericNode, GenericEdge } from "./types.js"

/** A named media variant (expression, pose, angle, etc.) produced during entity generation. */
interface AssetVariant {
  name: string
  url: string
}

/** A mood-board / scrap photo attached to a location ({@link WorkflowExportLocation.referencePhotos}). */
interface ReferencePhoto {
  kind: string
  url: string
}

export interface WorkflowExportCharacter {
  id: string
  nodeId: string
  name: string
  description?: string | null
  gender?: string | null
  style?: string | null
  baseOutfit?: string | null
  sourceImageUrl?: string | null
  expressions?: AssetVariant[]
  poses?: AssetVariant[]
  lightingVariations?: AssetVariant[]
}

export interface WorkflowExportObject {
  id: string
  nodeId: string
  name: string
  description?: string | null
  style?: string | null
  sourceImageUrl?: string | null
  angles?: AssetVariant[]
  materials?: AssetVariant[]
  variations?: AssetVariant[]
}

/** Animal/Creature entity export shape. Structural clone of {@link WorkflowExportObject}
 *  with the object→creature DELTA MAP: adds free-text `species`, and the `materials`
 *  asset slot becomes `poses`. */
export interface WorkflowExportCreature {
  id: string
  nodeId: string
  name: string
  description?: string | null
  species?: string | null
  style?: string | null
  sourceImageUrl?: string | null
  angles?: AssetVariant[]
  poses?: AssetVariant[]
  variations?: AssetVariant[]
}

export interface WorkflowExportLocation {
  id: string
  nodeId: string
  name: string
  description?: string | null
  style?: string | null
  sourceImageUrl?: string | null
  timeOfDay?: AssetVariant[]
  weather?: AssetVariant[]
  angles?: AssetVariant[]
  // Location Studio Phase 1 (migration 124).
  lighting?: AssetVariant[]
  seasons?: AssetVariant[]
  atmosphereMotions?: AssetVariant[]
  referencePhotos?: ReferencePhoto[]
  canonicalDescription?: string | null
  styleLock?: boolean | null
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
    creatures?: WorkflowExportCreature[]
    locations: WorkflowExportLocation[]
  }
}

/** Top-level node data fields that hold generated/transient content and should be cleared on template export. */
const GENERATED_FIELDS = [
  "generatedResults",
  "generatedImageUrl",
  "sourceImageUrl",
  "executionStatus",
  "activeResultIndex",
  "assetId",
] as const

/** Per-node-type extra generated fields beyond GENERATED_FIELDS. Unknown types get no extras ([] default). */
const NODE_EXTRA_FIELDS: Record<string, string[]> = {
  character: ["expressions", "poses", "lightingVariations", "angles", "customVariations"],
  object: ["angles", "materials", "variations", "customVariations"],
  creature: ["angles", "poses", "variations", "customVariations"],
  location: [
    "timeOfDay",
    "weather",
    "angles",
    "lighting",
    "seasons",
    "atmosphereMotions",
    "customVariations",
    "referencePhotos",
    "canonicalDescription",
  ],
}

/** Strip generated/transient content from nodes for template export. Returns new node objects; inputs are not mutated. */
export function stripExportContent(nodes: GenericNode[]): GenericNode[] {
  return nodes.map((node) => {
    const data = { ...(node.data as Record<string, unknown>) }
    for (const field of GENERATED_FIELDS) delete data[field]
    const extras = NODE_EXTRA_FIELDS[node.type] ?? []
    for (const field of extras) delete data[field]
    return { ...node, data }
  })
}
