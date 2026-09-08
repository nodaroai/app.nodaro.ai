import type { NodaroClient } from "../client.js"

/** Public response/transport contracts only; document validation and planning
 * remain in the private Studio codec on the server. */
export type StudioDocumentJson = Record<string, unknown>

export interface StudioProductionCapabilities {
  planVersions: number[]
  operations: {
    readKeyframes: boolean
    saveEditorState?: boolean
    revisionedSharing?: boolean
    editKeyframes: boolean
    generateKeyframes: boolean
    acceptKeyframes: boolean
    generateLinkedClips: boolean
  }
  sourceFrameReferences: boolean
  automaticAcceptance: false
  unattendedGeneration: false
}

export interface StudioKeyframeRecord {
  id: string
  label: string
  revision: number
  nodeId: string
  parentKeyframeId?: string
  previewResultKey: string | null
  previewUrl: string | null
  acceptedResultKey: string | null
  acceptedUrl: string | null
  count: number
  pending: Array<{ jobId: string; startedAt: string }>
  /** Owner-only working state. Recorded acceptance is not an execution grant. */
  plan?: StudioDocumentJson
  acceptance?: StudioDocumentJson
  results?: StudioDocumentJson[]
}

export interface StudioProductionRecord {
  id: string
  name: string
  version: number
  updatedAt: string
  thumbnailUrl: string | null
  shared: boolean
  archived: boolean
  requiredCapabilities?: string[]
  keyframes?: StudioKeyframeRecord[]
  sequences?: StudioDocumentJson[]
  shots: StudioDocumentJson[]
  pending: { stills: number; clips: number; keyframes?: number; music: boolean; draft: StudioDocumentJson | null }
  [field: string]: unknown
}

export interface StudioProductionReply {
  production: StudioProductionRecord
  capabilities?: StudioProductionCapabilities
  warnings?: unknown[]
  [field: string]: unknown
}

export interface StudioEditInput {
  ops: ReadonlyArray<{ op: string; [field: string]: unknown }>
  baseVersion?: number
  strict?: boolean
  clientRequestId?: string
}

export interface StudioKeyframeGenerationInput {
  keyframeId: string
  expectedRevision: number
  clientRequestId?: string
  overrides?: StudioDocumentJson
}

export interface StudioKeyframeAcceptanceInput {
  keyframeId: string
  expectedRevision: number
  resultKey: string
  expectedAcceptedResultKey: string | null
  requirementChecks: Array<{ requirementId: string; outcome: "pass" | "waived" }>
  waivedReason?: string
}

export interface StudioShotGenerationInput {
  kind: "still" | "clip"
  shotId: string
  clientRequestId?: string
  count?: number
  mode?: "start" | "references"
  dryRun?: boolean
  /** Linked clips only: require the exact inputs returned by a reviewed quote. */
  expectedInputHash?: string
  overrides?: StudioDocumentJson
}

export type StudioGenerationReply = {
  jobIds: string[]
  production?: StudioProductionRecord
  deduped?: true
  lane?: string
  [field: string]: unknown
} | {
  dryRun: true; provider: string; count: number; credits: number | null; lane?: string
  /** Linked-clip quotes include normalized settings and accepted endpoint pins. */
  inputHash?: string
  endpointPins?: StudioDocumentJson
  creditIdentifier?: string
  duration?: number
  resolution?: string
  aspectRatio?: string
  sound?: boolean
}

const root = "/v1/studio/productions"
const path = (id: string) => `${root}/${encodeURIComponent(id)}`

/** Cloud plugin routes. Check capabilities before exposing dependency controls.
 * Reads do not reconcile jobs, submit media or accept generated candidates. */
export class StudioResource {
  constructor(private readonly client: NodaroClient) {}

  capabilities(): Promise<{ data: StudioProductionCapabilities }> {
    return this.client.request("GET", `${root}/capabilities`)
  }

  skill(): Promise<{ data: StudioDocumentJson }> {
    return this.client.request("GET", `${root}/skill`)
  }

  list(options: { limit?: number; cursor?: string; includeArchived?: boolean } = {}): Promise<{ data: {
    data: Array<{ id: string; name: string; version: number; updatedAt: string; thumbnailUrl: string | null; shared: boolean; archived: boolean; shotCount: number }>
    nextCursor?: string
  } }> {
    return this.client.request("GET", root, { query: options })
  }

  get(id: string, options: { detail?: "summary" | "full"; shotId?: string } = {}): Promise<{ data: StudioProductionReply }> {
    return this.client.request("GET", path(id), { query: { detail: options.detail, shot_id: options.shotId } })
  }

  validatePlan(plan: StudioDocumentJson): Promise<{ data: { valid: boolean; errors: StudioDocumentJson[]; warnings: StudioDocumentJson[]; summary?: StudioDocumentJson } }> {
    return this.client.request("POST", `${root}/validate`, { body: { plan } })
  }

  create(input: { name?: string; plan?: StudioDocumentJson }): Promise<{ data: StudioProductionReply }> {
    return this.client.request("POST", root, { body: input })
  }

  edit(id: string, input: StudioEditInput): Promise<{ data: StudioProductionReply & { version: number; rebased: boolean; receipts: StudioDocumentJson[] } }> {
    return this.client.request("POST", `${path(id)}/ops`, { body: input })
  }

  /** Audience-authorized sharing; an expected revision prevents publication
   * of concurrent edits the caller has not reviewed. */
  setShared(id: string, input: { shared: boolean; expectedVersion?: number }): Promise<{ data: StudioProductionReply }> {
    return this.client.request("POST", `${path(id)}/share`, { body: input })
  }

  /** Save ordinary editor fields against the loaded revision. Protected frame
   * and job state can only change through their dedicated semantic actions. */
  saveEditorState(id: string, input: { expectedVersion: number; graph: object; clientRequestId?: string }) {
    return this.edit(id, {
      baseVersion: input.expectedVersion, strict: true,
      ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
      ops: [{ op: "save_editor_state", expectedVersion: input.expectedVersion, graph: input.graph }],
    })
  }

  generateKeyframe(id: string, input: StudioKeyframeGenerationInput): Promise<{ data: Exclude<StudioGenerationReply, { dryRun: true }> }> {
    return this.client.request("POST", `${path(id)}/generate`, { body: { ...input, kind: "keyframe" } })
  }

  generateShot(id: string, input: StudioShotGenerationInput): Promise<{ data: StudioGenerationReply }> {
    return this.client.request("POST", `${path(id)}/generate`, { body: input })
  }

  /** A separate explicit review action; generation never calls this method. */
  acceptKeyframe(id: string, input: StudioKeyframeAcceptanceInput,
    concurrency: Pick<StudioEditInput, "baseVersion" | "strict" | "clientRequestId"> = {}) {
    return this.edit(id, { ...concurrency, ops: [{ ...input, op: "accept_keyframe_result" }] })
  }

  reconcile(id: string): Promise<{ data: StudioProductionReply & { landed: string[]; pending: string[]; failed: string[]; version: number } }> {
    return this.client.request("POST", `${path(id)}/reconcile`, { body: {} })
  }
}
