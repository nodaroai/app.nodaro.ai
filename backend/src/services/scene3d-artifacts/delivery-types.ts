import type { Scene3DArtifactPublishInput, Scene3DPinnedArtifact } from "./types.js"

export const SCENE3D_DELIVERY_KINDS = ["poster", "validation-report"] as const
export type Scene3DDeliveryKind = (typeof SCENE3D_DELIVERY_KINDS)[number]
export type Scene3DDeliverySourceKind = "retained-revision" | "job-output"
export type Scene3DDeliveryMode = "render-only" | "authored"

export interface Scene3DDeliveryRecord {
  jobId: string
  userId: string
  workflowId: string | null
  sourceKind: Scene3DDeliverySourceKind
  sourceRevisionId: string
  sourcePlanSha256: string
  sourceContentHash: string | null
  sourceJobId: string | null
  sourceOwnerId: string
  sourceWorkflowId: string | null
  mode: Scene3DDeliveryMode
  createdAt: string
}

export interface Scene3DDeliveryArtifact extends Scene3DPinnedArtifact {
  viaRevisionId: string | null
}

export interface Scene3DDeliveryPublishInput {
  jobId: string
  userId: string
  revisionId: string
  source: { kind: Scene3DDeliverySourceKind; jobId?: string }
  mode: Scene3DDeliveryMode
  plan: unknown
  artifacts: Array<Omit<Scene3DArtifactPublishInput, "kind" | "expiresAt"> & { kind: Scene3DDeliveryKind }>
}

export interface Scene3DDeliveryPublishResult {
  deliveryId: string
  revisionId: string
  status: "created" | "unchanged"
  artifactIds: string[]
}
