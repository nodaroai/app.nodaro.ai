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
export interface PluginSceneArtifactToolkit {
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
}
