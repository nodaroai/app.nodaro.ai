/**
 * Seedance 2.5 EDIT MODE — the one Seedance constraint we cannot settle before
 * the call, so we settle it after.
 *
 * With a reference video wired, Seedance decides SERVER-SIDE, from the PROMPT,
 * whether the run is an ordinary generation or an EDIT of that clip. The same
 * node with the same video flips between the two on a reworded sentence. In edit
 * mode the output inherits the source clip's shape, so the two levers the editor
 * legitimately offers become forbidden and KIE rejects the task:
 *
 *   "The parameters `ratio` and `duration` specified in the request are not
 *    valid. Seedance identified your task as video editing based on your prompt.
 *    For this task type, the output ratio and duration follow the input video
 *    selected by the model for editing ... Issues: [0] `ratio` must be
 *    `adaptive`. [1] `duration` must be -1."
 *
 * Nothing in the payload predicts that verdict — a reference video is also the
 * ordinary style-reference input, where a concrete ratio and duration stay legal
 * — so coercing on "a video is attached" would silently discard the user's
 * chosen shape on every style run. Instead we believe the provider: recognise
 * this exact rejection and re-submit ONCE with the two values it asked for.
 * Lossless in edit mode (the source clip defines both) and never reached on a
 * style run, which is not rejected in the first place.
 */
const SEEDANCE_2_EDIT_MODE_SIGNALS = [
  /identified your task as video editing/i,
  /`?ratio`?\s+must be\s+`?adaptive`?/i,
  /`?duration`?\s+must be\s+-1\b/i,
] as const

/**
 * True for KIE's Seedance edit-mode rejection, whether it arrives synchronously
 * from createTask or later as a failed task's failMsg — both shapes reach the
 * caller as an Error message.
 */
export function isSeedance2EditModeRejection(message: string): boolean {
  return SEEDANCE_2_EDIT_MODE_SIGNALS.some((re) => re.test(message))
}

/**
 * Everything an error says, for matching the PROVIDER's words. `runKieTask`
 * throws `createSanitizedError`'s KieError: `.message` is the user-safe text and
 * KIE's own failMsg lives in `.internalDetails` — so a detector reading only
 * `.message` never sees the provider (job 83e90e87, 2026-09-18: the edit-mode
 * retry was deployed and never fired). Duck-typed like the cross-repo
 * `contentPolicy` contract, so it holds across module copies and mocks.
 */
export function providerErrorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const details = (err as { internalDetails?: unknown }).internalDetails
  return typeof details === "string" && details ? `${err.message}\n${details}` : err.message
}

/**
 * The shape Seedance edit mode demands: the clip's own ratio, and its own length
 * (KIE spells "inherit the source" as -1: emitted by the worker's retry and the recovery lane's, nowhere else).
 */
export const SEEDANCE_2_EDIT_MODE_PARAMS = { aspect_ratio: "adaptive", duration: -1 } as const

/** Already in edit shape → a retry would re-send a byte-identical body. */
export function isSeedance2EditModeInput(input: Record<string, unknown>): boolean {
  return (
    input.aspect_ratio === SEEDANCE_2_EDIT_MODE_PARAMS.aspect_ratio &&
    Number(input.duration) === SEEDANCE_2_EDIT_MODE_PARAMS.duration
  )
}

/** Asking for a length of -1 in words the signals above don't hold, so nothing re-sends on them. */
const SEEDANCE_2_UNSIGNALLED_LENGTH_DEMAND = /\bparameter must be -1\b|\bduration to -1\b/i

/**
 * Whether a refusal naming the input video's length leaves the clip as the thing
 * to change, on a job with this input. Beside a demand for -1 it may not: a request
 * with a length of its own is refused for that, and another clip fails the same way
 * (jobs 6a75d7d3 and c007fd87 sent `duration: 4`). Words the signals hold stand only
 * after the re-send, so that request had the shape whatever the job asked.
 */
export function refusalLeavesOnlyTheClip(message: string, jobInput: unknown): boolean {
  if (!SEEDANCE_2_UNSIGNALLED_LENGTH_DEMAND.test(message)) return true
  return Number((jobInput as { duration?: unknown } | null | undefined)?.duration) === SEEDANCE_2_EDIT_MODE_PARAMS.duration
}
