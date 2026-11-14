import type { DubbingErrorCode } from "@nodaro/shared/media"

/**
 * Every refusal the dubbing reads and the add-language call answer. One row
 * per refusal: its HTTP status, its `error.code` and its words live together,
 * so the routes, the SDK and the MCP tools never tell the same refusal two ways.
 *
 * The codes are the public list (`DUBBING_ERROR_CODES` in `@nodaro/shared`)
 * plus the platform's own `not_found`. A job that is someone else's, a hidden
 * step, in the Trash, restricted, of a dub with a restricted job or not a job
 * id at all is `notFound`, in the same words a missing job is told in, so a
 * caller cannot tell them apart.
 */
export interface DubbingProblem {
  readonly status: number
  readonly code: DubbingErrorCode | "not_found"
  readonly message: string
}

export const DUBBING_PROBLEMS = {
  notFound: { status: 404, code: "not_found", message: "Job not found" },
  notADub: { status: 422, code: "not_a_dubbing_job", message: "This job is not a dub." },
  notReady: { status: 409, code: "dubbing_not_ready", message: "This dub is still being made. Try again when it is done." },
  failed: { status: 422, code: "dubbing_failed", message: "This dub failed, so there is nothing to read." },
  unavailable: { status: 410, code: "dubbing_unavailable", message: "This dub is no longer held by the dubbing service." },
  languageNotFound: { status: 404, code: "dubbing_language_not_found", message: "This dub has no such language." },
  languageProcessing: {
    status: 409,
    code: "dubbing_language_processing",
    message: "This language is still being made. Try again when it is done.",
  },
  captionsUnavailable: { status: 422, code: "dubbing_captions_unavailable", message: "Captions cannot be read for this language." },
  languageExists: { status: 409, code: "dubbing_language_exists", message: "This dub already has this language." },
  unreadableSource: {
    status: 422,
    code: "unreadable_dubbing_source",
    message: "The original media of this dub can no longer be read, so a language cannot be added to it.",
  },
  tooLong: {
    status: 413,
    code: "media_duration_exceeds_limit",
    message: "This dub is longer than 30 minutes, so a language cannot be added to it.",
  },
  readFailed: { status: 502, code: "dubbing_read_failed", message: "The dubbing service did not answer. Try again." },
} as const satisfies Record<string, DubbingProblem>

/** What a dubbing read or change came to: its value, or the refusal to answer with. */
export type DubbingOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly problem: DubbingProblem
      /** What went wrong underneath, for the server log only. Never sent to the caller. */
      readonly cause?: unknown
    }

export const dubbingAnswer = <T>(value: T): DubbingOutcome<T> => ({ ok: true, value })

export const dubbingRefusal = (problem: DubbingProblem, cause?: unknown): DubbingOutcome<never> =>
  cause === undefined ? { ok: false, problem } : { ok: false, problem, cause }

/** The response body of a refusal. */
export function dubbingProblemBody(problem: DubbingProblem): { error: { code: string; message: string } } {
  return { error: { code: problem.code, message: problem.message } }
}
