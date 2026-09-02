import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/config.js", () => ({
  config: { KIE_API_KEY: "test-key", NODE_ENV: "test" },
}))

// ---------------------------------------------------------------------------
// Import module under test (after mocks are registered)
// ---------------------------------------------------------------------------

import {
  classifyContentPolicy,
  classifyContentPolicyClass,
  CONTENT_POLICY_MESSAGE,
  CONTENT_POLICY_MESSAGES,
  KieError,
  createSanitizedError,
  createUpstreamFailureError,
  isUpstreamKieFailure,
  PARAM_REJECT_RE,
  pollKieTask,
  SAFETY_WEAK_RE,
} from "../client.js"
import {
  UNCLASSIFIED_MODERATION_MESSAGES,
  TRANSIENT_UPSTREAM_500_MESSAGES,
  PARAMETER_REJECT_MESSAGES,
} from "./__fixtures__/log-pull-fail-messages.js"

describe("KIE content-policy classification", () => {
  it("matches copyright/IP/policy failMsgs", () => {
    expect(
      classifyContentPolicy(
        "The request failed because the output video may be related to copyright restrictions."
      )
    ).toBe(true)
    expect(classifyContentPolicy("flagged by content policy")).toBe(true)
    expect(classifyContentPolicy("public figure detected")).toBe(true)
  })

  it("does not match transient/technical failures", () => {
    expect(classifyContentPolicy("internal error")).toBe(false)
    expect(classifyContentPolicy("timeout while generating")).toBe(false)
  })
})

describe("createUpstreamFailureError — contentPolicy + userMessage options", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("sets contentPolicy=true and uses userMessage verbatim when the caller classified it", () => {
    const err = createUpstreamFailureError(
      "task failed: [500] The request failed because the output video may be related to copyright restrictions.",
      "Generation",
      { contentPolicy: true, userMessage: CONTENT_POLICY_MESSAGE }
    )

    expect(err).toBeInstanceOf(KieError)
    expect(err.contentPolicy).toBe(true)
    expect(err.isUpstreamFailure).toBe(true)
    expect(err.message).toBe(CONTENT_POLICY_MESSAGE)
    expect(isUpstreamKieFailure(err)).toBe(true)
  })

  it("defaults contentPolicy to false when options is omitted (every pre-existing call site)", () => {
    const err = createUpstreamFailureError("task failed: [400] audio too long", "Generation")

    expect(err.contentPolicy).toBe(false)
    expect(err.isUpstreamFailure).toBe(true)
    expect(err.internalDetails).toBe("task failed: [400] audio too long")
  })

  it("stays false when the caller passes contentPolicy:false and no userMessage (non-content-policy fail)", () => {
    const err = createUpstreamFailureError("task failed: [500] internal error", "Generation", {
      contentPolicy: false,
      userMessage: undefined,
    })

    expect(err.contentPolicy).toBe(false)
    expect(err.isUpstreamFailure).toBe(true)
    expect(err.message).not.toBe(CONTENT_POLICY_MESSAGE)
  })
})

describe("KieError.contentPolicy", () => {
  it("defaults to false for a plain constructor call (existing 3-arg / 4-arg call sites unaffected)", () => {
    const threeArg = new KieError("msg", "internal details", "context")
    expect(threeArg.contentPolicy).toBe(false)

    const fourArg = new KieError("msg", "internal details", "context", true)
    expect(fourArg.contentPolicy).toBe(false)
    expect(fourArg.isUpstreamFailure).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Poll-path: state:"fail" with a copyright failMsg → the thrown KieError is
// classified as contentPolicy + isUpstreamFailure with the real user-facing
// message. Mirrors the fetch-mock + fake-timer harness used in
// client.test.ts's "split tasks" / "VEO onTaskCreated" describe blocks.
// ---------------------------------------------------------------------------
describe('pollKieTask — state:"fail" content-policy classification', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    vi.useFakeTimers()
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function withTimers<T>(fn: () => Promise<T>, advanceMs = 60_000): Promise<T> {
    const promise = fn()
    promise.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(advanceMs)
    return promise
  }

  it("classifies the real prod copyright failMsg (task 1ff42f76, seedance-2)", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/recordInfo")) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              taskId: "1ff42f76",
              state: "fail",
              failCode: "500",
              failMsg:
                "The request failed because the output video may be related to copyright restrictions.",
            },
          }),
          { status: 200 }
        )
      }
      throw new Error(`unexpected url ${url}`)
    })

    const err = await withTimers(() => pollKieTask("1ff42f76")).catch((e) => e)

    expect(err).toBeInstanceOf(KieError)
    expect((err as KieError).contentPolicy).toBe(true)
    expect((err as KieError).contentPolicyClass).toBe("copyright")
    expect((err as KieError).isUpstreamFailure).toBe(true)
    expect((err as KieError).message).toBe(CONTENT_POLICY_MESSAGE)
  })

  it("does NOT classify a transient/technical failMsg as content policy", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/recordInfo")) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              taskId: "task-2",
              state: "fail",
              failCode: "500",
              failMsg: "internal error",
            },
          }),
          { status: 200 }
        )
      }
      throw new Error(`unexpected url ${url}`)
    })

    const err = await withTimers(() => pollKieTask("task-2")).catch((e) => e)

    expect(err).toBeInstanceOf(KieError)
    expect((err as KieError).contentPolicy).toBe(false)
    expect((err as KieError).isUpstreamFailure).toBe(true)
    expect((err as KieError).message).not.toBe(CONTENT_POLICY_MESSAGE)
  })
})

describe("classifyContentPolicyClass — copyright / likeness / safety", () => {
  it("copyright", () => {
    expect(classifyContentPolicyClass("output video may be related to copyright restrictions")).toBe("copyright")
    expect(classifyContentPolicyClass("intellectual property concern")).toBe("copyright")
  })
  it("likeness", () => {
    expect(classifyContentPolicyClass("public figure detected")).toBe("likeness")
    expect(classifyContentPolicyClass("Celebrity likeness is not allowed")).toBe("likeness")
  })
  it("safety", () => {
    expect(classifyContentPolicyClass("flagged by content policy")).toBe("safety")
    expect(classifyContentPolicyClass("prohibited content")).toBe("safety")
    expect(classifyContentPolicyClass("sensitive content detected")).toBe("safety")
    expect(classifyContentPolicyClass("blocked by the safety filter")).toBe("safety")
  })
  it("null for transient text; classifyContentPolicy mirrors it", () => {
    expect(classifyContentPolicyClass("internal error")).toBeNull()
    expect(classifyContentPolicy("internal error")).toBe(false)
    expect(classifyContentPolicy("public figure detected")).toBe(true)
  })
  it("copyright wins when both copyright and a safety word appear", () => {
    expect(classifyContentPolicyClass("copyright violation")).toBe("copyright")
  })
})

describe("createUpstreamFailureError classifies when the caller did not", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  it("a likeness failMsg from a non-pollKieTask site gets the likeness class + message", () => {
    const err = createUpstreamFailureError("Suno task failed: public figure detected", "Music generation")
    expect(err.contentPolicy).toBe(true)
    expect(err.contentPolicyClass).toBe("likeness")
    expect(err.message).toBe(CONTENT_POLICY_MESSAGES.likeness)
  })
  it("a plain upstream failure stays unclassified", () => {
    const err = createUpstreamFailureError("task failed: [400] audio too long", "Generation")
    expect(err.contentPolicy).toBe(false)
    expect(err.contentPolicyClass).toBeNull()
  })
  it("an explicit contentPolicy:false is honoured even when the text would match", () => {
    const err = createUpstreamFailureError("copyright restrictions", "Generation", { contentPolicy: false })
    expect(err.contentPolicy).toBe(false)
    expect(err.contentPolicyClass).toBeNull()
  })
})

describe("the three messages", () => {
  it("copyright keeps the legacy CONTENT_POLICY_MESSAGE text; likeness and safety differ from it", () => {
    expect(CONTENT_POLICY_MESSAGES.copyright).toBe(CONTENT_POLICY_MESSAGE)
    expect(CONTENT_POLICY_MESSAGES.likeness).toContain("real person")
    expect(CONTENT_POLICY_MESSAGES.safety).toContain("safety filter")
    expect(new Set(Object.values(CONTENT_POLICY_MESSAGES)).size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// §11.3 log-pull follow-up: the 10 G1 rows whose provider text matched NEITHER
// the three-way classifier NOR createSanitizedError's keyword list, so a
// permanent content block was reported as "Generation failed, please try
// again". The fixture is shared with log-pull-classification.test.ts (Task 18),
// which is the regression control for the widening below.
// ---------------------------------------------------------------------------

describe("log-pull moderation texts (§11.3) — 10 rows that matched neither regex", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it.each(UNCLASSIFIED_MODERATION_MESSAGES)(
    "classifies $failMsg as safety ($rows rows)",
    ({ failMsg }) => {
      expect(classifyContentPolicyClass(failMsg)).toBe("safety")
      expect(classifyContentPolicy(failMsg)).toBe(true)
    },
  )

  it.each(UNCLASSIFIED_MODERATION_MESSAGES)(
    "gives $failMsg the safety message, never the copyright one",
    ({ failMsg }) => {
      const err = createUpstreamFailureError(`task failed: [400] ${failMsg}`, "Generation")
      expect(err.contentPolicy).toBe(true)
      expect(err.contentPolicyClass).toBe("safety")
      expect(err.message).toBe(CONTENT_POLICY_MESSAGES.safety)
      expect(err.message).not.toBe(CONTENT_POLICY_MESSAGES.copyright)
      // W0's other half: the raw provider text still rides along for
      // `error_detail` / Railway logs — classifying it never replaces it.
      expect(err.internalDetails).toContain(failMsg)
    },
  )

  it.each(UNCLASSIFIED_MODERATION_MESSAGES)(
    "sanitizes $failMsg to the safety message even without the upstream helper",
    ({ failMsg }) => {
      expect(createSanitizedError(failMsg, "Generation", true).message)
        .toBe(CONTENT_POLICY_MESSAGES.safety)
    },
  )
})

describe("the widening does not over-reach", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("leaves the copyright class and message exactly as they were", () => {
    const copyrightText =
      "The request failed because the output video may be related to copyright restrictions."
    expect(classifyContentPolicyClass(copyrightText)).toBe("copyright")
    expect(CONTENT_POLICY_MESSAGE).toBe(CONTENT_POLICY_MESSAGES.copyright)
    expect(createSanitizedError(copyrightText, "Generation", true).message)
      .toContain("Blocked for copyright")
  })

  it("keeps likeness ahead of safety", () => {
    expect(classifyContentPolicyClass("public figure detected")).toBe("likeness")
    expect(classifyContentPolicyClass("this resembles a real person's likeness")).toBe("likeness")
  })

  it.each(TRANSIENT_UPSTREAM_500_MESSAGES)("does not swallow the transient 500 %s", (failMsg) => {
    expect(classifyContentPolicyClass(failMsg)).toBeNull()
  })

  it.each(PARAMETER_REJECT_MESSAGES)("does not reclassify the parameter reject %s", (failMsg) => {
    expect(classifyContentPolicyClass(failMsg)).toBeNull()
  })

  it("the sanitizer applies the same parameter guard as the classifier (M-19a)", () => {
    // Both layers must agree on this one string. Before the guard, the
    // classifier said `null` (retryable) and the sanitizer said "Content
    // policy violation" (permanent) for the same message.
    expect(createSanitizedError("Your input was rejected. Please try again.", "Generation", true).message)
      .toBe(CONTENT_POLICY_MESSAGES.safety)
    expect(createSanitizedError("Your input was rejected — duration out of range", "Generation", true).message)
      .not.toBe(CONTENT_POLICY_MESSAGES.safety)
  })

  it("the weak `input was rejected` signal yields to parameter vocabulary", () => {
    // The bare sentence is a block; the same sentence carrying a fixable
    // parameter is not. Without the guard, a user with a bad resolution would
    // be told their content was blocked and that retrying is pointless.
    expect(classifyContentPolicyClass("Your input was rejected. Please try again.")).toBe("safety")
    expect(classifyContentPolicyClass("Your input was rejected: invalid resolution")).toBeNull()
    expect(classifyContentPolicyClass("Your input was rejected — duration out of range")).toBeNull()
  })

  it("exports the two halves of the weak signal so the split is assertable directly", () => {
    // Test-only exports: the strong vocabulary is asserted through the public
    // classifier above; these two exist so the WEAK path's two conditions can
    // be pinned independently of each other.
    expect(SAFETY_WEAK_RE.test("Your input was rejected. Please try again.")).toBe(true)
    expect(SAFETY_WEAK_RE.test("Content was flagged by the safety system.")).toBe(false)
    expect(PARAM_REJECT_RE.test("duration out of range")).toBe(true)
    expect(PARAM_REJECT_RE.test("invalid resolution")).toBe(true)
    expect(PARAM_REJECT_RE.test("Content was flagged by the safety system.")).toBe(false)
  })
})
