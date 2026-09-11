/** Opaque owned artifacts. No authoring recipe or service protocol crosses this boundary. */
export type PluginSceneArtifactKind = "glb" | "camera-track-json" | "poster" | "validation-report" | "blend-source" | "source-json" | "build-manifest" | "input-glb" | "shot-still"
export interface PluginSceneArtifactScope { jobId: string; userId: string; revisionId: string }
export interface PluginSceneArtifactUpload extends PluginSceneArtifactScope {
  artifactId: string
  kind: PluginSceneArtifactKind
  expiresInSeconds?: number
}
export interface PluginSceneArtifactGrant {
  key: string
  method: "PUT"
  url: string
  headers: Record<string, string>
  verifyUrl: string
  verifyHeaders: Record<string, string>
  expiresAt: number
}
export interface PluginSceneArtifactReceipt {
  artifactId: string
  kind: PluginSceneArtifactKind
  objectKey: string
  sha256: string
  byteLength: number
  etag: string
}
export interface PluginSceneArtifactPublish extends PluginSceneArtifactScope {
  parentRevisionId?: string
  plan: unknown
  artifacts: Array<{
    artifactId: string; kind: PluginSceneArtifactKind; sha256: string; byteLength: number
    reuseFromRevisionId?: string
  }>
}
/** A previous revision's authoring recipe, requested for private re-authoring. */
export interface PluginSceneAuthoringSourceRequest {
  /** The active owned job doing the re-authoring, not the job that published the revision. */
  jobId: string
  userId: string
  revisionId: string
  /** `provenance.contentHash` of the revision the caller prepared against. */
  expectedContentHash: string
}
export interface PluginSceneAuthoringSource {
  /** The published plan of that revision, manual overlays included. */
  plan: unknown
  source: Uint8Array
  sourceArtifactId: string
  sourceSha256: string
  /** Verified private input pins of this revision, not additional playback assets. */
  inputArtifacts?: Array<{ assetId: string; kind: "glb"; sha256: string; byteLength: number }>
}
export interface PluginSceneJobEditRequest {
  jobId: string
  userId: string
  revisionId: string
  newRevisionId: string
  expectedContentHash: string
  operations: readonly unknown[]
  lockedObjectIds?: readonly string[]
}
/**
 * What a finished export retains.
 *
 * `shot-still` entries are OPTIONAL and additive — zero of them is a complete
 * delivery — but when any are present they must be the composition's WHOLE
 * shot set: `shotIndex` is the 0-based position in the v2 `shots` array (a v1
 * scene is one shot, index 0) and `frame` is that shot's own first frame. The
 * platform re-derives both from the manifest and refuses a set that disagrees,
 * so a producer cannot publish a contact sheet that mislabels a shot.
 *
 * `width`/`height` may be omitted: the composition's frame size is then
 * recorded, which is what the render was asked to produce.
 */
export interface PluginSceneDeliveryPublish extends PluginSceneArtifactScope {
  source: { kind: "retained-revision" | "job-output"; jobId?: string }
  mode: "authored" | "render-only"
  plan: unknown
  artifacts: Array<{
    artifactId: string; kind: "poster" | "validation-report" | "shot-still"; sha256: string; byteLength: number
    reuseFromRevisionId?: string
    /** Required on `shot-still`, refused on every other kind. */
    shotIndex?: number
    frame?: number
    width?: number
    height?: number
  }>
}
/**
 * The evidence a Pro authoring run retains when its recipe NEVER compiled.
 *
 * Separate from `PluginSceneDeliveryPublish` rather than a widening of it, because the two
 * have no evidence in common. A rendered delivery pins a poster and names the plan it was
 * rendered from; a refused one has neither — the compiler produced no plan, so no revision
 * could be published and nothing was ever rendered. What it does have is the compiler's
 * reasons (the report) and the planner's final recipe, and pinning them is the only thing
 * that keeps them reachable at all.
 *
 * `revisionId` is the attempt identity the artifacts were reserved under, not a published
 * scene: it binds the pins to this parent's own upload reservations. The recipe is retained,
 * never published — `source-json` is a private checkpoint kind, so the delivery routes
 * neither list it nor serve its bytes.
 */
export interface PluginSceneRefusedDeliveryPublish extends PluginSceneArtifactScope {
  source: { kind: "refused-authoring" }
  mode: "authored"
  /** Exactly one `validation-report`; at most one `source-json` beside it. */
  artifacts: Array<{ artifactId: string; kind: "validation-report" | "source-json"; sha256: string; byteLength: number }>
}
export interface PluginSceneArtifactToolkit {
  /** Resolve an authorized pinned input before quoting; immutable metadata only, no fetch grant. */
  resolveInput?(input: { userId: string; revisionId: string; assetId: string },
    options?: { signal?: AbortSignal }): Promise<{
      assetId: string; sourceRevisionId: string; kind: "glb"; sha256: string; byteLength: number
    }>
  /** Copy an authorized input into this active job's owned immutable retention reservation. */
  retainInput?(input: PluginSceneArtifactScope & { artifactId: string; sourceRevisionId: string;
    asset: { assetId: string; kind: "glb"; sha256: string; byteLength: number } },
    options?: { signal?: AbortSignal }): Promise<PluginSceneArtifactReceipt>
  /** Authorize an immutable input artifact for an active owned job, then sign a bounded GET. */
  grantInput?(input: { jobId: string; userId: string; sourceRevisionId: string;
    asset: { assetId: string; kind: "glb"; sha256: string; byteLength: number }; expiresInSeconds: number },
    options?: { signal?: AbortSignal }): Promise<{
      assetId: string; kind: "glb"; sha256: string; byteLength: number;
      fetch: { method: "GET"; url: string; headers?: Record<string, string> }
    }>
  /** Persist deterministic v2 edits for an active owned job, without generation. */
  applyEdits?(input: PluginSceneJobEditRequest, options?: { signal?: AbortSignal }): Promise<{ scenePlan: unknown; changeSummary: string }>
  /** Quote/admission source resolution uses current canonical scene permissions. */
  resolveSource?(input: import("./scene3d-source-contract.js").PluginSceneSourceRequest): Promise<import("./scene3d-source-contract.js").PluginSceneSource>
  grant(input: PluginSceneArtifactUpload): Promise<PluginSceneArtifactGrant>
  receive(input: PluginSceneArtifactScope & { artifactId: string }): Promise<PluginSceneArtifactReceipt>
  /** Store bounded JSON at an owned immutable key; repeated identical writes adopt the receipt. */
  writeJson?(input: PluginSceneArtifactUpload & { bytes: Uint8Array }, options?: { signal?: AbortSignal }): Promise<PluginSceneArtifactReceipt>
  /** Bounded, digest-verified bytes of this active job's reserved artifact. Never a user API. */
  read(input: PluginSceneArtifactScope & { artifactId: string }, options?: { signal?: AbortSignal }): Promise<Uint8Array>
  /** Bytes of a PREVIOUS revision's pinned recipe, authorized through that revision. Never a user API. */
  readAuthoringSource?(input: PluginSceneAuthoringSourceRequest, options?: { signal?: AbortSignal }): Promise<PluginSceneAuthoringSource>
  /** Workflow scope comes from the owned parent job, never from a producer manifest. */
  publish(input: PluginSceneArtifactPublish): Promise<{ revisionId: string; status: "created" | "unchanged"; artifactIds: string[] }>
  /** Retain export evidence without cloning or modifying the source revision. */
  publishDelivery?(input: PluginSceneDeliveryPublish): Promise<{
    deliveryId: string; revisionId: string; status: "created" | "unchanged"; artifactIds: string[]
  }>
  /** Retain the evidence of authoring that never compiled: the refusal report, and privately
   *  the last recipe. Absent on a host that predates the refused lane, which is what makes
   *  retention degrade to "nothing was kept" instead of failing the run. */
  publishRefusedDelivery?(input: PluginSceneRefusedDeliveryPublish): Promise<{
    deliveryId: string; revisionId: string; status: "created" | "unchanged"; artifactIds: string[]
  }>
}
