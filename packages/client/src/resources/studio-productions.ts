import type { NodaroClient } from "../client.js"

/**
 * Studio productions — `/v1/studio/productions`.
 *
 * A production is a Nodaro workflow whose `settings.studio` holds the shots:
 * each shot a framed still, an optional animated clip, and the plan, looks,
 * cast bindings and voice that made them. These routes are the platform's own
 * reader and writer of that document, so an agent, a script and the studio app
 * are looking at ONE production rather than three opinions about one row.
 *
 * Two rules run through the whole surface:
 *
 * - **Every change is an OPERATION** ({@link StudioProductionsResource.ops}),
 *   addressed by stable key — a shot id, a role slug, a result's job id or url
 *   — and never by position. That is what lets two writers hold the same
 *   production open: a batch composed against a slightly older version still
 *   applies correctly to the newest one, and the response says whether it was
 *   rebased.
 * - **Generation is run-then-poll.** A still or clip run returns job ids and
 *   records a marker on the production; the results land when anyone — your
 *   poll, the app, a later {@link StudioProductionsResource.reconcile} —
 *   reports the finished job. Nothing waits minutes inside a request.
 *
 * Reads are `detail: "summary"` by default (counts and the active urls);
 * `detail: "full"` adds every result with the context that regenerates it.
 *
 * **The ENVELOPES are typed here; the production DOCUMENT is not.** A view, a
 * summary, a shot and an operation are open JSON on this surface
 * ({@link StudioProduction}, `ops: unknown[]`) — their field-level types ship
 * with the studio app, which is the one consumer that narrows them, and a
 * second spelling of that vocabulary in the SDK would drift from it the first
 * time either grew. Everything a caller branches on — `version`, `rebased`,
 * `receipts`, `warnings`, a quote's `credits`, a run's `jobIds` — is typed.
 *
 * Cloud edition only: these routes 404 on deployments that do not serve them.
 * Feature-detect once with `list()` — a deployment without them 404s that too,
 * where a deployment with them answers an empty page.
 */

/**
 * A production, a summary, a shot, a receipt's target: open JSON.
 *
 * Deliberately not narrowed here — see the note at the top of this module.
 */
export type StudioProduction = Record<string, unknown>

/** How much of a production a read returns. */
export type StudioProductionDetail = "summary" | "full"

/** One thing wrong with a plan, addressed at the field that is wrong. */
export interface StudioPlanIssue {
  path: string
  message: string
  hint?: string
}

/** `GET …/skill` — the authoring skill, rendered at request time from what is live. */
export interface StudioSkillResponse {
  /** The authoring guide. */
  skill: string
  /** Every picker, model and enum, in full. */
  catalog: string
  /** The strict JSON Schema a plan is validated against. */
  schema: Record<string, unknown>
  /** The operating guide: the tool map, the loops, the rules. */
  operating: string
  /** The versions the three were rendered from — bare semver, no package names. */
  generatedFrom: { prompts: string; shared: string; codec: string }
}

export interface StudioValidatePlanResponse {
  valid: boolean
  errors: StudioPlanIssue[]
  warnings: StudioPlanIssue[]
  summary?: {
    name?: string
    scenes: number
    shots: number
    cast: number
    /** Cast entries that matched a row in the caller's library. */
    bound: number
  }
}

export interface StudioListProductionsResponse {
  data: StudioProduction[]
  nextCursor?: string
}

/** What a create or an import did, in the words a receipt would use. */
export interface StudioImportSummary {
  shotsAdded: number
  castEnrolled: number
  /** Cast entries that resolved to a row in the caller's library. */
  castBound: number
}

export interface StudioProductionResponse {
  production: StudioProduction
  warnings?: StudioPlanIssue[]
  summary?: StudioImportSummary
}

export interface StudioCreateProductionRequest {
  name?: string
  plan?: Record<string, unknown>
}

/** The caller's own retry token — 8–128 chars of `A-Za-z0-9_.:-`, never derived. */
export type StudioClientRequestId = string

/**
 * A batch of operations, applied atomically.
 *
 * `ops` is `unknown[]`: the operation union is the studio app's vocabulary and
 * the route validates it, refusing the whole batch with the offending index.
 * The served operating guide is the runtime reference for what an operation
 * looks like.
 */
export interface StudioOpsRequest {
  /** Applied in order. At most 100 per request. */
  ops: unknown[]
  /**
   * The version the batch was composed against. INFORMATIONAL by default: the
   * operations address by stable KEY, so a batch built on a slightly older
   * document still applies exactly to the newest one, and the response says
   * `rebased: true`. Omitting it means "apply to whatever is there".
   */
  baseVersion?: number
  /**
   * Refuse to rebase. With `strict: true` a `baseVersion` older than the stored
   * one is a 409 `workflow_conflict` carrying the current production, instead
   * of a rebased apply — for the rare "replace exactly what I read" intent.
   */
  strict?: boolean
  /** Your own token for this batch, so a transport retry is not applied twice. */
  clientRequestId?: StudioClientRequestId
}

/**
 * One line of what an operation did, in the words a change log would use.
 *
 * Past tense, the target named the way the user sees it, the side effect in a
 * trailing parenthetical: `Deleted take 2 of Shot 1 (in the bin).`
 */
export interface StudioOpsReceipt {
  /** The operation this line reports, by name. */
  op: string
  /** Past tense, naming the target the way a person would. */
  summary: string
  /** Ids the operation MINTED — never ids the caller supplied. */
  ids?: string[]
}

/** What a batch produced. Adopt `production` whole; do not merge into it. */
export interface StudioOpsResponse {
  /** The canonical production AFTER the batch. */
  production: StudioProduction
  /** The version the batch produced. Carry it as the next `baseVersion`. */
  version: number
  /** True when the batch was applied to a newer document than it named. */
  rebased: boolean
  /** One per operation, in order. */
  receipts: StudioOpsReceipt[]
  /**
   * Things worth saying that are not failures — an operation that changed
   * nothing, a rename that rewrote four prompts. A warning never rejects a
   * batch; a refusal does.
   */
  warnings: string[]
}

/** What landing the finished jobs did. */
export interface StudioReconcileResponse {
  /** Job ids whose media is now on the production. */
  landed: string[]
  /** Job ids still running — their markers stay; call again later. */
  pending: string[]
  /** Job ids that failed or were cancelled; their markers are cleared. */
  failed: string[]
  /** One line per landing that had something to say. */
  warnings: string[]
  /** The production after the landings. */
  production: StudioProduction
  /** Its version — unchanged when nothing landed. */
  version: number
}

/** `POST …/:id/describe` — a Director run that will land as scenes. */
export interface StudioDescribeRequest {
  brief: string
  llmModel: string
  /** `"append"` adds the drafted scenes; `"replace"` rewrites the film. */
  mode?: "append" | "replace"
  label?: string
  clientRequestId?: StudioClientRequestId
}

/**
 * `POST …/:id/generate` — one framing or directing run for one shot.
 *
 * `overrides` is what the CALL owns over what the shot's plan says: the model,
 * the prose, the aspect, the direction ids. Open JSON, because the request
 * builders' own option types are the contract and they ship with the studio.
 */
export interface StudioGenerateRequest {
  kind: "still" | "clip"
  shotId: string
  /** Candidates to fan out (stills); the builder clamps it to the catalog's range. */
  count?: number
  /** The directing input mode for a clip; absent ⇒ derived from the inputs. */
  mode?: "start" | "references"
  /** Price the run and return; nothing is submitted and nothing is written. */
  dryRun?: boolean
  clientRequestId?: StudioClientRequestId
  overrides?: Record<string, unknown>
}

/** Which video route a directing run went to — chosen from the inputs, never asked for. */
export type StudioVideoLane = "generate-video" | "text-to-video"

/** `dryRun: true` — what this run would cost, and nothing else. */
export interface StudioGenerateEstimate {
  dryRun: true
  provider: string
  count: number
  /** `null` when the model is unpriced or the instance runs without credits. */
  credits: number | null
  lane?: StudioVideoLane
}

/**
 * A started (or already-started) run.
 *
 * `deduped` means the same `clientRequestId` came back and the job ids were
 * answered from the production's own markers — nothing was submitted and
 * nothing was charged, so `production` is absent.
 */
export interface StudioGenerateResponse {
  jobIds: string[]
  lane?: StudioVideoLane
  deduped?: true
  production?: StudioProduction
  receipts?: StudioOpsReceipt[]
  warnings?: string[]
}

/** `POST …/:id/frame` — a still pulled out of the shot's clip. */
export interface StudioFrameRequest {
  shotId: string
  mode?: "first" | "last" | "timestamp"
  /** Seconds, when `mode` is `"timestamp"`. */
  timestamp?: number
  /** Where the grabbed image lands. `"new-shot"` inserts a shot after this one. */
  target?: "new-shot" | "start-frame" | "end-frame" | "still"
  clientRequestId?: StudioClientRequestId
}

/** `POST …/:id/voice` — synthesize a shot's spoken line and record it. */
export interface StudioVoiceRequest {
  shotId: string
  text: string
  voiceId?: string
  voiceType?: "premade" | "custom" | "library"
  ttsProvider?: string
  /** The delivery levers; the text-to-speech route owns their bounds. */
  delivery?: Record<string, number>
  clientRequestId?: StudioClientRequestId
}

/** `POST …/:id/revoice` — recast the voices of the shot's active clip. */
export interface StudioRevoiceRequest {
  shotId: string
  /** The speaker-ordered recast plan, forwarded to the voice route verbatim. */
  plan: Record<string, unknown>
  clientRequestId?: StudioClientRequestId
}

/** `POST …/:id/music` — the film's soundtrack. */
export interface StudioMusicRequest {
  prompt: string
  duration?: number
  instrumental?: boolean
  vocalGender?: string
  model?: string
  clientRequestId?: StudioClientRequestId
}

/**
 * What a route that finished its work answers with: the production as it now
 * stands, plus whatever that route produced.
 *
 * `jobId` is present on the routes that only STARTED something (a revoice, a
 * soundtrack, a draft) — the result lands through its marker.
 */
export interface StudioMediaResponse {
  production: StudioProduction
  /** The grabbed frame's url, on the frame route. */
  url?: string
  jobId?: string
  receipts?: StudioOpsReceipt[]
  warnings?: string[]
}

/**
 * `GET …/:id/export-plan` — the ordered steps an export would run.
 *
 * The caller runs them with the verbs that already exist; a route that chained
 * three minutes-long jobs is the long-lived request every client times out on.
 */
export interface StudioExportPlanResponse {
  /** False when the production has fewer than two clips — nothing to stitch. */
  canExport: boolean
  steps: StudioExportStep[]
  /** The step whose output IS the film, or `null` when nothing can run. */
  resultStepId: string | null
  /** Total credits, or `null` when ANY step is unpriced (a partial sum understates). */
  estimate: number | null
  /** The credit models with no price, each named once, in step order. */
  unpriced: string[]
}

export interface StudioExportStep {
  /** Stable within one plan and derived from the production, never minted. */
  id: string
  label: string
  /** The node this step runs — `merge-video-audio`, `combine-videos`, `video-upscale`. */
  node: string
  creditModel: string
  credits: number | null
  params: Record<string, unknown>
}

/** `POST …/:id/clone` — a copy, which always starts private and visible. */
export interface StudioCloneRequest {
  name?: string
}

/** Either arm of a generation reply: the quote, or the run that started. */
export type StudioGenerateResult = StudioGenerateEstimate | StudioGenerateResponse

/** True when a generation reply is the `dryRun` QUOTE rather than a started run. */
export function isStudioGenerateEstimate(
  result: StudioGenerateResult,
): result is StudioGenerateEstimate {
  return (result as StudioGenerateEstimate).dryRun === true
}

/** What a `generateStill` / `generateClip` call decides, beyond `kind` and the shot. */
export type StudioGenerateOptions = Omit<StudioGenerateRequest, "kind" | "shotId">

/**
 * A route that only STARTED something — a draft, a revoice, a soundtrack. Its
 * `jobId` is always there, which is what makes `const { jobId } = await …` and
 * a poll the honest next line.
 *
 * `StudioMediaResponse` leaves `jobId` optional because the routes that FINISH
 * their work (a frame, a voiceover) share the shape and have no job to name.
 */
export type StudioJobStartedResponse = StudioMediaResponse & { jobId: string }

export interface ListStudioProductionsOptions {
  limit?: number
  /** From a previous page's `nextCursor`. */
  cursor?: string
  /** Include the rows the dashboard hides. Off by default. */
  includeArchived?: boolean
}

export interface GetProductionOptions {
  detail?: StudioProductionDetail
  /** Read ONE shot — the cheap way to re-read after a generation. */
  shotId?: string
}

export interface StudioExportPlanOptions {
  /** Plan the 4K finish too. Expensive, so it is always explicit. */
  upscale?: boolean
}

/** `client.studio.productions` — see the note at the top of this module. */
export class StudioProductionsResource {
  constructor(private client: NodaroClient) {}

  private path(productionId: string, suffix = ""): string {
    return `/v1/studio/productions/${encodeURIComponent(productionId)}${suffix}`
  }

  // ── reads ────────────────────────────────────────────────────────────────

  /**
   * The authoring guide, the full catalog, the plan's JSON Schema and the
   * operating guide — rendered server-side from the version that is live, so
   * they describe the platform you are actually talking to. Free.
   */
  async skill(): Promise<StudioSkillResponse> {
    const res = await this.client.request<{ data: StudioSkillResponse }>(
      "GET",
      "/v1/studio/productions/skill",
    )
    return res.data
  }

  /**
   * Check a plan before it becomes anything. Free, persists nothing, and
   * resolves cast names against YOUR library — loop on `errors` until
   * `valid: true`, then `create({ plan })`.
   */
  async validatePlan(plan: Record<string, unknown>): Promise<StudioValidatePlanResponse> {
    const res = await this.client.request<{ data: StudioValidatePlanResponse }>(
      "POST",
      "/v1/studio/productions/validate",
      { body: { plan } },
    )
    return res.data
  }

  /** Your productions, newest first. Archived rows are hidden unless asked for. */
  async list(opts: ListStudioProductionsOptions = {}): Promise<StudioListProductionsResponse> {
    const res = await this.client.request<{ data: StudioListProductionsResponse }>(
      "GET",
      "/v1/studio/productions",
      {
        query: {
          limit: opts.limit,
          cursor: opts.cursor,
          includeArchived: opts.includeArchived,
        },
      },
    )
    return res.data
  }

  /**
   * One production. A pure read — it never lands a finished job, so call
   * {@link reconcile} first if you are waiting on one.
   */
  async get(
    productionId: string,
    opts: GetProductionOptions = {},
  ): Promise<StudioProduction> {
    const res = await this.client.request<{ data: { production: StudioProduction } }>(
      "GET",
      this.path(productionId),
      { query: { detail: opts.detail, shot_id: opts.shotId } },
    )
    return res.data.production
  }

  /**
   * The ordered steps that assemble the film, with what they will cost. Run
   * them yourself with the ordinary verbs — nothing here blocks for minutes,
   * and nothing here spends.
   */
  async exportPlan(
    productionId: string,
    opts: StudioExportPlanOptions = {},
  ): Promise<StudioExportPlanResponse> {
    const res = await this.client.request<{ data: StudioExportPlanResponse }>(
      "GET",
      this.path(productionId, "/export-plan"),
      { query: { upscale: opts.upscale } },
    )
    return res.data
  }

  // ── writes ───────────────────────────────────────────────────────────────

  /** A new production, optionally landed from a plan in the same call. */
  async create(input: StudioCreateProductionRequest = {}): Promise<StudioProductionResponse> {
    const res = await this.client.request<{ data: StudioProductionResponse }>(
      "POST",
      "/v1/studio/productions",
      { body: input },
    )
    return res.data
  }

  /**
   * Apply a batch of operations. Atomic: one bad operation refuses the whole
   * batch with a `StudioOpError` naming its index, and nothing is written. On
   * success adopt `production` wholesale and carry `version` forward as the
   * next `baseVersion`.
   */
  async ops(productionId: string, input: StudioOpsRequest): Promise<StudioOpsResponse> {
    const res = await this.client.request<{ data: StudioOpsResponse }>(
      "POST",
      this.path(productionId, "/ops"),
      { body: input },
    )
    return res.data
  }

  /**
   * Land every generation that has finished since you last looked, and report
   * what is still running. The one call that turns finished jobs into results
   * without a browser open. It writes only when something actually landed.
   */
  async reconcile(productionId: string): Promise<StudioReconcileResponse> {
    const res = await this.client.request<{ data: StudioReconcileResponse }>(
      "POST",
      this.path(productionId, "/reconcile"),
    )
    return res.data
  }

  /** Add a plan's scenes to a production that already exists. */
  async importPlan(
    productionId: string,
    plan: Record<string, unknown>,
    opts: { mode?: "append" } = {},
  ): Promise<StudioProductionResponse> {
    const res = await this.client.request<{ data: StudioProductionResponse }>(
      "POST",
      this.path(productionId, "/import"),
      { body: { plan, mode: opts.mode ?? "append" } },
    )
    return res.data
  }

  /**
   * Turn a brief into scenes. The run is a platform job: poll it, and its
   * scenes land through {@link reconcile}. The production comes back with the
   * run recorded on it as a pending draft.
   */
  async describe(
    productionId: string,
    input: StudioDescribeRequest,
  ): Promise<StudioJobStartedResponse> {
    const res = await this.client.request<{ data: StudioJobStartedResponse }>(
      "POST",
      this.path(productionId, "/describe"),
      { body: input },
    )
    return res.data
  }

  // ── generation ───────────────────────────────────────────────────────────

  /**
   * Frame or animate one shot.
   *
   * The request is assembled server-side from the shot's own plan, looks and
   * bound references, so a scripted run and a press of the button in the app
   * produce the same media; `overrides` changes THIS run without changing the
   * shot. Prefer {@link generateStill} / {@link generateClip}, which say which
   * kind they mean.
   *
   * `dryRun: true` returns the quote and writes nothing — narrow the reply with
   * {@link isStudioGenerateEstimate}.
   */
  generate(
    productionId: string,
    input: StudioGenerateRequest & { dryRun: true },
  ): Promise<StudioGenerateEstimate>
  generate(
    productionId: string,
    input: StudioGenerateRequest,
  ): Promise<StudioGenerateResult>
  async generate(
    productionId: string,
    input: StudioGenerateRequest,
  ): Promise<StudioGenerateResult> {
    const res = await this.client.request<{ data: StudioGenerateResult }>(
      "POST",
      this.path(productionId, "/generate"),
      { body: input },
    )
    return res.data
  }

  /**
   * Frame a shot: submit `count` candidates and record a pending marker for
   * each. Results ACCUMULATE — a generate never replaces what is there.
   *
   * `clientRequestId` makes a retry safe: the same token answers with the jobs
   * the first call started (`deduped: true`) and submits nothing. Never retry a
   * spend without it.
   */
  generateStill(
    productionId: string,
    shotId: string,
    opts: StudioGenerateOptions & { dryRun: true },
  ): Promise<StudioGenerateEstimate>
  generateStill(
    productionId: string,
    shotId: string,
    opts?: StudioGenerateOptions,
  ): Promise<StudioGenerateResult>
  generateStill(
    productionId: string,
    shotId: string,
    opts: StudioGenerateOptions = {},
  ): Promise<StudioGenerateResult> {
    return this.generate(productionId, { ...opts, kind: "still", shotId })
  }

  /**
   * Animate a shot. The LANE is chosen from the shot's inputs (a start frame,
   * references, a prompt) — never passed in — and reported back as `lane`.
   */
  generateClip(
    productionId: string,
    shotId: string,
    opts: StudioGenerateOptions & { dryRun: true },
  ): Promise<StudioGenerateEstimate>
  generateClip(
    productionId: string,
    shotId: string,
    opts?: StudioGenerateOptions,
  ): Promise<StudioGenerateResult>
  generateClip(
    productionId: string,
    shotId: string,
    opts: StudioGenerateOptions = {},
  ): Promise<StudioGenerateResult> {
    return this.generate(productionId, { ...opts, kind: "clip", shotId })
  }

  // ── media on one shot ────────────────────────────────────────────────────

  /**
   * Extract a frame from a shot's active clip and put it where `target` says —
   * a new shot after this one (the default), this shot's sticky start or end
   * frame, or another still of the same shot. Seconds, not minutes: this one
   * waits for the job and answers with the changed production.
   */
  async frame(
    productionId: string,
    input: StudioFrameRequest,
  ): Promise<StudioMediaResponse> {
    const res = await this.client.request<{ data: StudioMediaResponse }>(
      "POST",
      this.path(productionId, "/frame"),
      { body: input },
    )
    return res.data
  }

  /** Synthesize a shot's spoken line and record it. Waits for the job. */
  async voice(
    productionId: string,
    input: StudioVoiceRequest,
  ): Promise<StudioMediaResponse> {
    const res = await this.client.request<{ data: StudioMediaResponse }>(
      "POST",
      this.path(productionId, "/voice"),
      { body: input },
    )
    return res.data
  }

  /**
   * Recast the voices of a shot's active clip. Minutes of work, so it answers
   * `jobId` and the new clip lands as a result through its own marker.
   */
  async revoice(
    productionId: string,
    input: StudioRevoiceRequest,
  ): Promise<StudioJobStartedResponse> {
    const res = await this.client.request<{ data: StudioJobStartedResponse }>(
      "POST",
      this.path(productionId, "/revoice"),
      { body: input },
    )
    return res.data
  }

  /** Score the film. The finished track lands through its pending marker. */
  async music(
    productionId: string,
    input: StudioMusicRequest,
  ): Promise<StudioJobStartedResponse> {
    const res = await this.client.request<{ data: StudioJobStartedResponse }>(
      "POST",
      this.path(productionId, "/music"),
      { body: input },
    )
    return res.data
  }

  // ── audience and copies ──────────────────────────────────────────────────

  /**
   * Open the share-by-link read. Deliberately its own route rather than an
   * operation: who may see the work is decided by the owner, never as a side
   * effect of a batch that was editing something else.
   */
  async share(productionId: string): Promise<StudioProduction> {
    const res = await this.client.request<{ data: StudioMediaResponse }>(
      "POST",
      this.path(productionId, "/share"),
      { body: { shared: true } },
    )
    return res.data.production
  }

  /** Close it again. Sharing is opt-in AND reversible. */
  async unshare(productionId: string): Promise<StudioProduction> {
    const res = await this.client.request<{ data: StudioMediaResponse }>(
      "POST",
      this.path(productionId, "/unshare"),
    )
    return res.data.production
  }

  /**
   * Copy a production you own or can see into your own Studio project. The
   * copy starts PRIVATE and visible — sharing and archiving never travel — and
   * it is copied through YOUR view of the source, so somebody else's bin does
   * not come with it.
   */
  async clone(
    productionId: string,
    input: StudioCloneRequest = {},
  ): Promise<StudioProduction> {
    const res = await this.client.request<{ data: { production: StudioProduction } }>(
      "POST",
      this.path(productionId, "/clone"),
      { body: input },
    )
    return res.data.production
  }
}

