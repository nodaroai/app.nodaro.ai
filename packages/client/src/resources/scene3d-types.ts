import type { Scene3DPlan, Scene3DPlanV2, Scene3DReference, Scene3DEditOperation, Scene3DV2EditOperation, Scene3DJobOutputAny as Scene3DWireJobOutput, Pro3DRenderCapabilities, Pro3DRenderEngine, Pro3DRenderJobOutput as Pro3DRenderWireOutput, Pro3DRenderQuality, Pro3DRenderQuote as Pro3DRenderWireQuote, Pro3DRenderSource, Pro3DRenderStyle } from "@nodaro/shared/scene3d"
import type { GenerationSessionParams } from "./nodes.js"

/** Reuse newRevisionId for transport retries of the same immutable edit. */
export interface RetainedScene3DEditParams {
  newRevisionId: string
  expectedContentHash: string
  operations: readonly Scene3DV2EditOperation[]
  lockedObjectIds?: readonly string[]
}
export interface RetainedScene3DEditResult { scenePlan: Scene3DPlanV2; changeSummary: string }

/**
 * The kind of bytes a delivery descriptor names, and the usage it is pinned under.
 *
 * PAIRED, not two free enums: the platform refuses a pin whose usage is not the one its kind is
 * defined to have, and a client that checks only one of the two would accept a mis-pinned
 * artifact the server would then refuse. {@link SCENE3D_DELIVERY_ASSET_USAGE} is the map both
 * halves are read from.
 */
export const SCENE3D_DELIVERY_ASSET_USAGE = {
  poster: "poster",
  "validation-report": "validation",
  "shot-still": "shot-still",
  /** The recipe a run that never compiled was refused for. See {@link Scene3DDeliveryAsset}. */
  "source-json": "checkpoint",
} as const

export type Scene3DDeliveryAssetKind = keyof typeof SCENE3D_DELIVERY_ASSET_USAGE

/**
 * One artifact a delivery pins, as a descriptor: opaque ids and digests only.
 *
 * Four kinds, and two of them are conditional:
 *
 * - `poster` and `validation-report` are on every delivery;
 * - `shot-still` appears once per shot on a render that produced a contact sheet, and carries
 *   its own shot identity (`shotIndex`, `frame`, and the frame size);
 * - `source-json` appears on ONE shape only — a `refused-authoring` delivery, published by a
 *   3D Render Pro run whose recipe the compiler refused on every pass. It is the planner's last
 *   admitted recipe, and it is the only thing such a run leaves that names what was attempted.
 *   Reading it needs `edit` on the job's workflow (the same access the `.blend` export costs);
 *   a reader with less simply does not see the descriptor.
 */
export interface Scene3DDeliveryAsset {
  assetId: string
  kind: Scene3DDeliveryAssetKind
  usage: (typeof SCENE3D_DELIVERY_ASSET_USAGE)[Scene3DDeliveryAssetKind]
  byteLength: number
  sha256: string
  viaRevisionId: string | null
  /** Set on a `shot-still` and absent on every other kind — never `null`. */
  shotIndex?: number
  frame?: number
  width?: number
  height?: number
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
export interface GenerateScene3DParams extends Record<string, unknown>, Scene3DEngineParams, GenerationSessionParams {
  /** Existing GLBs selected by immutable revision/artifact IDs. Requires an import-capable advanced engine. */
  inputAssets?: readonly import("@nodaro/shared/scene3d").Scene3DInputAsset[]
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
export interface EditScene3DParams extends Record<string, unknown>, Scene3DEngineParams, GenerationSessionParams {
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
export interface RenderScene3DParams extends Record<string, unknown>, GenerationSessionParams {
  planType: "3d-scene"
  plan: Scene3DPlan
  workflowId?: string
  nodeId?: string
}

/**
 * Preserve the shared wire contract while allowing additive job metadata.
 *
 * A scene authored by an ADVANCED engine additionally reports what the run knows about its own
 * answer, every field optional and all of them absent on the deterministic Basic lane:
 * `validation.warnings[]` entries coded `SCENE_AUTHORING_ASSUMPTION` (the planner's
 * assumptions), `metadata.summary` (its description of what it authored), `repairPasses`
 * (repairs actually run — `0` when the scene was accepted first time), `admissionRetries`
 * (pre-build planner retries, which spend no repair pass), `mechanicalPasses` (repairs the engine
 * applied from the compiler's own remedy with no planner call, counted APART from `repairPasses`
 * on their own quoted allowance, each with a `REMEDY_AUTO_APPLIED` warning) and
 * `restoredAssertions` (mandatory assertions put back after a planner answer re-shaped one the
 * feedback had not named, each a `ASSERTION_RESTORED` warning).
 *
 * A scene that passed every mandatory assertion but did not get the visual reviewer's approval
 * is delivered anyway, and `metadata.review` carries a verdict saying why. `verdict: "refused"`
 * is the ADVISORY delivery — the reviewer objected once the repair budget was spent — with one
 * `SCENE_REVIEW_REFUSED` warning per objection. `verdict: "unavailable"` is the UNREVIEWED
 * delivery: the review produced no usable verdict after `attempts` asks — `reason: "provider"`
 * when it never reached its provider, `"unusable"` when the provider answered with nothing usable
 * (`Scene3DReviewUnavailableReason` in `@nodaro/shared`) — so nobody judged the scene, and
 * `validation.warnings[]` LEADS with `SCENE_REVIEW_UNAVAILABLE` (any objections under it came from
 * review batches that answered usably first, and are not the whole verdict).
 *
 * `validation.status` stays `"passed"` on both, so `metadata.review` being present is the only
 * reliable test — use `scene3DReviewVerdictOf` from `@nodaro/shared` rather than reading it by
 * hand, and `scene3DReviewNote` rather than writing the sentence yourself: a message that says
 * the reviewer refused a scene nobody reviewed invents an opinion.
 */
export type Scene3DJobOutput = Readonly<Scene3DWireJobOutput> & Readonly<Record<string, unknown>>

/**
 * The settled 3D Render Pro result, plus any additive job metadata.
 *
 * On a run that AUTHORED, the result reports the run's own account of its answer:
 * `validation.warnings[]` entries coded `SCENE_AUTHORING_ASSUMPTION`, `metadata.summary`,
 * `repairPasses` (`0` when accepted first time), `admissionRetries` (pre-build planner retries,
 * which spend no repair pass), `mechanicalPasses` (repairs the engine authored itself from the
 * compiler's own remedy, counted APART from `repairPasses` because they buy their own quoted
 * allowance rather than spending one of your repairs) and `restoredAssertions`. A render-only
 * export authored nothing, so it carries no summary and omits the counts rather than claiming `0`.
 *
 * The one case where `mechanicalPasses` IS a subset of `repairPasses` is a run quoted before that
 * allowance existed — its quote carries no `mechanical` line. The discriminant is the quote, not
 * the result, so read the quote you were given rather than deriving it from the two counts.
 *
 * A completed result may also be published without the visual reviewer's approval, and then
 * `metadata.review` holds a verdict saying which way. `{ verdict: "refused", objections[],
 * observed? }` is the ADVISORY delivery: every mandatory assertion passed, the reviewer still
 * objected, and the scene was published once the repair budget was spent, with one
 * `SCENE_REVIEW_REFUSED` warning per objection. `{ verdict: "unavailable", reason, attempts,
 * objections[], observed? }` is the UNREVIEWED delivery: the review produced no usable verdict in
 * `attempts` asks — `reason: "provider"` when it never reached its provider, `"unusable"` when the
 * provider answered with nothing usable — so the assertion-passing scene was delivered with no
 * verdict on it and `validation.warnings[]` LEADS with `SCENE_REVIEW_UNAVAILABLE`. Objections on
 * that arm are whatever review batches answered usably first — real, but not the whole verdict.
 *
 * `validation.status` is `"passed"` on both, so test for `metadata.review` — via
 * `scene3DReviewVerdictOf` from `@nodaro/shared` — rather than for the status or the warnings,
 * and render it with `scene3DReviewNote` rather than assuming a refusal.
 */
export type Pro3DRenderJobOutput = Readonly<Pro3DRenderWireOutput> & Readonly<Record<string, unknown>>
