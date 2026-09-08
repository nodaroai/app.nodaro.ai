import type { Scene3DPlan, Scene3DPlanV2, Scene3DReference, Scene3DEditOperation, Scene3DV2EditOperation, Scene3DJobOutputAny as Scene3DWireJobOutput } from "@nodaro/shared"

/** Reuse newRevisionId for transport retries of the same immutable edit. */
export interface RetainedScene3DEditParams {
  newRevisionId: string
  expectedContentHash: string
  operations: readonly Scene3DV2EditOperation[]
  lockedObjectIds?: readonly string[]
}
export interface RetainedScene3DEditResult { scenePlan: Scene3DPlanV2; changeSummary: string }

export interface Scene3DDeliveryAsset {
  assetId: string
  kind: "poster" | "validation-report"
  usage: "poster" | "validation"
  byteLength: number
  sha256: string
  viaRevisionId: string | null
}

/** Export evidence is retained separately from the immutable scene it rendered. */
export interface Scene3DDelivery {
  deliveryId: string
  sceneRevisionId: string
  sourcePlanSha256: string
  sourceContentHash: string | null
  sourceJobId: string | null
  workflowId: string | null
  mode: "authored" | "render-only"
  createdAt: string
  access: "view" | "edit" | "own"
  assets: Scene3DDeliveryAsset[]
}

export type Scene3DAuthoringEngine = "basic" | "blender-cloud" | "blender-local"

export interface Scene3DCapabilities {
  basic: { available: boolean; sceneSchemaVersions: number[] }
  advanced: null | {
    version: string
    engines: Array<Exclude<Scene3DAuthoringEngine, "basic">>
    sceneSchemaVersions: number[]
    maxRepairPasses: number
  }
}

interface Scene3DEngineParams {
  /** Basic is the default. Discover optional engines through scene3d.capabilities(). */
  engine?: Scene3DAuthoringEngine
  acceptedSceneSchemaVersions?: readonly number[]
  localConnectionId?: string
  quoteId?: string
  maxRepairPasses?: number
}

/** Structured authoring inputs; reference roles are interpreted by the platform. */
export interface GenerateScene3DParams extends Record<string, unknown>, Scene3DEngineParams {
  prompt: string
  durationSeconds?: number
  fps?: number
  aspectRatio?: string
  references?: readonly Scene3DReference[]
  llmModel?: string
  reasoningEffort?: string
  workflowId?: string
  nodeId?: string
}

/** Editing creates a new revision and never mutates the supplied scene. */
export interface EditScene3DParams extends Record<string, unknown>, Scene3DEngineParams {
  scenePlan: Scene3DPlan
  expectedRevisionId: string
  /** Replace the complete reference set, including clearing it with an empty list. Default: merge by id. */
  replaceReferences?: boolean
  /** Supply an instruction or deterministic operations, never both. */
  prompt?: string
  operations?: readonly (Scene3DEditOperation | Scene3DV2EditOperation)[]
  references?: readonly Scene3DReference[]
  lockedObjectIds?: readonly string[]
  selectedObjectIds?: readonly string[]
  llmModel?: string
  reasoningEffort?: string
  workflowId?: string
  nodeId?: string
}

/** Render the exact scene revision through the existing render-video node. */
export interface RenderScene3DParams extends Record<string, unknown> {
  planType: "3d-scene"
  plan: Scene3DPlan
  workflowId?: string
  nodeId?: string
}

/** Preserve the shared wire contract while allowing additive job metadata. */
export type Scene3DJobOutput = Readonly<Scene3DWireJobOutput> & Readonly<Record<string, unknown>>
