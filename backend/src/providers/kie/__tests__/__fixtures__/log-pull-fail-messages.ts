/**
 * Verbatim provider `failMsg` strings recovered by the 2026-09-02 Railway log
 * pull (spec 2026-09-01-app-reports-triage-design.md §11.3). Kept in one
 * fixture so the transient-500 pin (log-pull-classification.test.ts) and the
 * classifier follow-up (client-content-policy.test.ts) assert over the SAME
 * text — a widened safety regex must not start matching the 500 group, and
 * that can only be checked when both tests read one list.
 *
 * DO NOT paraphrase these. They are the provider's own words, and the whole
 * point of the fixture is that the regexes are tested against reality.
 */

/** 12 G1 rows, disposed `dismissed` (§11.1): plain upstream 500s. Retrying is
 *  the correct action — these must classify as NOT a content block and stay
 *  `retryable`. */
export const TRANSIENT_UPSTREAM_500_MESSAGES: readonly string[] = [
  "Internal Error",
  "internal error, please try again later",
  "the server is busy",
]

/** 10 G1 rows, disposed `reviewed` (§11.1): moderation text that matched
 *  NEITHER the classifier regexes NOR the sanitizer's keyword list, so every
 *  one landed on the generic "Generation failed. Please try again" fallback.
 *  `rows` is the count from the log pull. */
export const UNCLASSIFIED_MODERATION_MESSAGES: readonly { readonly failMsg: string; readonly rows: number }[] = [
  { failMsg: "Content was flagged by the safety system. Try different prompts or inputs.", rows: 4 },
  { failMsg: "The input or output was flagged as sensitive. Please try again with different inputs.", rows: 5 },
  { failMsg: "Your input was rejected. Please try again or with a different input.", rows: 1 },
]

/** Parameter rejects from the same pull (§11.3, routed to PR 5). Present here
 *  ONLY as the negative control: widening the safety vocabulary must never
 *  reclassify a fixable parameter error as a permanent content block. */
export const PARAMETER_REJECT_MESSAGES: readonly string[] = [
  "resolution is not within the range of allowed options",
  "The parameters `ratio` and `duration` specified in the request are not valid. Seedance identified your task as video editing.",
  "Each reference video must be between 2 and 30 seconds",
  "content[1].video_url: invalid param: video duration 52838 ms, expected [2000, 15000] ms",
  "continueAt cannot be empty or less than 1",
]
