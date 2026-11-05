/**
 * Lane-G triage (2026-09-15): a provider 4xx is the request's fault, a 5xx is
 * the provider's. 13 production rows were told "please try again" for a reject
 * that is deterministic on the same inputs; one 500 whose sentence READS like
 * a validation error succeeded on a byte-identical retry minutes later.
 *
 * The pin is therefore two-sided and it is about the STATUS, not the words:
 * every 4xx string here must stop saying "try again", and the 5xx string must
 * keep saying it — no matter how validation-shaped its wording is.
 */
import { requestRefusedHintOf } from "../../../lib/safety-block.js"
import { isSeedance2EditModeRejection } from "../seedance-edit-mode.js"
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/config.js", () => ({
  config: { KIE_API_KEY: "test-key", NODE_ENV: "test" },
}))

import {
  classifyContentPolicyClass,
  createSanitizedError,
  createUpstreamFailureError,
  isInputVideoRefusal,
  isRequestRejectStatus,
} from "../client.js"
import { isContentRejection, isRetryableFailure, failureGuidance } from "@/lib/mcp/tools/_job-error.js"
import {
  REQUEST_REJECT_4XX,
  TRANSIENT_500_WITH_VALIDATION_WORDING,
  TRANSIENT_UPSTREAM_500_MESSAGES,
  MODERATOR_NOUN_MESSAGES,
  GENERIC_4XX_NO_REASON,
} from "./__fixtures__/log-pull-fail-messages.js"

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})

const REJECT_PHRASE = "rejected these settings"

describe("isRequestRejectStatus", () => {
  it.each([400, 422, "400", "422"])("%s is a request reject", (s) => {
    expect(isRequestRejectStatus(s)).toBe(true)
  })

  it.each([500, 502, 503, 429, 401, 403, 404, "no_code", "", null, undefined])(
    "%s is not",
    (s) => {
      // 429 is already the rate-limit branch's; 401/403 are OUR key, not the
      // user's inputs; an unreadable code must never become a permanent verdict.
      expect(isRequestRejectStatus(s as never)).toBe(false)
    },
  )
})

describe("a 4xx reject stops telling the user to try again", () => {
  it.each(REQUEST_REJECT_4XX)("$internalMessage", ({ internalMessage, status }) => {
    const err = createSanitizedError(internalMessage, "Generation", true, false, {
      upstreamStatus: status,
    })
    expect(err.message).toContain(REJECT_PHRASE)
    expect(err.message).not.toContain("Please try again or contact support")
  })

  it.each(REQUEST_REJECT_4XX)("$internalMessage is permanent for MCP callers", ({ internalMessage, status }) => {
    const userMessage = createSanitizedError(internalMessage, "Generation", true, false, {
      upstreamStatus: status,
    }).message
    expect(isRetryableFailure(userMessage)).toBe(false)
    expect(failureGuidance({ error_message: userMessage }).retryable).toBe(false)
  })

  it.each(REQUEST_REJECT_4XX)("$internalMessage is NOT a content rejection", ({ internalMessage, status }) => {
    // The app-report sweep must keep filing these as `job-failure`. Titling a
    // fixable parameter error "rejected by the provider's content filter"
    // sends the user to rewrite a prompt that was never the problem.
    expect(classifyContentPolicyClass(internalMessage)).toBeNull()
    const userMessage = createSanitizedError(internalMessage, "Generation", true, false, {
      upstreamStatus: status,
    }).message
    expect(isContentRejection(userMessage)).toBe(false)
  })

  it("keeps the context prefix so the message still names what failed", () => {
    const err = createSanitizedError(REQUEST_REJECT_4XX[0]!.internalMessage, "Video generation", true, false, {
      upstreamStatus: 400,
    })
    expect(err.message.startsWith("Video generation failed")).toBe(true)
  })

  it("threads through createUpstreamFailureError", () => {
    const err = createUpstreamFailureError(REQUEST_REJECT_4XX[2]!.internalMessage, "Generation", {
      upstreamStatus: 422,
    })
    expect(err.message).toContain(REJECT_PHRASE)
    expect(err.isUpstreamFailure).toBe(true)
  })
})

describe("a 4xx with only the provider's generic failMsg claims no verdict it was not given", () => {
  // Job 4064e12e (2026-10-26): KIE said "Generation failed. Please try again
  // later." and nothing else. Telling the user the settings were rejected and a
  // retry will fail sent them after duration/aspect/resolution when the cause
  // was the reference video's pixel size.
  const NO_REASON_COPY =
    "Generation failed: the provider couldn't produce a result and gave no reason. " +
    "It may be a temporary problem on their side, or something about the input media " +
    "(such as its size or format). Try again, or change the input media and try again."

  it.each(GENERIC_4XX_NO_REASON)("$internalMessage", ({ internalMessage, status }) => {
    const err = createSanitizedError(internalMessage, "Generation", true, false, {
      upstreamStatus: status,
    })
    expect(err.message).toBe(NO_REASON_COPY)
    expect(err.message).not.toContain(REJECT_PHRASE)
    expect(err.message).not.toContain("will fail again")
  })

  it("the production row through the real throw path (createUpstreamFailureError, failCode as a string)", () => {
    const failMsg = "Generation failed. Please try again later."
    const cls = classifyContentPolicyClass(failMsg)
    const err = createUpstreamFailureError(`task failed: [400] ${failMsg}`, "Generation", {
      contentPolicy: cls !== null,
      contentPolicyClass: cls,
      upstreamStatus: "400",
    })
    expect(err.message).toBe(NO_REASON_COPY)
    expect(err.isUpstreamFailure).toBe(true)
    expect(err.contentPolicy).toBe(false)
  })

  it.each(GENERIC_4XX_NO_REASON)("$internalMessage is not a content rejection, and is retryable for MCP callers", ({ internalMessage, status }) => {
    // The provider named no permanent cause and its own words say to try
    // again, so an MCP caller hears the same "try again" the user does.
    const msg = createSanitizedError(internalMessage, "Generation", true, false, { upstreamStatus: status }).message
    expect(isContentRejection(msg)).toBe(false)
    expect(isRetryableFailure(msg)).toBe(true)
    expect(failureGuidance({ error_message: msg })).toMatchObject({
      retryable: true,
      guidance: expect.stringContaining("This may be transient — retrying the same request is reasonable."),
    })
  })

  it("keeps the context prefix", () => {
    const err = createSanitizedError(GENERIC_4XX_NO_REASON[0]!.internalMessage, "Video generation", true, false, {
      upstreamStatus: 400,
    })
    expect(err.message.startsWith("Video generation failed: the provider couldn't produce a result")).toBe(true)
  })

  it.each(REQUEST_REJECT_4XX)("a reason-bearing 4xx keeps the exact old copy: $internalMessage", ({ internalMessage, status }) => {
    const err = createSanitizedError(internalMessage, "Generation", true, false, { upstreamStatus: status })
    expect(err.message).toBe(
      "Generation failed: the provider rejected these settings for this model. " +
        "Retrying the same request will fail again — change the settings or the input media " +
        "(duration, aspect ratio, resolution, or the reference image/video/audio) and try again.",
    )
  })

  it.each([
    "Generation failed. Please try again later. The video resolution exceeds 2048 px.",
    "Generation failed: duration must be between 3 and 15 seconds",
  ])("a generic opening followed by a reason is NOT generic: %s", (failMsg) => {
    const err = createSanitizedError(`task failed: [400] ${failMsg}`, "Generation", true, false, { upstreamStatus: "400" })
    expect(err.message).not.toBe(NO_REASON_COPY)
  })

  it("the same generic words on a 5xx keep the plain retry fallback", () => {
    const err = createSanitizedError("task failed: [500] Generation failed. Please try again later.", "Generation", true, false, {
      upstreamStatus: 500,
    })
    expect(err.message).toBe("Generation failed. Please try again or contact support if the issue persists.")
  })
})

describe("a request the provider refused is marked on the error, for the job's error_hint", () => {
  const sanitized = (internalMessage: string, status: number | string) =>
    createSanitizedError(internalMessage, "Generation", true, false, { upstreamStatus: status })

  it.each(REQUEST_REJECT_4XX)("$internalMessage is marked", ({ internalMessage, status }) => {
    expect(sanitized(internalMessage, status).requestRefused).toBe(true)
  })

  it.each([
    // Prod 2026-11-04, jobs 62182ea6 and 074197fe: a WebP sent to Kling 4.0.
    ["task failed: [400] Unsupported file format. Images must be JPG or PNG. Please convert the file and try again.", 400],
    ["task failed: [422] video_urls total duration must not exceed 30 seconds", 422],
    ["task failed: [422] The prompt is too long", 422],
    ["task failed: [400] aspect_ratio must be one of 16:9, 9:16", 400],
    ["task failed: [400] Invalid duration", 400],
    ["task failed: [400] This model does not support reference audio", 400],
    // Production logs, October 2026.
    ['createTask error (code 422): {"code":422,"msg":"seed is not supported by Seedance 2.5","data":null}', 422],
    ['createTask error (code 422): {"code":422,"msg":"video_url is required","data":null}', 422],
    ['createTask error (code 422): {"code":422,"msg":"The total duration of the video cannot exceed 15 seconds","data":null}', 422],
    ["task failed: [400] Invalid value for parameter: content[3].", 400],
    ["task failed: [400] No valid characters detected in the video", 400],
    ["task failed: [400] Not enough speech in the voice audio. Please use a 5-30 second clip with clear speech and no long pauses.", 400],
  ] as const)("%s is marked, whichever sentence it gets", (internalMessage, status) => {
    expect(sanitized(internalMessage, status).requestRefused).toBe(true)
  })

  it.each(GENERIC_4XX_NO_REASON)("$internalMessage names no reason: not marked", ({ internalMessage, status }) => {
    expect(sanitized(internalMessage, status).requestRefused).toBe(false)
  })

  it.each(TRANSIENT_500_WITH_VALIDATION_WORDING)("$internalMessage is a 5xx: not marked", ({ internalMessage, status }) => {
    expect(sanitized(internalMessage, status).requestRefused).toBe(false)
  })

  it.each([
    ["task failed: [400] upload failed", 400],
    ["task failed: [400] Image fetch failed. Check access settings or use our File Upload API instead.", 400],
    ["task failed: [400] The request timed out", 400],
    ["task failed: [400] rate limit reached", 400],
    ["task failed: [400] Credits insufficient", 400],
    ["task failed: [400] The generated images appear to be unsafe. Try modifying the prompts.", 400],
    ["task failed: [400] Request blocked: flagged by Google safety review.", 400],
    ["task failed: [400] Input video may be related to copyright restrictions.", 400],
    ['createTask error (code 400): {"code":400,"msg":"Invalid input: NSFW content detected","data":null}', 400],
  ] as const)("%s is not the request's fault or is a content block: not marked", (internalMessage, status) => {
    expect(sanitized(internalMessage, status).requestRefused).toBe(false)
  })

  it("an unreadable status is not marked, whatever the words", () => {
    expect(createSanitizedError("task failed: Invalid duration", "Generation", true).requestRefused).toBe(false)
  })

  it("a proxy's own marked message is not marked", () => {
    const err = createSanitizedError("task failed: [400] Invalid duration", "Generation", true, false, {
      upstreamStatus: 400,
      userSafeMessage: "The proxy says no.",
    })
    expect(err.requestRefused).toBe(false)
  })

  it("a terminal task failure carries it through createUpstreamFailureError", () => {
    const refused = createUpstreamFailureError(
      "task failed: [400] Unsupported file format. Images must be JPG or PNG. Please convert the file and try again.",
      "Generation",
      { upstreamStatus: 400 },
    )
    expect(refused.requestRefused).toBe(true)
    expect(createUpstreamFailureError("task failed: [501] Input video may be related to copyright restrictions.", "Generation", { upstreamStatus: 400 }).requestRefused).toBe(false)
  })
})

describe("KIE's \"Image fetch failed\" is the provider failing to fetch the media, not a rejected request", () => {
  it("says the media could not be loaded, and stays retryable", () => {
    const err = createSanitizedError("task failed: [400] Image fetch failed. Check access settings or use our File Upload API instead.", "Generation", true, false, {
      upstreamStatus: 400,
    })
    expect(err.message).toContain("couldn't load the input media")
    expect(err.message).not.toContain(REJECT_PHRASE)
    expect(isRetryableFailure(err.message)).toBe(true)
  })
})

describe("KIE's \"File processing failed\" that asks to check the link is the provider failing to load a file", () => {
  // Staging, 2026-10-20: the only two wordings of it in the logs.
  it.each([
    "task failed: [400] File processing failed, please check the URL",
    "task failed: [400] File processing failed. Please check the asset link or re-upload",
  ])("%s says the media could not be loaded: retryable, not a refusal", (internalMessage) => {
    const err = createSanitizedError(internalMessage, "Generation", true, false, { upstreamStatus: 400 })
    expect(err.message).toContain("couldn't load the input media")
    expect(err.requestRefused).toBe(false)
    expect(isRetryableFailure(err.message)).toBe(true)
    expect(isInputVideoRefusal(internalMessage.replace("task failed: [400] ", ""))).toBe(false)
  })

  it("the bare sentence stays a refusal of the input video", () => {
    expect(isInputVideoRefusal("File processing failed")).toBe(true)
  })
})

describe("beside a demand for -1, the clip is named only if the request already said -1", () => {
  const hintOf = (internalMessage: string, job: Record<string, unknown>) =>
    requestRefusedHintOf(createSanitizedError(internalMessage, "Generation", true, false, { upstreamStatus: 400 }), job)
  const NAMES_THE_CLIP = { kind: "request-refused", subject: "input_video" }
  const NAMES_NOTHING = { kind: "request-refused" }
  const referenceVideoUrls = ["https://cdn.example/clip.mp4"]
  const DEMANDS_MINUS_ONE =
    "task failed: [400] Invalid parameters: the 'duration' parameter must be -1, and the input video duration must be between 4 and 30 seconds"

  it("a request with a length of its own: that length may be what is wrong (job 6a75d7d3 sent 4)", () => {
    expect(hintOf(DEMANDS_MINUS_ONE, { referenceVideoUrls, aspectRatio: "adaptive", duration: 4 })).toEqual(NAMES_NOTHING)
    expect(hintOf(DEMANDS_MINUS_ONE, { referenceVideoUrls, aspectRatio: "adaptive" })).toEqual(NAMES_NOTHING)
  })

  it("a request that said -1, as a Cast Swap edit does: only the clip is left", () => {
    expect(hintOf(DEMANDS_MINUS_ONE, { referenceVideoUrls, aspectRatio: "adaptive", duration: -1 })).toEqual(NAMES_THE_CLIP)
  })

  it("words the resubmit knows stand only after it, so the request had the shape whatever the job asked", () => {
    const resubmitted =
      "task failed: [400] Parameter validation failed: ratio must be adaptive, duration must be -1, and the input video duration must be between 4 and 30 seconds"
    expect(isSeedance2EditModeRejection(resubmitted)).toBe(true)
    expect(hintOf(resubmitted, { referenceVideoUrls, aspectRatio: "16:9", duration: 12 })).toEqual(NAMES_THE_CLIP)
  })

  it("a limit with no demand beside it is the clip's, whatever length the job asked", () => {
    const limit = 'createTask error (code 422): {"code":422,"msg":"video_urls total duration must not exceed 30 seconds","data":null}'
    expect(hintOf(limit, { referenceVideoUrls, duration: 12 })).toEqual(NAMES_THE_CLIP)
  })

  it("a job that sent no video has none to name", () => {
    expect(hintOf(DEMANDS_MINUS_ONE, { duration: -1 })).toEqual(NAMES_NOTHING)
  })
})

describe("a refused request that names the input video says so", () => {
  const sanitized = (internalMessage: string, status: number | string) =>
    createSanitizedError(internalMessage, "Generation", true, false, { upstreamStatus: status })

  it.each([
    ['createTask error (code 422): {"code":422,"msg":"video_urls total duration must not exceed 30 seconds","data":null}', 422],
    ['createTask error (code 422): {"code":422,"msg":"The total duration of the video cannot exceed 15 seconds","data":null}', 422],
    ['createTask error (code 422): {"code":422,"msg":"reference_video_urls duration must be between 1 and 15 seconds","data":null}', 422],
    ["task failed: [400] Each reference video must be between 2 and 30 seconds", 400],
    ["task failed: [400] No valid characters detected in the video", 400],
    ["task failed: [400] video_1 duration must be between 2 and 30 seconds, got 45", 400],
    ["task failed: [400] content[1].video_url: invalid param: video duration 52838 ms, expected [2000, 15000] ms", 400],
    ["task failed: [400] Invalid parameters: the 'duration' parameter must be -1, and the input video duration must be between 4 and 30 seconds", 400],
    ["task failed: [400] Parameter validation failed: ratio must be adaptive, duration must be -1, and the input video duration must be between 4 and 30 seconds", 400],
    ["task failed: [400] The parameter `content[1]` specified in the request is not valid: the parameter video pixel count specified in the request must be greater than 409600", 400],
  ] as const)("%s names the clip", (internalMessage, status) => {
    const err = sanitized(internalMessage, status)
    expect(err.requestRefused).toBe(true)
    expect(err.requestRefusedSubject).toBe("input_video")
  })

  it.each([
    ["task failed: [400] Unsupported file format. Images must be JPG or PNG. Please convert the file and try again.", 400],
    ["task failed: [400] Not enough speech in the voice audio. Please use a 5-30 second clip with clear speech and no long pauses.", 400],
    ['createTask error (code 422): {"code":422,"msg":"seed is not supported by Seedance 2.5","data":null}', 422],
    ["task failed: [400] The parameters `ratio` and `duration` specified in the request are not valid. Seedance identified your task as video editing.", 400],
    ["task failed: [400] Invalid value for parameter: content[3].", 400],
    // The field's name is not a limit on the clip.
    ['createTask error (code 422): {"code":422,"msg":"video_url is required","data":null}', 422],
    // Job c007fd87: the words for the request's own length, with no limit named on the clip.
    ["task failed: [400] Based on your prompt (and reference video), the model classified this as video editing rather than normal generation. Set duration to -1, and ensure the reference video is 4\u201330 seconds.", 400],
  ] as const)("%s names no clip", (internalMessage, status) => {
    const err = sanitized(internalMessage, status)
    expect(err.requestRefused).toBe(true)
    expect(err.requestRefusedSubject).toBeNull()
  })

  it("is never set without the refusal", () => {
    expect(sanitized("task failed: [500] video_urls total duration must not exceed 30 seconds", 500).requestRefusedSubject).toBeNull()
    expect(sanitized("task failed: [400] Generation failed. Please try again later.", 400).requestRefusedSubject).toBeNull()
  })
})

describe("a 5xx keeps the retry message however validation-shaped its wording", () => {
  it.each(TRANSIENT_500_WITH_VALIDATION_WORDING)("$internalMessage", ({ internalMessage, status }) => {
    const err = createSanitizedError(internalMessage, "Generation", true, false, {
      upstreamStatus: status,
    })
    expect(err.message).not.toContain(REJECT_PHRASE)
    expect(err.message).toContain("Please try again")
    expect(isRetryableFailure(err.message)).toBe(true)
  })

  it.each(TRANSIENT_UPSTREAM_500_MESSAGES)("%s with a 500 status stays retryable", (failMsg) => {
    const err = createSanitizedError(`task failed: [500] ${failMsg}`, "Generation", true, false, {
      upstreamStatus: 500,
    })
    expect(err.message).not.toContain(REJECT_PHRASE)
    expect(isRetryableFailure(err.message)).toBe(true)
  })

  it("a missing status is left exactly as it was", () => {
    // Every KIE client that does NOT pass a status keeps today's behaviour --
    // the branch can only ever fire on a status we were handed.
    const err = createSanitizedError("some unmapped provider complaint", "Generation", true)
    expect(err.message).toBe("Generation failed. Please try again or contact support if the issue persists.")
  })
})

describe("a 4xx that is really a content block stays a content block", () => {
  it.each(MODERATOR_NOUN_MESSAGES)("%s classifies as safety", (failMsg) => {
    expect(classifyContentPolicyClass(failMsg)).toBe("safety")
  })

  it.each(MODERATOR_NOUN_MESSAGES)("%s gets the content-policy message, not the reject one", (failMsg) => {
    // Order matters: the content branches read the words and run BEFORE the
    // status branch, so a moderated 400 is never demoted to "wrong settings".
    const err = createSanitizedError(`task failed: [400] ${failMsg}`, "Generation", true, false, {
      upstreamStatus: 400,
    })
    expect(err.message).not.toContain(REJECT_PHRASE)
    expect(isContentRejection(err.message)).toBe(true)
  })

  it.each(MODERATOR_NOUN_MESSAGES)("%s reaches the sweep as a rejection through the real throw path", (failMsg) => {
    const cls = classifyContentPolicyClass(failMsg)
    const err = createUpstreamFailureError(`task failed: [400] ${failMsg}`, "Generation", {
      contentPolicy: cls !== null,
      contentPolicyClass: cls,
      upstreamStatus: "400",
    })
    expect(err.contentPolicy).toBe(true)
    expect(err.contentPolicyClass).toBe("safety")
    expect(isContentRejection(err.message)).toBe(true)
    expect(isRetryableFailure(err.message)).toBe(false)
  })
})

describe("KIE's \"upload failed\" is the provider failing to fetch the media, not a rejected request", () => {
  // Prod 2026-10-31 (job d3736b0d) and 2026-11-01 (job 57c29d77): Kling 4 runs
  // failed "[400] upload failed" and the same requests succeeded moments later.
  const UPLOAD_FAILED_COPY =
    "Generation failed: the provider couldn't load the input media. This is usually temporary — try again."

  it("reads as temporary, never as rejected settings", () => {
    const err = createSanitizedError("task failed: [400] upload failed", "Generation", true, false, {
      upstreamStatus: "400",
    })
    expect(err.message).toBe(UPLOAD_FAILED_COPY)
    expect(err.message).not.toContain(REJECT_PHRASE)
    expect(err.message).not.toContain("will fail again")
  })

  it("through the real throw path, it stays an upstream failure and is retryable for MCP callers", () => {
    const failMsg = "upload failed"
    const cls = classifyContentPolicyClass(failMsg)
    const err = createUpstreamFailureError(`task failed: [400] ${failMsg}`, "Generation", {
      contentPolicy: cls !== null,
      contentPolicyClass: cls,
      upstreamStatus: "400",
    })
    expect(err.message).toBe(UPLOAD_FAILED_COPY)
    expect(err.isUpstreamFailure).toBe(true)
    expect(err.contentPolicy).toBe(false)
    expect(isContentRejection(err.message)).toBe(false)
    expect(isRetryableFailure(err.message)).toBe(true)
  })

  it("keeps the context prefix", () => {
    const err = createSanitizedError("task failed: [400] upload failed", "Video generation", true, false, {
      upstreamStatus: 400,
    })
    expect(err.message.startsWith("Video generation failed: the provider couldn't load the input media.")).toBe(true)
  })
})
