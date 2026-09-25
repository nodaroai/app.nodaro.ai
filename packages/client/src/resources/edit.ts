import type { NodaroClient } from "../client.js"
import { remapTranscriptThroughEdl, unwrapEditPlanOutput } from "@nodaro/shared"
import type { Edl, Transcript, EditPlanMode, EditPlanTier, EdlClipSet, ChapterSet } from "@nodaro/shared"

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
  /** This source's origin on the master clock (masterMs = sourceMs + offsetMs). */
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
  /** Free-text editing steer. */
  instructions?: string
  /** Style-guide text applied to the plan. */
  styleGuide?: string
  /** `"clips"` mode only: how many clips to cut. */
  count?: number
  /** `"clips"` mode only: target duration per clip, in seconds. */
  targetDurationSec?: number
  /** Target aspect for cut clips. */
  targetAspect?: "16:9" | "9:16" | "1:1" | "4:5"
  /** Target platform hint (e.g. a social platform name). */
  platform?: string
  /** Optionally associate this run with a workflow execution (display only). */
  workflowId?: string
}

/**
 * Phase-1 editorial primitives for podcast / long-form video editing.
 *
 * - {@link silenceDetect}, {@link audioSync} and {@link applyEdl} are core nodes
 *   available on every edition.
 * - {@link editPlan} is a Cloud-edition transcript-driven planner.
 * - {@link remapTranscript} is a PURE local transform (no request) — the same
 *   remap `applyEdl` performs on its `transcript`, exposed for callers that hold
 *   an EDL and a transcript and only want the re-timed transcript.
 *
 * Every request method returns {@link EditJobResult}; poll the `jobId` with
 * `client.jobs.getStatus(jobId)`.
 */
export class EditResource {
  constructor(private client: NodaroClient) {}

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
        ...(input.workflowId !== undefined ? { workflowId: input.workflowId } : {}),
      },
    })
  }

  /**
   * Plan a transcript-driven cut (`POST /v1/edit-plan`). Reads a timed
   * transcript (plus optional silence ranges) and the media sources, and plans
   * the edit. The finished job's `output_data` holds the plan: an `Edl`
   * (`"tighten"`), an {@link EdlClipSet} (`"clips"`), or a {@link ChapterSet}
   * (`"chapters"`) — normalize it with {@link unwrapEditPlanOutput}.
   *
   * On a self-hosted install the request relays to nodaro.ai and needs the
   * install connected (a 503 `code: "nodaro_connection_required"` otherwise);
   * on nodaro.ai it runs directly.
   */
  editPlan(input: EditPlanInput): Promise<EditJobResult> {
    return this.client.request("POST", "/v1/edit-plan", {
      body: {
        mode: input.mode,
        planTier: input.planTier,
        transcript: input.transcript,
        sources: input.sources,
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
