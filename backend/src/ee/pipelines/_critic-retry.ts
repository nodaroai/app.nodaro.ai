/**
 * Shared retry-loop primitives for the Phase 1D image/video critic gates.
 *
 * Both `runImageCriticLoop` (Stages 2 + 4) and `runVideoCriticLoopForShot`
 * (Stage 7) used to inline a near-identical
 *   `while (isFail(verdict) && retryCount < CAP) { ...regen... }`
 * loop plus an inline prompt-amendment construction. The iteration core +
 * feedback-prompt builder ARE generic; only the cap value, fail predicate,
 * and attempt body differ across callers. This module extracts the shared
 * parts so each caller is reduced to:
 *   1. Run the first critic call up front.
 *   2. Call `runCriticRetryLoop` with a closure that handles regen + re-critic.
 *   3. Branch on `result.failed` for persistence / SSE.
 */

export interface CriticRetryLoopArgs<TVerdict> {
  /** Initial verdict (caller has already run the critic once before invoking the loop). */
  initial: TVerdict
  /** Maximum retry attempts after the initial verdict. Image=2, video=1. */
  maxRetries: number
  /**
   * Whether the verdict is a blocking failure. Differs across critics
   * (image: verdict='fail' OR adherence<MIN; video: also continuity<MIN
   * when non-null). Called for both the initial verdict + each attempt's
   * result.
   */
  isBlockingFail: (verdict: TVerdict) => boolean
  /**
   * Run one retry attempt. Receives the previous-attempt verdict (so the
   * caller can build feedback from it) and the new attempt number
   * (1-indexed). Returns the new verdict. The caller's closure handles
   * regeneration + re-critic + any side-effect bookkeeping (closure-captured
   * asset refs, etc.).
   */
  runAttempt: (prevVerdict: TVerdict, attemptNumber: number) => Promise<TVerdict>
}

export interface CriticRetryLoopResult<TVerdict> {
  /** Final verdict after all retries exhausted OR first-pass success. */
  finalVerdict: TVerdict
  /**
   * Number of retry attempts run during THIS call. 0 means the initial
   * verdict passed; `maxRetries` means the cap was exhausted without
   * resolution. Callers that carry retry counts forward across regen
   * cycles (image loop's `initialRetryCount`) add this delta to their
   * carry-forward — this helper does NOT see that carry-forward value.
   */
  retryCount: number
  /** Whether the final verdict is still a blocking failure (cap exhausted without resolution). */
  failed: boolean
}

export async function runCriticRetryLoop<TVerdict>(
  args: CriticRetryLoopArgs<TVerdict>,
): Promise<CriticRetryLoopResult<TVerdict>> {
  let verdict = args.initial
  let retryCount = 0
  while (args.isBlockingFail(verdict) && retryCount < args.maxRetries) {
    retryCount += 1
    verdict = await args.runAttempt(verdict, retryCount)
  }
  return {
    finalVerdict: verdict,
    retryCount,
    failed: args.isBlockingFail(verdict),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Feedback-prompt construction
// ────────────────────────────────────────────────────────────────────────────

export interface CriticFeedbackArgs {
  /** Original prompt to amend with feedback. */
  basePrompt: string
  /**
   * What the prior attempt was identified as by the critic. Image critics use
   * `identified_subject`; video uses `identified_action`. Surfaced verbatim
   * in the amendment so the LLM sees what the previous attempt produced.
   */
  identifiedAs: string
  /**
   * Blocking issues from the prior verdict — each contributes a
   * `- {category}: {suggested_fix}` line. Warnings are intentionally NOT
   * included here (only blocking issues trigger regen-with-feedback in the
   * first place). Callers pre-filter `verdict.issues` by `severity='blocking'`.
   */
  blockingIssues: ReadonlyArray<{ category: string; suggested_fix: string }>
  /**
   * Fallback advice when no blocking issues are present (e.g., the verdict
   * is failing purely on an adherence-score threshold with all issues marked
   * `warning`). Both callers pick something prompt-domain-specific:
   *   - image: "Improve overall adherence to the visual_description."
   *   - video: "Improve overall adherence to the shot prompt."
   */
  fallbackAdvice: string
}

export function buildCriticFeedbackPrompt(args: CriticFeedbackArgs): string {
  const issuesText =
    args.blockingIssues.length > 0
      ? args.blockingIssues.map((i) => `- ${i.category}: ${i.suggested_fix}`).join("\n")
      : args.fallbackAdvice
  return (
    `${args.basePrompt}\n\nPRIOR ATTEMPT IDENTIFIED AS: ${args.identifiedAs}` +
    `\nADJUSTMENTS NEEDED:\n${issuesText}`
  )
}
