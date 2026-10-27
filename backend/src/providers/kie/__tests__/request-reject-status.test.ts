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
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/config.js", () => ({
  config: { KIE_API_KEY: "test-key", NODE_ENV: "test" },
}))

import {
  classifyContentPolicyClass,
  createSanitizedError,
  createUpstreamFailureError,
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
