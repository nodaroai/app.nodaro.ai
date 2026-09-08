/** Opaque owned artifacts. No authoring recipe or service protocol crosses this boundary. */
export type PluginSceneArtifactKind = "glb" | "camera-track-json" | "poster" | "validation-report" | "blend-source" | "source-json" | "build-manifest"
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
export interface PluginSceneDeliveryPublish extends PluginSceneArtifactScope {
  source: { kind: "retained-revision" | "job-output"; jobId?: string }
  mode: "authored" | "render-only"
  plan: unknown
  artifacts: Array<{
    artifactId: string; kind: "poster" | "validation-report"; sha256: string; byteLength: number
    reuseFromRevisionId?: string
  }>
}
export interface PluginSceneArtifactToolkit {
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
}
