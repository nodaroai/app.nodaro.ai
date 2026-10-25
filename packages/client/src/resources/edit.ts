import type { NodaroClientCore } from "../core.js"
import { ForbiddenError, NodaroError } from "../errors.js"
import {
  remapTranscriptThroughEdl,
  unwrapEditPlanOutput,
  resolveEditPlanSources,
  describeAudioSyncOffsetIssue,
  transcriptSpeakerLabels,
  cameraSwitchSpeakerMap, speakerMapResultOf, type SpeakerMapResult,
  type Edl,
  type Transcript,
  type EditPlanMode,
  type EditPlanTier,
  type EdlClipSet,
  type ChapterSet,
  type EdlTargetAspect
} from "@nodaro/shared/edl"
import { USE_CASE_NODE_TYPES, isUseCaseNodeType, type UseCaseNodeType } from "@nodaro/shared/nodes"
import type { SpeakerMapInput } from "./speaker-map-inputs.js"
import {
  chaptersBody,
  clipPackBody,
  speakerLayoutBody,
  tightenBody,
  trailerBody,
  withUseCaseBody,
  type ClipPackInput,
  type EpisodeChaptersInput,
  type EpisodeTrailerInput,
  type SpeakerLayoutInput,
  type TightenEpisodeInput,
} from "./edit-use-case-inputs.js"

export { CLIP_PACK_MAX_TARGET_SEC, CLIP_PACK_MIN_TARGET_SEC, TRAILER_FORMATS } from "./edit-use-case-inputs.js"
export type { ClipPackEmphasis, ClipPackInput, EpisodeChaptersInput, EpisodeTrailerInput, SpeakerLayoutInput, TightenEpisodeInput, TrailerFormat, UseCaseRecordingsInput } from "./edit-use-case-inputs.js"

// Re-export the canonical EDL / transcript vocabulary from `@nodaro/shared`
// (single source of truth — the shapes live at `packages/shared/src/edl.ts`).
// `@nodaro/shared` is already a hard dep of this package, so there is no
// bundle-size cost to importing from it, and an integration builds requests and
// reads results with one dependency. `EdlClipSet` / `ChapterSet` are the raw
// `output_data` shapes of the `clips` / `chapters` modes, and
// `unwrapEditPlanOutput` is the sanctioned way to normalize any edit-plan job's
// `output_data` (it also strips the relay's `viaNodaroCloud` marker).
export type { Edl, Transcript, EditPlanMode, EditPlanTier, EdlClipSet, ChapterSet }
export { unwrapEditPlanOutput }

/**
 * A silence-detect job's `output_data.json` — the value to pass as
 * {@link EditPlanInput.silence}. It is NOT what {@link EditResource.silenceDetect}
 * returns (that is `{ jobId }`); fetch the finished job and read its
 * `output_data.json`. The planner reads the `ranges` array — an input without
 * one is silently ignored, so pass this whole object.
 */
export interface SilenceRanges {
  /** Wire version of the payload. */
  version?: number
  /** Silence spans on the source clock, in ms. */
  ranges: ReadonlyArray<{ startMs: number; endMs: number }>
  /** Total source duration, in ms. */
  durationMs?: number
}

/** Every editorial route answers with the queued job to poll. */
export interface EditJobResult {
  /** The queued job id — follow it via `client.jobs.getStatus(jobId)`. */
  jobId: string
}

export interface SilenceDetectInput {
  /**
   * An audio OR video source. A single ffmpeg `silencedetect` pass runs over the
   * source's audio proxy either way — no provider key required.
   */
  audioUrl: string
  /** dBFS threshold, always ≤ 0. Default -35 (a good podcast default). */
  thresholdDb?: number
  /** Minimum silence length to report, in ms. Default 700. */
  minSilenceMs?: number
  /** Padding kept around speech, in ms — shrinks each reported range inward. Default 120. */
  padMs?: number
  /**
   * Optionally associate this run with a workflow execution (display only — it
   * ties the standalone job back to a workflow for the execution history).
   */
  workflowId?: string
}

/** One recording for {@link EditResource.audioSync}. */
export interface AudioSyncSource {
  /**
   * Your id for this recording (1–200 chars, unique within the request) —
   * echoed back as its offset's `sourceId`. Use the id your EDL gives the same
   * recording (`EdlSource.id`) and the result folds straight into it.
   */
  id: string
  /** An audio OR video URL — the audio track is read either way. */
  url: string
}

export interface AudioSyncInput {
  /** The 2–6 recordings of one conversation to line up (camera files and/or a master mic). */
  sources: AudioSyncSource[]
  /**
   * The id of the source every offset is measured against (its own offset is
   * 0). Must be one of `sources`' ids; default: the first source.
   */
  reference?: string
  /** Optionally associate this run with a workflow execution (display only). */
  workflowId?: string
}

/** One recording's measured clock offset in an {@link AudioSyncResult}. */
export interface AudioSyncOffset {
  /** The recording's `id` from the request. */
  sourceId: string
  /**
   * Where this recording sits on the reference's clock, in integer ms:
   * `referenceMs = sourceMs + offsetMs` (the EDL's D19 sign — the value
   * `EdlSource.offsetMs` takes when the reference is the master).
   */
  offsetMs: number
  /** 0–1. Below 0.5 a `notes` line asks for a check by ear. */
  confidence: number
  /**
   * Measured clock drift against the reference, in ms gained per hour; `null`
   * when the shared stretch was too short to measure it. Drift is reported,
   * never corrected — the offset is taken at the middle of the overlap.
   */
  driftMsPerHour: number | null
}

/**
 * An audio-sync job's `output_data.json`. It is NOT what
 * {@link EditResource.audioSync} returns (that is `{ jobId }`); fetch the
 * finished job and read its `output_data.json`.
 */
export interface AudioSyncResult {
  /** Wire version of the payload. */
  version: number
  /** The source every offset is measured against (its own offset is 0). */
  reference: string
  offsets: AudioSyncOffset[]
  /** Human-readable warnings: low confidence, measured drift, no shared sound. */
  notes: string[]
}

export interface ApplyEdlInput {
  /** The edit decision list to render. Media resolves from each `edl.sources[i].url`. */
  edl: Edl
  /**
   * Optional media-URL overrides for `edl.sources[i].url`, POSITIONAL in this
   * array's order. Each URL is SSRF-guarded server-side like any media the
   * platform fetches.
   */
  sources?: string[]
  /**
   * Optional transcript to remap through the cut. The rendered job returns the
   * remapped transcript on its `json` output. A word-level multi-hour transcript
   * is several MB — if you only need the re-timed transcript (not a render), use
   * {@link EditResource.remapTranscript} locally instead of sending it here.
   */
  transcript?: Transcript
  /** Render a full video (default) or an audio-only cut. */
  output?: "video" | "audio"
  /** Fast proxy draft or the final render. Default "final". */
  quality?: "proxy" | "final"
  /**
   * Default crossfade (ms) on boundaries with no explicit transition; 0 = hard
   * cuts. Per-boundary clamped to the ffmpeg-xfade limit server-side. Default 0.
   */
  crossfadeMs?: number
  /**
   * The plan clip this render cuts — `edlSpanKey(clip)` from `@nodaro/shared`
   * (`"<first inMs>-<last outMs>"`). The job's result carries it back as
   * `output_data.clipKey`, so renders of a clip set can be matched to their
   * clips. Omit for a render of no plan clip.
   */
  clipKey?: string
  /**
   * The plan value this render cuts — `renderReadBasis(value)` from
   * `@nodaro/shared` (16 lowercase hex digits), where `value` is the Edit
   * Plan's Tighten EDL with any review applied, or the clip this render cuts.
   * The job's result carries it back as `output_data.planBasis`, so a take can
   * be told apart from one cut from an earlier plan. Send it only when the EDL
   * you send IS that value (not one an intermediate step re-cut from an older
   * plan); omit it otherwise. The result's `output_data.renderBasis` (the
   * render's own settings and sources) is stamped by the server.
   */
  planBasis?: string
  /** Optionally associate this run with a workflow execution (display only). */
  workflowId?: string
}

/**
 * One media source for an edit-plan run. Mirrors the shape the workflow engine
 * sends: a stable `id` (adopted verbatim as the plan's `EdlSource` id), the
 * media `url`, and the `kind`, plus optional per-source annotations the planner
 * honors.
 */
export interface EditPlanSource {
  /** Stable id for this source — becomes the `EdlSource` id in the returned plan. */
  id: string
  /** The source's media URL (SSRF-guarded server-side). */
  url: string
  /** This source's medium. */
  kind: "video" | "audio"
  /** Role annotation. `"master-audio"` marks the clock the plan is reserved on. */
  role?: "master-audio" | "camera" | "wide" | "screen"
  /** Speaker labels present in this source. */
  speakers?: string[]
  /**
   * This source's origin on the master clock (masterMs = sourceMs + offsetMs).
   * Set by hand, it wins over a measured offset from `offsets`.
   */
  offsetMs?: number
}

export interface EditPlanInput {
  /**
   * Planning mode. The finished job's `output_data` carries the plan — read it
   * with {@link unwrapEditPlanOutput}, which also strips the relay's
   * `viaNodaroCloud` marker:
   *   - `"tighten"`  → an `Edl`.
   *   - `"clips"`    → an {@link EdlClipSet} (`{ version, clips: Edl[] }`);
   *                    `unwrapEditPlanOutput` returns the bare `Edl[]`.
   *   - `"chapters"` → a {@link ChapterSet} (`{ version, chapters: [...] }`).
   *   - `"trailer"`  → an `Edl` (one short teaser cut from the strongest moments).
   */
  mode: EditPlanMode
  /** Reasoning tier — affects plan quality AND the credit bucket. */
  planTier: EditPlanTier
  /** The timed transcript driving the plan. */
  transcript: Transcript
  /**
   * Optional detected silence ranges. Pass the silence-detect JOB'S RESULT —
   * `getStatus(jobId).data.output_data.json` (a {@link SilenceRanges} object),
   * NOT the `{ jobId }` that {@link EditResource.silenceDetect} returns. The
   * planner reads the `ranges` array; an input without one is silently ignored.
   */
  silence?: SilenceRanges
  /** The recording's media sources (1–6). */
  sources: EditPlanSource[]
  /**
   * Multicam: an {@link AudioSyncResult} (the audio-sync job's
   * `output_data.json`) measured over these same source ids. Each source's
   * measured offset is written onto its `offsetMs` BEFORE the request, on the
   * master's clock (the `master-audio` source, else the first) — a source's
   * own `offsetMs` wins. `editPlan` rejects with a {@link NodaroError}
   * (`code: "edit_plan_sources"`), before any request or charge, when a
   * source was not measured or matched weakly (confidence < 0.5 — set its
   * `offsetMs` by hand), or the master was not measured.
   */
  offsets?: AudioSyncResult | string
  /**
   * The id of the source the transcript was made from, when you know it. The
   * plan follows the master's clock, so a transcript made from a source that
   * is off it is rejected the same way.
   */
  transcriptSourceId?: string
  /** Free-text editing steer. */
  instructions?: string
  /** Style-guide text applied to the plan. */
  styleGuide?: string
  /** `"clips"` mode only: how many clips to cut. */
  count?: number
  /** `"clips"` mode only: target duration per clip, in seconds. */
  targetDurationSec?: number
  /** Target aspect for cut clips (`"clips"`) or the teaser (`"trailer"`). */
  targetAspect?: "16:9" | "9:16" | "1:1" | "4:5"
  /** Target platform hint (e.g. a social platform name). */
  platform?: string
  /** Optionally associate this run with a workflow execution (display only). */
  workflowId?: string
}

/** Input for {@link EditResource.cameraSwitch} (podcast B5). */
export interface CameraSwitchInput {
  /** One EDL — an `editPlan` result (`unwrapEditPlanOutput`), not a clip set. */
  edl: Edl
  /** The word transcript WITH speaker labels (transcribe with speaker detection). */
  transcript: Transcript
  /** Speaker label → the EDL source id of that speaker's camera. A speaker
   *  left out shows the source whose `speakers` list names them, else the
   *  `wide` camera, else any camera that filmed them. */
  speakerMap?: Record<string, string>
  /** A {@link EditResource.speakerMap} job's `output_data.json`: a label in `speakerMap`
   *  wins, then this result, then the n-th speaker heard gets the n-th camera. */
  speakerMapResult?: SpeakerMapResult | string
  /** Speaker label → display name (on the segments and the returned transcript). */
  speakerNames?: Record<string, string>
  /** The shortest shot in ms (default 2 500): a shorter turn holds the shot. */
  minShotMs?: number
  /** Cut this long before the new speaker starts, ms (default 200). */
  leadMs?: number
  /** With a `wide` source: break to it after this long on one camera, ms (default 20 000). */
  maxShotMs?: number
  /** With a `wide` source: every N-th cut goes to the wide (default 0 = off). */
  wideEvery?: number
  /** Overlapping speech → a layout hint (default false; Apply EDL renders cut-only edits). */
  layoutHints?: boolean
  /** Optionally associate this run with a workflow execution (display only). */
  workflowId?: string
}

/**
 * The podcast use-case node types, each one a route (`POST /v1/<type>`, and
 * `POST /v1/<type>/continue` to continue one of its runs).
 */
export { USE_CASE_NODE_TYPES, type UseCaseNodeType }

/** The route that continues a run of `type`. */
const continuePathOf = (type: UseCaseNodeType): `/v1/${UseCaseNodeType}/continue` => `/v1/${type}/continue`

/** What a use-case run (`tightenEpisode`, `episodeChapters`, `episodeTrailer`, `clipPack`, `speakerLayout`) and `continueUseCase` answer: the run's job to poll. */
export interface UseCaseJobResult extends EditJobResult {
  /** The run's execution (absent on a deduplicated retry). */
  executionId?: string
  /** `true` when an `Idempotency-Key` retry found the run already started: `jobId` is that run. */
  deduped?: boolean
}

/** What `tightenEpisode` answers (a {@link UseCaseJobResult}). */
export type TightenEpisodeJobResult = UseCaseJobResult

/**
 * What a use-case run is estimated at (`data`). Every credit amount is 0
 * on an edition without credits; `durationSec` is `null` when the recording's
 * length could not be read.
 */
export interface UseCaseEstimate {
  /** The whole run: its steps plus the fee. */
  totalCredits: number
  /** The steps at their own rates. */
  stepsCredits: number
  /** The per-run fee. */
  feeCredits: number
  /** A step is a metered LLM call's ESTIMATE (charged its actual usage), so the
   *  total is one: show it `≈N`. Absent for a fixed figure. */
  estimate?: true
  /** The recording's length, in seconds. */
  durationSec: number | null
}

/** What a Tighten Episode run is estimated at (a {@link UseCaseEstimate}). */
export type TightenEpisodeEstimate = UseCaseEstimate

/** Input for {@link EditResource.continueUseCase}. */
export interface UseCaseContinueInput {
  /** The run to continue: the job `tightenEpisode`, `episodeChapters`, `episodeTrailer`, `clipPack` or `speakerLayout` (or an earlier continuation) answered. */
  jobId: string
  /**
   * `"from-failed"` re-runs what did not finish of a failed run;
   * `"render-final"` renders the full-quality result after a review-on preview
   * (a Chapters run has no preview: it is refused `render_final_not_preview`;
   * a Clip Pack edit that drops every clip is refused `use_case_nothing_kept`).
   */
  mode: "from-failed" | "render-final"
  /** Render final only: the reviewer's edit of the plan (an EDL). A Speaker Layout run has no plan: an edit is refused `400 use_case_no_plan`. */
  editedEdl?: unknown
  /**
   * The run's node type: its continuation goes to `POST /v1/<nodeType>/continue`.
   * Optional: when absent the job is read first (`GET /v1/jobs/:id`, which
   * needs the `jobs:read` scope on an app token) for the type the run records.
   * Required when that read cannot answer: a key without `jobs:read`, or a job
   * that records no use-case type (the call rejects with `use_case_type_unknown`).
   */
  nodeType?: UseCaseNodeType
}

/** Per-call options for the use-case requests (Tighten Episode, Chapters, Trailer, Clip Pack, Speaker Layout, and their continuations). */
export interface UseCaseRequestOptions {
  /**
   * Sent as the `Idempotency-Key` header. Reuse the same value when retrying
   * the same request and the server answers the run it already started
   * (`deduped: true`) instead of starting a second one.
   */
  idempotencyKey?: string
}

function idempotencyHeaders(options?: UseCaseRequestOptions): { headers?: Record<string, string> } {
  return options?.idempotencyKey ? { headers: { "Idempotency-Key": options.idempotencyKey } } : {}
}

/**
 * Editorial primitives for podcast / long-form video editing, single-camera
 * and multicam: measure the cameras' offsets ({@link audioSync}), plan the cut
 * ({@link editPlan}), put each cut on the speaker's camera
 * ({@link cameraSwitch}), render a Preview to review (`applyEdl` with
 * `quality: "proxy"`), then the final (`quality: "final"`).
 *
 * - {@link silenceDetect}, {@link audioSync} and {@link applyEdl} are core nodes
 *   available on every edition.
 * - {@link editPlan} and {@link cameraSwitch} run on nodaro.ai; a self-hosted
 *   install relays them once it is connected (a 503
 *   `code: "nodaro_connection_required"` otherwise).
 * - {@link tightenEpisode} runs the whole chain (transcribe, plan, render, and
 *   optionally captions, music and framing) in one call. It is core, but a
 *   self-hosted install needs a nodaro.ai connection for the steps that run
 *   there (a 503 `code: "nodaro_connection_required"` otherwise).
 *   {@link continueUseCase} continues one of its runs.
 * - {@link episodeChapters} lists a recording's chapters (transcribe, then the
 *   plan in chapters mode) in one call; nothing renders. Like
 *   {@link tightenEpisode}, a self-hosted install needs a nodaro.ai connection.
 * - {@link episodeTrailer} cuts a 20–40 s trailer of a recording and delivers
 *   it in each chosen format in one call; the same connection applies.
 * - {@link clipPack} cuts a recording into a pack of short clips (framed and
 *   captioned by default) in one call; the same connection applies.
 * - {@link speakerLayout} frames a whole recording by speaker (the same
 *   length, nothing cut) in one call; the same connection applies.
 * - {@link remapTranscript} is a PURE local transform (no request) — the same
 *   remap `applyEdl` performs on its `transcript`, exposed for callers that hold
 *   an EDL and a transcript and only want the re-timed transcript.
 *
 * Every request method except the estimates ({@link estimateTightenEpisode},
 * {@link estimateEpisodeChapters}, {@link estimateEpisodeTrailer},
 * {@link estimateClipPack}, {@link estimateSpeakerLayout}: a quote, `{ data }`) returns
 * {@link EditJobResult} (the use-case runs a {@link UseCaseJobResult}); poll the
 * `jobId` with `client.jobs.getStatus(jobId)`.
 */
export class EditResource {
  constructor(private client: NodaroClientCore) {}

  /**
   * Detect silence ranges in an audio/video source (`POST /v1/silence-detect`).
   * Keyless — one ffmpeg pass over the source's audio proxy.
   */
  silenceDetect(input: SilenceDetectInput): Promise<EditJobResult> {
    return this.client.request("POST", "/v1/silence-detect", {
      body: {
        audioUrl: input.audioUrl,
        ...(input.thresholdDb !== undefined ? { thresholdDb: input.thresholdDb } : {}),
        ...(input.minSilenceMs !== undefined ? { minSilenceMs: input.minSilenceMs } : {}),
        ...(input.padMs !== undefined ? { padMs: input.padMs } : {}),
        ...(input.workflowId !== undefined ? { workflowId: input.workflowId } : {}),
      },
    })
  }

  /**
   * Measure how far apart the clocks of 2–6 recordings of one conversation are
   * (`POST /v1/audio-sync`), by cross-correlating their audio — keyless, one
   * ffmpeg decode per source. The finished job's `output_data.json` is an
   * {@link AudioSyncResult}. A malformed request (fewer than 2 or more than 6
   * sources, a repeated id, a `reference` that is not one of the ids) throws a
   * typed `NodaroError` (400, `code: "validation_error"`) before any credits
   * are reserved.
   */
  audioSync(input: AudioSyncInput): Promise<EditJobResult> {
    return this.client.request("POST", "/v1/audio-sync", {
      body: {
        sources: input.sources.map((s) => ({ id: s.id, url: s.url })),
        ...(input.reference !== undefined ? { reference: input.reference } : {}),
        ...(input.workflowId !== undefined ? { workflowId: input.workflowId } : {}),
      },
    })
  }

  /**
   * Which camera each speaker is on, from the cameras' own microphones (`POST
   * /v1/speaker-map`), keyless. `output_data.json` is a `SpeakerMapResult`: pass
   * it to {@link cameraSwitch} as `speakerMapResult`. A malformed request throws
   * a `NodaroError` (400 `validation_error`; 422 `no_speakers` for a transcript
   * with no speaker labels) before any credits are reserved.
   */
  speakerMap(input: SpeakerMapInput): Promise<EditJobResult> {
    return this.client.request("POST", "/v1/speaker-map", {
      body: {
        sources: input.sources.map((s) => ({ id: s.id, url: s.url, ...(s.kind ? { kind: s.kind } : {}) })),
        transcript: input.transcript,
        ...(input.offsets !== undefined ? { offsets: input.offsets } : {}),
        ...(input.masterSourceId !== undefined ? { masterSourceId: input.masterSourceId } : {}),
        ...(input.wideSourceId !== undefined ? { wideSourceId: input.wideSourceId } : {}),
        ...(input.marginDb !== undefined ? { marginDb: input.marginDb } : {}),
        ...(input.workflowId !== undefined ? { workflowId: input.workflowId } : {}),
      },
    })
  }

  /**
   * Render an edit decision list into a video or audio cut (`POST /v1/apply-edl`).
   * The EDL is validated at ingress — an unresolvable source or a picture-less
   * segment on a video edit throws a typed `NodaroError` (400, `code:
   * "invalid_edl"`) before any credits are reserved.
   */
  applyEdl(input: ApplyEdlInput): Promise<EditJobResult> {
    return this.client.request("POST", "/v1/apply-edl", {
      body: {
        edl: input.edl,
        ...(input.sources !== undefined ? { sources: input.sources } : {}),
        ...(input.transcript !== undefined ? { transcript: input.transcript } : {}),
        ...(input.output !== undefined ? { output: input.output } : {}),
        ...(input.quality !== undefined ? { quality: input.quality } : {}),
        ...(input.crossfadeMs !== undefined ? { crossfadeMs: input.crossfadeMs } : {}),
        ...(input.clipKey !== undefined ? { clipKey: input.clipKey } : {}),
        ...(input.planBasis !== undefined ? { planBasis: input.planBasis } : {}),
        ...(input.workflowId !== undefined ? { workflowId: input.workflowId } : {}),
      },
    })
  }

  /**
   * Tighten Episode (`POST /v1/tighten-episode`): tighten a podcast recording
   * in one call — transcribe, cut the silences and filler, render, with
   * optional captions, music and framing. Answers the run's job to poll; its
   * `output_data` holds the episode. The run is priced as its steps at their own
   * rates plus the listed per-run fee. Quote it first with
   * {@link estimateTightenEpisode}.
   */
  tightenEpisode(input: TightenEpisodeInput, options?: UseCaseRequestOptions): Promise<TightenEpisodeJobResult> {
    return withUseCaseBody(() => tightenBody(input), (body) => this.client.request("POST", "/v1/tighten-episode", { body, ...idempotencyHeaders(options) }))
  }

  /**
   * What a Tighten Episode run is estimated at (`POST /v1/tighten-episode/estimate`):
   * its steps at their own rates plus its per-run fee. Nothing is created or
   * charged. The estimate leans high: the render is priced at the recording's
   * full length, while the charge follows the minutes actually rendered.
   */
  estimateTightenEpisode(input: TightenEpisodeInput): Promise<{ data: TightenEpisodeEstimate }> {
    return withUseCaseBody(() => tightenBody(input), (body) => this.client.request("POST", "/v1/tighten-episode/estimate", { body }))
  }

  /**
   * Chapters (`POST /v1/episode-chapters`): transcribe a recording and list its
   * chapters in one call. Answers the run's job to poll; the finished job's
   * `output_data.text` is the list as show notes (one `0:00 Title` line per
   * chapter; once a chapter starts at 1:00:00 or later, every line is
   * `H:MM:SS`), `output_data.json` the list itself (`{ startMs, title }[]`, the
   * same rows; the first starts at 0). A run that finds no chapters fails,
   * and its fee is refunded. Priced as its steps at their own rates plus the
   * listed per-run fee; quote it first with {@link estimateEpisodeChapters}.
   */
  episodeChapters(input: EpisodeChaptersInput, options?: UseCaseRequestOptions): Promise<UseCaseJobResult> {
    return withUseCaseBody(() => chaptersBody(input), (body) => this.client.request("POST", "/v1/episode-chapters", { body, ...idempotencyHeaders(options) }))
  }

  /**
   * What a Chapters run is estimated at (`POST /v1/episode-chapters/estimate`):
   * its steps at their own rates plus its per-run fee. Nothing is created or
   * charged. A recording whose length cannot be read is estimated at the
   * 180-minute ceiling.
   */
  estimateEpisodeChapters(input: EpisodeChaptersInput): Promise<{ data: UseCaseEstimate }> {
    return withUseCaseBody(() => chaptersBody(input), (body) => this.client.request("POST", "/v1/episode-chapters/estimate", { body }))
  }

  /**
   * Trailer (`POST /v1/episode-trailer`): cut a 20–40 s trailer of a recording
   * and deliver it in each chosen format (padded, never cropped), optionally
   * after an intro card, in one call. The finished job's `output_data.formats`
   * is `{ format, url }[]` in format order, the first also `output_data.videoUrl`;
   * a format that failed is named in `output_data.failedFormats` (the run keeps
   * the others). With `reviewBeforeRender` the run stops at a preview
   * (`videoUrl`, no formats yet). Priced as its steps at their own rates plus
   * the listed per-run fee; quote it first with {@link estimateEpisodeTrailer}.
   */
  episodeTrailer(input: EpisodeTrailerInput, options?: UseCaseRequestOptions): Promise<UseCaseJobResult> {
    return withUseCaseBody(() => trailerBody(input), (body) => this.client.request("POST", "/v1/episode-trailer", { body, ...idempotencyHeaders(options) }))
  }

  /**
   * What a Trailer run is estimated at (`POST /v1/episode-trailer/estimate`):
   * its steps at their own rates plus its per-run fee. Nothing is created or
   * charged. The trailer is quoted at 40 seconds, the longest trailer the
   * plan cuts; a Render final is quoted on the trailer the run cut (with the
   * review's edits), plus the intro card.
   */
  estimateEpisodeTrailer(input: EpisodeTrailerInput): Promise<{ data: UseCaseEstimate }> {
    return withUseCaseBody(() => trailerBody(input), (body) => this.client.request("POST", "/v1/episode-trailer/estimate", { body }))
  }

  /**
   * Clip Pack (`POST /v1/clip-pack`): cut a recording into a pack of short
   * clips in one call — the plan finds the best moments (`count`, default 8,
   * of about `targetDurationSec`, default 60), each is rendered (framed 9:16
   * with the speakers stacked by default; `framing: null` keeps the
   * recording's shape) and captioned. An audio recording makes audio clips.
   * The finished job's `output_data.clips` is `{ url, title?, hook?, clipKey,
   * thumbnailUrl?, captionsFailed? }[]` in plan order, the first also
   * `output_data.videoUrl` (`audioUrl` for audio clips). Every clip is tried:
   * one that cannot be rendered is skipped, not charged and counted on
   * `failedClips` (the pack keeps the others and its fee); a clip whose
   * captions failed comes uncaptioned (`captionsFailed`, counted on
   * `failedCaptions`). When no clip renders the run fails and its fee is
   * refunded. With `reviewBeforeRender` the run stops at previews; Render
   * final ({@link continueUseCase}) renders only the clips the edit keeps.
   * Priced as its steps at their own rates plus the listed per-run fee;
   * quote it first with {@link estimateClipPack}.
   */
  clipPack(input: ClipPackInput, options?: UseCaseRequestOptions): Promise<UseCaseJobResult> {
    return withUseCaseBody(() => clipPackBody(input), (body) => this.client.request("POST", "/v1/clip-pack", { body, ...idempotencyHeaders(options) }))
  }

  /**
   * What a Clip Pack run is estimated at (`POST /v1/clip-pack/estimate`): its
   * steps at their own rates plus its per-run fee. Nothing is created or
   * charged. Each clip is quoted at twice the target length (the plan may cut
   * a clip longer than asked); the charge follows each clip's real length.
   */
  estimateClipPack(input: ClipPackInput): Promise<{ data: UseCaseEstimate }> {
    return withUseCaseBody(() => clipPackBody(input), (body) => this.client.request("POST", "/v1/clip-pack/estimate", { body }))
  }

  /**
   * Speaker Layout (`POST /v1/speaker-layout`): frame a whole recording by
   * speaker in one call — the same length, nothing cut. One recording: each
   * speaker framed in turn; several recordings of one conversation: lined up,
   * each speaker shown on their own camera. The finished job's
   * `output_data.videoUrl` is the framed video, `output_data.json` the edit
   * Speaker View drew. With `reviewBeforeRender` the run stops at a preview;
   * {@link continueUseCase} (`mode: "render-final"`, no `editedEdl`) renders
   * it at full quality. Priced as its steps at their own rates plus the listed
   * per-run fee; quote it first with {@link estimateSpeakerLayout}.
   */
  speakerLayout(input: SpeakerLayoutInput, options?: UseCaseRequestOptions): Promise<UseCaseJobResult> {
    return withUseCaseBody(() => speakerLayoutBody(input), (body) => this.client.request("POST", "/v1/speaker-layout", { body, ...idempotencyHeaders(options) }))
  }

  /**
   * What a Speaker Layout run is estimated at (`POST /v1/speaker-layout/estimate`):
   * its steps at their own rates plus its per-run fee. Nothing is created or
   * charged. A recording whose length cannot be read is estimated at the
   * 180-minute ceiling.
   */
  estimateSpeakerLayout(input: SpeakerLayoutInput): Promise<{ data: UseCaseEstimate }> {
    return withUseCaseBody(() => speakerLayoutBody(input), (body) => this.client.request("POST", "/v1/speaker-layout/estimate", { body }))
  }

  /**
   * Continue a use-case run as a new job (`POST /v1/<type>/continue`, the
   * run's own type: `input.nodeType`, else the type the job records, read with
   * `GET /v1/jobs/:id`; when that read cannot tell, this rejects with a
   * `NodaroError` coded `use_case_type_unknown` — pass `nodeType` then):
   * `"from-failed"` keeps the steps that finished and runs the rest (the fee
   * is held again; the failed run's was refunded);
   * `"render-final"` renders the full-quality result after a review-on preview,
   * with the preview's settings and no fee. A refusal that names another job
   * (`already_running`, `continuation_superseded`,
   * `render_final_already_rendered`) throws a `ContinuationRefusedError`
   * carrying that `jobId`.
   */
  async continueUseCase(input: UseCaseContinueInput, options?: UseCaseRequestOptions): Promise<UseCaseJobResult> {
    if (input.nodeType !== undefined && !isUseCaseNodeType(input.nodeType)) {
      throw new NodaroError(
        `continueUseCase: nodeType "${String(input.nodeType)}" is not a use-case node type (${USE_CASE_NODE_TYPES.join(", ")})`,
        "invalid_node_type",
        400,
      )
    }
    const type = input.nodeType ?? (await this.runTypeOf(input.jobId))
    return this.client.request("POST", continuePathOf(type), {
      body: { jobId: input.jobId, mode: input.mode, ...(input.editedEdl !== undefined ? { editedEdl: input.editedEdl } : {}) },
      ...idempotencyHeaders(options),
    })
  }

  /**
   * The use-case type a run records (`input_data.type`, else its `job_type`).
   * When the key lacks the `jobs:read` scope (403 naming that scope) or the job
   * names no use-case type, the type cannot be read: this rejects with a
   * `NodaroError` (`use_case_type_unknown`, 400) asking for `nodeType`, and
   * nothing is posted (decided 2026-10-18: no route is guessed for the run).
   * Any other failure of the read, any other 403 included, is thrown as is.
   */
  private async runTypeOf(jobId: string): Promise<UseCaseNodeType> {
    const unknown = () =>
      new NodaroError("continueUseCase: the run's node type cannot be read — pass nodeType", "use_case_type_unknown", 400)
    let row: { job_type?: unknown; input_data?: unknown } | undefined
    try {
      row = (await this.client.request<{ data?: { job_type?: unknown; input_data?: unknown } }>("GET", `/v1/jobs/${encodeURIComponent(jobId)}`)).data
    } catch (err) {
      if (err instanceof ForbiddenError && err.missingScope === "jobs:read") throw unknown()
      throw err
    }
    const input = row?.input_data
    const recorded = input && typeof input === "object" && !Array.isArray(input) ? (input as { type?: unknown }).type : undefined
    const type = typeof recorded === "string" && recorded.length > 0 ? recorded : row?.job_type
    if (!isUseCaseNodeType(type)) throw unknown()
    return type
  }

  /**
   * Plan a transcript-driven cut (`POST /v1/edit-plan`). Reads a timed
   * transcript (plus optional silence ranges) and the media sources, and plans
   * the edit. The finished job's `output_data` holds the plan: an `Edl`
   * (`"tighten"` or `"trailer"`), an {@link EdlClipSet} (`"clips"`), or a
   * {@link ChapterSet} (`"chapters"`) — normalize it with {@link unwrapEditPlanOutput}.
   *
   * On a self-hosted install the request relays to nodaro.ai and needs the
   * install connected (a 503 `code: "nodaro_connection_required"` otherwise);
   * on nodaro.ai it runs directly.
   */
  editPlan(input: EditPlanInput): Promise<EditJobResult> {
    // The same pre-dispatch check the canvas and MCP run (B4): the server never
    // sees `offsets` — they are written onto the sources here.
    const planned = resolveEditPlanSources(input.sources, {
      offsets: input.offsets,
      transcriptSourceId: input.transcriptSourceId,
    })
    if (!planned.ok) {
      const message = planned.issues.map((issue) => describeAudioSyncOffsetIssue(issue)).join("; ")
      return Promise.reject(new NodaroError(`editPlan: ${message}`, "edit_plan_sources", 400))
    }
    const transcript = planned.transcriptSourceId
      ? { ...input.transcript, sourceId: planned.transcriptSourceId }
      : input.transcript
    return this.client.request("POST", "/v1/edit-plan", {
      body: {
        mode: input.mode,
        planTier: input.planTier,
        transcript,
        sources: planned.sources,
        ...(input.silence !== undefined ? { silence: input.silence } : {}),
        ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
        ...(input.styleGuide !== undefined ? { styleGuide: input.styleGuide } : {}),
        ...(input.count !== undefined ? { count: input.count } : {}),
        ...(input.targetDurationSec !== undefined ? { targetDurationSec: input.targetDurationSec } : {}),
        ...(input.targetAspect !== undefined ? { targetAspect: input.targetAspect } : {}),
        ...(input.platform !== undefined ? { platform: input.platform } : {}),
        ...(input.workflowId !== undefined ? { workflowId: input.workflowId } : {}),
      },
    })
  }

  /**
   * Camera Switch (podcast B5): choose which camera shows each cut of `edl`
   * by who is speaking — the sound never changes. Cloud edition; a flat
   * price. The finished job's `output_data.json` is the switched EDL (feed it
   * to {@link applyEdl}) and `output_data.transcript` the transcript with
   * `speakerNames` applied. A transcript with no speaker labels rejects with
   * a {@link NodaroError} (`code: "no_speakers"`) before any request or charge.
   */
  cameraSwitch(input: CameraSwitchInput): Promise<EditJobResult> {
    if (transcriptSpeakerLabels(input.transcript).length === 0) {
      return Promise.reject(new NodaroError(
        "cameraSwitch: the transcript has no speaker labels — transcribe with speaker detection on",
        "no_speakers",
        422,
      ))
    }
    const result = input.speakerMapResult
    if (result !== undefined && !speakerMapResultOf(result)) return Promise.reject(new NodaroError("cameraSwitch: speakerMapResult is not a Speaker Map result — pass that job's output_data.json", "not_a_speaker_map", 400))
    const speakerMap = result !== undefined ? cameraSwitchSpeakerMap({ speakerMap: input.speakerMap }, input.edl, input.transcript, { speakerMap: result }) : input.speakerMap
    return this.client.request("POST", "/v1/camera-switch", {
      body: {
        edl: input.edl,
        transcript: input.transcript,
        ...(speakerMap !== undefined ? { speakerMap } : {}),
        ...(input.speakerNames !== undefined ? { speakerNames: input.speakerNames } : {}),
        ...(input.minShotMs !== undefined ? { minShotMs: input.minShotMs } : {}),
        ...(input.leadMs !== undefined ? { leadMs: input.leadMs } : {}),
        ...(input.maxShotMs !== undefined ? { maxShotMs: input.maxShotMs } : {}),
        ...(input.wideEvery !== undefined ? { wideEvery: input.wideEvery } : {}),
        ...(input.layoutHints !== undefined ? { layoutHints: input.layoutHints } : {}),
        ...(input.workflowId !== undefined ? { workflowId: input.workflowId } : {}),
      },
    })
  }

  /**
   * Remap a transcript through an EDL — a PURE client-side transform (NO
   * request). Returns a new transcript whose word (and segment) timings are on
   * the EDL's rendered output clock, dropping words that fall in cut regions and
   * clipping straddlers. Runs `@nodaro/shared`'s canonical
   * `remapTranscriptThroughEdl`, the same remap `applyEdl` performs server-side.
   */
  remapTranscript(edl: Edl, transcript: Transcript): Transcript {
    return remapTranscriptThroughEdl(edl, transcript)
  }
}
