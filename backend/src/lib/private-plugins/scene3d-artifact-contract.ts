/** Opaque owned artifacts. No authoring recipe or service protocol crosses this boundary. */
export type PluginSceneArtifactKind = "glb" | "camera-track-json" | "poster" | "validation-report" | "blend-source" | "source-json"
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
export interface PluginSceneArtifactToolkit {
  grant(input: PluginSceneArtifactUpload): Promise<PluginSceneArtifactGrant>
  receive(input: PluginSceneArtifactScope & { artifactId: string }): Promise<PluginSceneArtifactReceipt>
  /** Bounded, digest-verified bytes of this active job's reserved artifact. Never a user API. */
  read(input: PluginSceneArtifactScope & { artifactId: string }, options?: { signal?: AbortSignal }): Promise<Uint8Array>
  /** Workflow scope comes from the owned parent job, never from a producer manifest. */
  publish(input: PluginSceneArtifactPublish): Promise<{ revisionId: string; status: "created" | "unchanged"; artifactIds: string[] }>
}
