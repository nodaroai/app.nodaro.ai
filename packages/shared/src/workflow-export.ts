import type { GenericNode, GenericEdge } from "./types.js"
import { EXECUTION_DATA_KEYS } from "./node-runtime-keys.js"

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

/**
 * Config keys that are (mis)classified inside EXECUTION_DATA_KEYS but are
 * actually USER CONFIG a template MUST keep — NOT runtime/result. `shots` is
 * the Kling-3.0 multi-shot storyboard (user-authored, route-accepted via
 * shotsSchema); stripping it on template export silently drops every shot's
 * prompt+duration while leaving `multiShot:true`, producing a broken template.
 * (`elements`, the sibling Kling-3 config, is correctly absent from
 * EXECUTION_DATA_KEYS — `shots` should arguably be too, but is kept there for
 * other run-state consumers, so we exclude it here rather than reclassify.)
 */
const TEMPLATE_KEEP_CONFIG_KEYS = new Set<string>(["shots"])

/**
 * Top-level node data fields cleared on template export. Built from
 * EXECUTION_DATA_KEYS (the single source of truth for runtime/result keys),
 * minus the config keys above, so a new result field is stripped by default —
 * never re-leak generated media URLs, job ids, or trained-LoRA identity
 * (loraReplicateVersion / loraTriggerWord / outputResults / generatedVideoUrl
 * / …) into a shareable template — while preserving user config. `assetId` is
 * the one non-runtime extra (a library-asset pointer).
 */
const GENERATED_FIELDS: readonly string[] = [
  ...[...EXECUTION_DATA_KEYS].filter((k) => !TEMPLATE_KEEP_CONFIG_KEYS.has(k)),
  "assetId",
]

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
  // Strip the exporter's private face-row pointer + variants from templates
  // (faceDbId points at a row the importer doesn't own — see workflow-assets
  // import remap, which also clears it).
  face: ["faceDbId", "expressions", "customVariations"],
  // A template shouldn't carry a link to a specific child workflow id (it's
  // the exporter's, and unremapped on import). Strip it so the node lands
  // unlinked rather than dangling at the exporter's workflow.
  "sub-workflow": ["referencedWorkflowId"],
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
