import type { Scene3DPlan, Scene3DPlanV2, Scene3DReference, Scene3DEditOperation, Scene3DV2EditOperation, Scene3DJobOutputAny as Scene3DWireJobOutput, Pro3DRenderCapabilities, Pro3DRenderEngine, Pro3DRenderJobOutput as Pro3DRenderWireOutput, Pro3DRenderQuality, Pro3DRenderQuote as Pro3DRenderWireQuote, Pro3DRenderSource, Pro3DRenderStyle } from "@nodaro/shared"

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
  /**
   * Null on a `refused-authoring` delivery and on that alone.
   *
   * A Pro run whose recipe the compiler refused on every pass still retains the refusal
   * report, but nothing was ever compiled, so no scene revision was published. The field is
   * null rather than absent so the shape stays one shape; read `sourceKind` to tell why.
   */
  sceneRevisionId: string | null
  /**
   * What this delivery was made from. Absent when read from a deployment that predates the
   * refused lane, where every delivery necessarily had a scene behind it.
   */
  sourceKind?: "retained-revision" | "job-output" | "refused-authoring"
  /** Null when there is no plan to hash — see `sceneRevisionId`. */
  sourcePlanSha256: string | null
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
  /**
   * What this deployment can serve for `pro-3d-render`, including which
   * quality profiles, engines and aspect ratios a client may OFFER. Optional so
   * a client of this version reads an older backend without throwing; absent
   * means the node is unavailable.
   */
  pro?: Pro3DRenderCapabilities
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
  /** Existing GLBs selected by immutable revision/artifact IDs. Requires an import-capable advanced engine. */
  inputAssets?: readonly import("@nodaro/shared").Scene3DInputAsset[]
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

/**
 * 3D Render Pro — ONE durable operation producing a composition and its MP4.
 *
 * `source` is a strict discriminated union, not a bag of optionals:
 *  - `{kind:'prompt', prompt, references?}` authors a new scene;
 *  - `{kind:'scene', revisionId, sourceJobId}` with NO `editPrompt` is the
 *    render-only export — it spends no authoring or build credits, and OMIT
 *    the field rather than sending `""`, which would buy an authoring pass;
 *  - `{kind:'local-export', exportId, connectionId}` uses a paired desktop.
 *
 * There is no model or effort field: the planner is fixed and server-owned.
 *
 * `durationSeconds` / `fps` / `aspectRatio` on a `scene` source are an EXPLICIT
 * re-time request. Omit them to keep the source's own timing; a conflicting
 * override is rejected rather than silently applied.
 */
export interface Pro3DRenderParams extends Record<string, unknown> {
  source: Pro3DRenderSource
  /** Optional. An unknown or unavailable engine is rejected, never downgraded. */
  engine?: Pro3DRenderEngine
  /** Names a paired desktop for a local run. */
  localConnectionId?: string
  durationSeconds?: number
  fps?: number
  aspectRatio?: string
  quality?: Pro3DRenderQuality
  style?: Pro3DRenderStyle
  /** Correction budget, 0-2. Each pass is paid work. */
  maxRepairPasses?: number
  /**
   * Which scene-schema versions THIS client can render. A prompt or
   * local-export source mints v2, so omitting 2 is refused for free; a scene
   * source inherits its revision's version and is left to the server.
   */
  acceptedSceneSchemaVersions?: readonly number[]
  workflowId?: string
  nodeId?: string
  /** Keep every artifact of this run out of publicly-readable storage. */
  forcePrivate?: boolean
}

/** A run additionally carries the quote it was priced under. */
export interface Pro3DRenderRunParams extends Pro3DRenderParams {
  quoteId: string
}

/** The quote's answer. `maxCredits` is a ceiling; quoting spends nothing. */
export type Pro3DRenderQuote = Readonly<Pro3DRenderWireQuote> & Readonly<Record<string, unknown>>

/** Per-call transport controls for the paid run. */
export interface Pro3DRenderRunOptions {
  /**
   * The `Idempotency-Key` the run is submitted under. Reuse the same value when
   * retrying a call that timed out, so the run is not started twice; the SDK
   * generates a fresh one per call when this is omitted, because two deliberate
   * calls are two runs.
   */
  idempotencyKey?: string
}

/**
 * Render the exact scene revision through the existing render-video node.
 *
 * The price follows the plan's OWN `width`/`height`, not any node setting: a
 * frame up to 1920 px on its longest side settles under `render-video`, a
 * larger one under `render-video:3d-large` (1.5x) or, above 5.12 megapixels,
 * `render-video:3d-xlarge` (2.5x). Read the current numbers from the
 * model-cost API for those three identifiers.
 */
export interface RenderScene3DParams extends Record<string, unknown> {
  planType: "3d-scene"
  plan: Scene3DPlan
  workflowId?: string
  nodeId?: string
}

/** Preserve the shared wire contract while allowing additive job metadata. */
export type Scene3DJobOutput = Readonly<Scene3DWireJobOutput> & Readonly<Record<string, unknown>>

/** The settled 3D Render Pro result, plus any additive job metadata. */
export type Pro3DRenderJobOutput = Readonly<Pro3DRenderWireOutput> & Readonly<Record<string, unknown>>
