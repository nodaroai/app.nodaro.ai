import type { Scene3DPlan, Scene3DReference, Scene3DEditOperation, Scene3DJobOutput as Scene3DWireJobOutput } from "@nodaro/shared"

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
  operations?: readonly Scene3DEditOperation[]
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
