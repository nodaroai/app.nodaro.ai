/**
 * `@nodaro/sdk/jobs` — the `jobs` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { JobsResource } from "../resources/jobs.js"

export type {
  Job,
  JobStatus,
  JobSource,
  JobStatusResult,
  CancelJobResult,
  DeleteJobResult,
  JobSessionRef,
  JobFromUploadParams,
  ListJobsParams,
  ListJobsPage,
  // `error_hint`'s discriminated union and its arms, plus the credit
  // lifecycle — all reachable from `Job`/`JobStatusResult` but, until now, not
  // nameable, so a consumer could not narrow or annotate against them.
  JobErrorHint,
  SafetyBlockHint,
  PolicyBlockHint,
  CreditsHint,
  InputRefusedHint,
  CreditStatus,
  JobRating,
  JobRatingFilter,
  RateJobResult,
} from "../resources/jobs.js"
