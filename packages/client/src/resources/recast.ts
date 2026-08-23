import type { NodaroClient } from "../client.js"

/**
 * Recast — regenerate an analyzed source video with your own cast (the engine
 * behind recast.nodaro.ai), plus the authored-script import lane ("movie as
 * JSON", no source video).
 *
 * Cloud edition only: the `/v1/recast/*` and `/v1/video-analysis/import*`
 * routes are served by the cloud plugin and 404 on self-hosted installs.
 * Wire contract: docs/api-integration.md §13c/§13d and
 * docs/mcp/recast-authoring.md. The interactive run is server-driven — poll
 * `get()` and answer gates with `resolveGate()`; the platform advances every
 * non-gate step itself.
 */

export interface RecastScriptValidationError {
  path: string
  message: string
  /** Written for an LLM repair loop — fix `path` using this and re-validate. */
  hint?: string
}

export interface RecastScriptValidation {
  valid: boolean
  errors: RecastScriptValidationError[]
  warnings: string[]
}

export interface RecastScriptImportResult {
  /** A standard completed analysis job — feed it to `create()` as `analysisJobId`. */
  jobId: string
  /** false when an identical script was already imported (idempotent re-import). */
  created: boolean
  warnings: string[]
  /** The document of record — WITH the server-derived fields; always prefer it
   *  over your input. */
  json: Record<string, unknown>
}

export interface CreateRecastInput {
  /** Required: an existing workflow you own that the run attaches to. */
  workflowId: string
  /** The source analysis job (from a video analysis or an authored-script import). */
  analysisJobId: string
  /** Authored imports render `"faithful"` — exactly as written. */
  fidelity?: string
  /** Required (`true`) for faithful renders of authored scripts. */
  rightsAttested?: boolean
  resolution?: string
  segmentSec?: number
  renderMethod?: string
  /** Opt in to the interactive walk (pick-1-of-3 gates surfaced via `get()`). */
  interactive?: boolean
  provider?: string
  /**
   * Interactive gates the CLIENT can answer, e.g. `["sheet-gate"]`. The
   * platform only opens a gate kind for runs whose create declared support
   * for it — undeclared kinds are decided automatically.
   */
  clientCapabilities?: string[]
}

export type EstimateRecastInput = Omit<CreateRecastInput, "workflowId" | "rightsAttested" | "clientCapabilities">

export interface RecastEstimate {
  totalCredits?: number
  breakdown?: Record<string, number>
  [key: string]: unknown
}

export type RecastAudioLayerName = "music" | "video"

export interface RecastAudioMixControl {
  /** Linear gain percentage. The server rounds and clamps this to 0–200. */
  gain: number
  /** A muted lane has an effective wire gain of zero. */
  muted: boolean
}

/** Complete desired controls for the logical lanes addressed by an operation. */
export interface RecastAudioMix {
  music?: RecastAudioMixControl
  video?: RecastAudioMixControl
}

export interface RecastAudioManifestV1 {
  version: 1
  /** Opaque server-minted identity of the currently published audio delivery. */
  revision: string
  mode: "bed" | "replace"
  /** Logical layers in the delivery, including layers whose preview derivative failed. */
  present: { music?: true; video?: true }
  /** Browser-ready, CORS-enabled audio-only derivatives. */
  layers: { music?: { url: string }; video?: { url: string } }
  /** Effective integer gain percentages baked into the current `resultUrl`. */
  bakedEffectiveGain: { music?: number; video?: number }
  /** Present only while a paid audio operation is genuinely live. */
  pendingRescore?: {
    jobId: string
    requestId: string
    state: "pending" | "running"
    expectedAudioRevision: string
    requestedEffectiveGain: { music?: number; video?: number }
  }
}

export interface RecastAudioSectionReplacement {
  index: number
  brief: string
}

/** Exactly one replacement lane may be combined with a mix. */
export type RecastRescoreReplacement =
  | { audioUrl: string; sections?: never }
  | { sections: RecastAudioSectionReplacement[]; audioUrl?: never }

type RecastNoReplacement = { audioUrl?: never; sections?: never }

/** A mix, one Music replacement, or a replacement and its complete desired mix. */
export type RecastRescoreOperation =
  | ({ mix: RecastAudioMix } & (RecastRescoreReplacement | RecastNoReplacement))
  | (RecastRescoreReplacement & { mix?: RecastAudioMix })

/** Free quote input. `requestId` is deliberately absent because quoting has no side effects. */
export type EstimateRecastRescoreInput = RecastRescoreOperation & {
  expectedAudioRevision: string
}

/** Revision-safe paid operation. Reuse `requestId` only for transport retries. */
export type RecastRescoreRequestV2 = EstimateRecastRescoreInput & {
  requestId: string
}

export interface RecastRescoreQuote {
  credits: number
  audioRevision: string
  noOp: boolean
}

export type RecastRescoreResponse =
  | { recastId: string; jobId: string; noOp?: false }
  | { recastId: string; noOp: true; audioRevision: string }

/** Run snapshot — `status` plus, on interactive runs, the pending step. */
export interface RecastRunSnapshot {
  status: string
  interactive?: Record<string, unknown>
  /** Presence of `audioLayers: 1` opts a client into the revisioned audio contract. */
  capabilities?: { audioLayers?: 1; [key: string]: unknown }
  /** Server-authored manifest for the selected completed take. */
  audio?: RecastAudioManifestV1
  [key: string]: unknown
}

export interface ResolveRecastGateInput {
  /** Which gate the picks answer. Defaults server-side to `"cast"`. */
  gate?: "cast" | "sheet" | "anchors" | "music"
  /** cast / sheet gates: the pick payload as surfaced by the pending gate. */
  picks?: unknown
  /** anchors gate: which segment the anchor picks apply to. */
  segment?: number
  anchorPicks?: { start?: number; end?: number }
  /** music gate: which section the pick applies to. */
  section?: number
  musicPick?: number | string
  /** Let the critic decide this and every remaining gate automatically. */
  finishAuto?: boolean
}

export class RecastResource {
  constructor(private client: NodaroClient) {}

  // ── Authored-script lane (all three endpoints are free) ────────────────

  /** The generated authoring guide (markdown): document contract, enum
   *  vocabularies, bounds, audio rules, and a validated worked example. */
  async authoringSkill(): Promise<string> {
    const res = await this.client.request<{ markdown?: string }>(
      "GET",
      "/v1/video-analysis/authoring-skill",
    )
    return res.markdown ?? ""
  }

  /** FREE validation of an authored script. Loop until `valid: true`. */
  validateScript(script: Record<string, unknown>): Promise<RecastScriptValidation> {
    return this.client.request("POST", "/v1/video-analysis/import/validate", {
      body: { script },
    })
  }

  /**
   * Import a VALIDATED authored script as a completed analysis job.
   * `rightsAttested: true` is required (403 otherwise) — authored recasts
   * render Faithful, exactly as written, so only import work you own.
   */
  importScript(
    script: Record<string, unknown>,
    opts: { rightsAttested: true },
  ): Promise<RecastScriptImportResult> {
    return this.client.request("POST", "/v1/video-analysis/import", {
      body: { script, rightsAttested: opts.rightsAttested },
    })
  }

  // ── Run lane ───────────────────────────────────────────────────────────

  /** Quote a run (credits) before buying the plan. */
  estimate(input: EstimateRecastInput): Promise<RecastEstimate> {
    return this.client.request("POST", "/v1/recast/estimate", { body: input })
  }

  /** Create a run (buys the plan). Returns `{ recastId }`. */
  create(input: CreateRecastInput): Promise<{ recastId: string }> {
    return this.client.request("POST", "/v1/recast", { body: input })
  }

  /** Poll the run — status plus any pending interactive step. */
  get(recastId: string): Promise<RecastRunSnapshot> {
    return this.client.request("GET", `/v1/recast/${encodeURIComponent(recastId)}`)
  }

  /** Quote a revisioned Music replacement and/or complete desired mix. Free. */
  estimateRescore(
    recastId: string,
    input: EstimateRecastRescoreInput,
  ): Promise<RecastRescoreQuote> {
    return this.client.request(
      "POST",
      `/v1/recast/${encodeURIComponent(recastId)}/estimate-rescore`,
      { body: input },
    )
  }

  /** Apply a quoted audio operation. Reuse its request id only for a transport retry. */
  rescore(
    recastId: string,
    input: RecastRescoreRequestV2,
  ): Promise<RecastRescoreResponse> {
    return this.client.request(
      "POST",
      `/v1/recast/${encodeURIComponent(recastId)}/rescore`,
      { body: input },
    )
  }

  /** Start rendering a `planned` run. Idempotent server-side. */
  start(
    recastId: string,
    opts: { segmentSec?: number; provider?: string } = {},
  ): Promise<{ gvpJobId?: string }> {
    return this.client.request("POST", `/v1/recast/${encodeURIComponent(recastId)}/start`, {
      body: opts,
    })
  }

  /** Answer a pending interactive gate (the pick itself is free). */
  resolveGate(recastId: string, input: ResolveRecastGateInput): Promise<Record<string, unknown>> {
    return this.client.request("POST", `/v1/recast/${encodeURIComponent(recastId)}/select`, {
      body: input,
    })
  }
}
