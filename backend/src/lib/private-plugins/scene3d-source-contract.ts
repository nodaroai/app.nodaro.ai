/** Canonical source metadata for quoting or admission; this does not grant execution. */
export interface PluginSceneSourceRequest {
  userId: string
  revisionId: string
  sourceJobId?: string
  requiredAccess: "view" | "edit"
}

export interface PluginSceneSource {
  kind: "retained-revision" | "job-output"
  revisionId: string
  ownerId: string
  workflowId: string | null
  sourceJobId: string | null
  plan: unknown
  planSha256: string
  contentHash: string | null
  access: "view" | "edit" | "own"
}
