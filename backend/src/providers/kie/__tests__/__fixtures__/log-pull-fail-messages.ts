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
  // Prod 2026-10-06, jobs 01deaa71 and a5c8658d (gemini-omni-flash video-edit
  // with uploaded audio), from Railway: `task failed: [400] <this>`. Neither
  // regex knew "Google safety review", so the 400 fell to the generic
  // "rejected these settings" branch.
  { failMsg: "Request blocked: The uploaded audio was flagged by Google safety review.", rows: 2 },
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

/**
 * Lane-G triage, 2026-09-15: the 13 production `app_reports` rows whose
 * provider answer was a 4xx REQUEST reject and whose user-facing message was
 * nonetheless "Generation failed. Please try again or contact support". Stored
 * as the WIRE text (`internalMessage`), status included, because the status is
 * what the fix reads — the sentences share no keyword with one another, which
 * is the whole reason a keyword list could never have caught them.
 *
 * DO NOT paraphrase. Provider's own words, provider's own status.
 */
export const REQUEST_REJECT_4XX: readonly { readonly internalMessage: string; readonly status: number | string; readonly rows: number }[] = [
  {
    internalMessage:
      "task failed: [400] The parameters `ratio` and `duration` specified in the request are not valid. Seedance identified your task as video editing based on your prompt. For this task type, the output ratio and duration follow the input video selected by the model for editing, and the video selected must satisfy the duration requirement of 4 to 30 seconds. Issues: [0] `ratio` must be `adaptive`. [1] `duration` must be -1.",
    status: "400",
    rows: 4,
    // #1330 now RESUBMITS this one with `adaptive` / -1 before anyone sees it.
    // Kept here because the status branch is what catches the resubmit if it
    // fails too, and because it is the clearest example of a 4xx sentence that
    // shares no vocabulary with the four below it.
  },
  {
    internalMessage:
      'createTask error (code 422): {"code":422,"msg":"Each reference audio must be between 2 and 30 seconds","data":null}',
    status: 422,
    rows: 3,
  },
  {
    internalMessage:
      'createTask error (code 422): {"code":422,"msg":"reference_video_urls duration must be between 1 and 15 seconds","data":null}',
    status: 422,
    rows: 4,
  },
  {
    internalMessage:
      "task failed: [400] The parameter `content[1]` specified in the request is not valid: the parameter video pixel count specified in the request must be greater than or equal to 407696 for model dreamina-seedance-2-5 in r2v.",
    status: "400",
    rows: 1,
  },
  {
    internalMessage:
      'VEO generate error (code 422): {"code":422,"msg":"Reference to video only supports the Veo Fast model and Veo Lite model.","data":null}',
    status: 422,
    rows: 1,
  },
]

/** The 5xx counter-example from the SAME triage: KIE answers a genuinely
 *  transient internal error with a validation-shaped sentence, and the
 *  identical payload succeeded minutes later in production. The words say
 *  "your request is wrong", the status says "we had a bad minute" — this pair
 *  is why the fix reads the status and not the words. */
export const TRANSIENT_500_WITH_VALIDATION_WORDING: readonly { readonly internalMessage: string; readonly status: number }[] = [
  {
    internalMessage:
      'createTask error (code 500): {"code":500,"msg":"This field is required","data":null}',
    status: 500,
  },
]

/** Moderation wording the vocabulary missed until 2026-09-15: the noun form.
 *  One production row (nano-banana-2-lite), told to "try again" on a block
 *  that is permanent for that prompt. */
export const MODERATOR_NOUN_MESSAGES: readonly string[] = [
  "Your prompt was caught by our AI moderator. Please adjust it and try again!",
]
