/**
 * What the podcast use-case runs on the `edit` resource answer (the run's job
 * to poll, an estimate) and the options and continuation input they take.
 * Split from `edit.ts`, which holds the methods; every name here is
 * re-exported from there.
 */
import type { UseCaseNodeType } from "@nodaro/shared/nodes"
import type { EditJobResult } from "./edit.js"

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

/** Input for `EditResource.continueUseCase`. */
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
