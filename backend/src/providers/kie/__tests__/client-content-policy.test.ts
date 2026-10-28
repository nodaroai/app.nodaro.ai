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
  copyrightSubjectOf,
  INPUT_COPYRIGHT_MESSAGES,
  KieError,
  createSanitizedError,
  createUpstreamFailureError,
  isInputVideoRefusal,
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
import { isContentRejection, isRetryableFailure } from "@/lib/mcp/tools/_job-error.js"
import { safetyBlockOf } from "@/lib/safety-block.js"

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

// ---------------------------------------------------------------------------
// The provider refused the INPUT VIDEO itself (not the prompt, not a reference
// image, not the output). A caller can act on that (send a different clip), so
// it rides on the error as `inputVideoRefused` — beside, never instead of, the
// content-policy class. A COPYRIGHT refusal of the input video gets the
// input-video sentence (rephrasing the prompt cannot help); the flag itself
// never changes the message.
// ---------------------------------------------------------------------------
const INPUT_VIDEO_COPYRIGHT =
  "Input video may be related to copyright restrictions. Please replace the material and try again"
const FILE_PROCESSING_FAILED = "File processing failed"

describe("isInputVideoRefusal", () => {
  it("matches the two input-video refusals", () => {
    expect(isInputVideoRefusal(INPUT_VIDEO_COPYRIGHT)).toBe(true)
    expect(isInputVideoRefusal(FILE_PROCESSING_FAILED)).toBe(true)
    expect(isInputVideoRefusal("task failed: [500] file processing failed.")).toBe(true)
  })

  it("does not match a refused prompt, reference or output", () => {
    expect(isInputVideoRefusal("prompt may be related to copyright")).toBe(false)
    expect(
      isInputVideoRefusal("The request failed because the output video may be related to copyright restrictions."),
    ).toBe(false)
    expect(isInputVideoRefusal("internal error")).toBe(false)
  })
})

describe('pollKieTask — state:"fail" input-video refusal', () => {
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

  function failWith(failMsg: string) {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/recordInfo")) {
        return new Response(
          JSON.stringify({ code: 0, data: { taskId: "t-in", state: "fail", failCode: "500", failMsg } }),
          { status: 200 },
        )
      }
      throw new Error(`unexpected url ${url}`)
    })
  }

  async function failure(): Promise<KieError> {
    const promise = pollKieTask("t-in")
    promise.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(60_000)
    return promise.catch((e) => e) as Promise<KieError>
  }

  it("an input-video copyright refusal keeps the copyright class, says which input, and is flagged", async () => {
    failWith(INPUT_VIDEO_COPYRIGHT)
    const err = await failure()

    expect(err).toBeInstanceOf(KieError)
    expect(err.contentPolicyClass).toBe("copyright")
    expect(err.inputVideoRefused).toBe(true)
    expect(err.inputImageRefused).toBe(false)
    expect(err.isUpstreamFailure).toBe(true)
    expect(err.message).toBe(INPUT_COPYRIGHT_MESSAGES.input_video)
    expect(err.message).toBe("The video model declined one of your videos as possibly copyrighted. Try a different video.")
  })

  it("\"File processing failed\" has no class, keeps the generic message, and is flagged", async () => {
    failWith(FILE_PROCESSING_FAILED)
    const err = await failure()

    expect(err).toBeInstanceOf(KieError)
    expect(err.contentPolicy).toBe(false)
    expect(err.contentPolicyClass).toBeNull()
    expect(err.inputVideoRefused).toBe(true)
    expect(err.isUpstreamFailure).toBe(true)
    // Unchanged user-facing text: the same message an unflagged failure gets.
    expect(err.message).toBe(createSanitizedError("task failed: [500] File processing failed", "Generation", true).message)
  })

  it("an output-video copyright refusal is not flagged", async () => {
    failWith("The request failed because the output video may be related to copyright restrictions.")
    const err = await failure()

    expect(err.contentPolicyClass).toBe("copyright")
    expect(err.inputVideoRefused).toBe(false)
  })
})

describe("createUpstreamFailureError — inputVideoRefused option", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("carries the flag on both the classified and the sanitized path", () => {
    expect(
      createUpstreamFailureError("task failed: [500] x", "Generation", {
        contentPolicy: true,
        contentPolicyClass: "copyright",
        inputVideoRefused: true,
      }).inputVideoRefused,
    ).toBe(true)
    expect(
      createUpstreamFailureError("task failed: [500] x", "Generation", {
        contentPolicy: false,
        inputVideoRefused: true,
      }).inputVideoRefused,
    ).toBe(true)
  })

  it("defaults to false, and never infers it from the message", () => {
    expect(createUpstreamFailureError(`task failed: [500] ${FILE_PROCESSING_FAILED}`, "Generation").inputVideoRefused).toBe(false)
    expect(new KieError("m", "d", "c").inputVideoRefused).toBe(false)
  })
})

describe("classifyContentPolicyClass — copyright / likeness / safety", () => {
  it("safety — the output-side \"appear to be unsafe\" wording gpt-image-2 returns through KIE", () => {
    expect(classifyContentPolicyClass("[400] The generated images appear to be unsafe. Try modifying the prompts.")).toBe("safety")
    expect(classifyContentPolicyClass("unsafe content detected")).toBe("safety")
    // a parameter complaint that merely contains the letters is NOT a block
    expect(classifyContentPolicyClass("unsafeguarded value out of range for duration")).toBeNull()
  })

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

describe("Google safety review block (gemini-omni-flash, prod 2026-10-06)", () => {
  const WIRE =
    "task failed: [400] Request blocked: The uploaded audio was flagged by Google safety review."

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("is an honest, non-retryable safety block, not a 'rejected these settings' 400", () => {
    const err = createUpstreamFailureError(WIRE, "Generation", { upstreamStatus: "400" })
    expect(err.contentPolicy).toBe(true)
    expect(err.contentPolicyClass).toBe("safety")
    expect(err.message).toBe(CONTENT_POLICY_MESSAGES.safety)
    expect(err.message).not.toContain("rejected these settings")
    expect(isContentRejection(err.message)).toBe(true)
    expect(isRetryableFailure(err.message)).toBe(false)
    expect(err.internalDetails).toContain("Google safety review")
  })

  it("the sanitizer alone (no classifier, 400 status) also reads it as a safety block", () => {
    expect(createSanitizedError(WIRE, "Generation", true, false, { upstreamStatus: "400" }).message)
      .toBe(CONTENT_POLICY_MESSAGES.safety)
  })

  it("gets one attempt on both Gemini Omni SKUs, so the worker never re-runs the blocked request", () => {
    const err = createUpstreamFailureError(WIRE, "Generation", { upstreamStatus: "400" })
    expect(safetyBlockOf(err, "gemini-omni-flash")).toEqual({ class: "safety", maxAttempts: 1 })
    expect(safetyBlockOf(err, "gemini-omni-video")).toEqual({ class: "safety", maxAttempts: 1 })
  })

  it("a genuine settings 400 with the same 'Request blocked' prefix stays a settings error", () => {
    const wire = "task failed: [400] Request blocked: unsupported audio format for this model."
    expect(classifyContentPolicyClass(wire)).toBeNull()
    const err = createUpstreamFailureError(wire, "Generation", { upstreamStatus: "400" })
    expect(err.contentPolicy).toBe(false)
    expect(err.message).toContain("rejected these settings")
  })
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

// ---------------------------------------------------------------------------
// The provider refused one of the INPUT IMAGES as possibly copyrighted
// (Seedance 2.5, staging 2026-10-28): "The request failed because the input
// image may be related to copyright restrictions." The output-resemblance
// message told the user to rephrase the prompt, which cannot help. Same class
// (copyright: content policy, refunded, not retried), its own sentence, and
// `inputImageRefused` so the hint can name the input.
// ---------------------------------------------------------------------------
const INPUT_IMAGE_COPYRIGHT = "The request failed because the input image may be related to copyright restrictions."
const OUTPUT_VIDEO_COPYRIGHT = "The request failed because the output video may be related to copyright restrictions."

describe("copyrightSubjectOf", () => {
  it("names the input image or the input video a copyright refusal is about", () => {
    expect(copyrightSubjectOf(INPUT_IMAGE_COPYRIGHT)).toBe("input_image")
    expect(copyrightSubjectOf(`task failed: [400] ${INPUT_IMAGE_COPYRIGHT}`)).toBe("input_image")
    expect(copyrightSubjectOf("Input images may be related to copyright restrictions")).toBe("input_image")
    expect(copyrightSubjectOf(INPUT_VIDEO_COPYRIGHT)).toBe("input_video")
  })

  it("names nothing for the output case, a prompt, or an input mention without copyright", () => {
    expect(copyrightSubjectOf(OUTPUT_VIDEO_COPYRIGHT)).toBeNull()
    expect(copyrightSubjectOf("prompt may be related to copyright")).toBeNull()
    expect(copyrightSubjectOf("input image is too large. Copyright notice: none")).toBeNull()
    expect(copyrightSubjectOf(FILE_PROCESSING_FAILED)).toBeNull()
  })
})

describe('pollKieTask — state:"fail" input-image copyright refusal', () => {
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

  async function failWith(failMsg: string, failCode = "400"): Promise<KieError> {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/recordInfo")) {
        return new Response(
          JSON.stringify({ code: 0, data: { taskId: "t-img", state: "fail", failCode, failMsg } }),
          { status: 200 },
        )
      }
      throw new Error(`unexpected url ${url}`)
    })
    const promise = pollKieTask("t-img")
    promise.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(60_000)
    return promise.catch((e) => e) as Promise<KieError>
  }

  it("keeps the copyright class and upstream/content-policy flags, with the input-image sentence", async () => {
    const err = await failWith(INPUT_IMAGE_COPYRIGHT)

    expect(err).toBeInstanceOf(KieError)
    expect(err.contentPolicy).toBe(true)
    expect(err.contentPolicyClass).toBe("copyright")
    expect(err.isUpstreamFailure).toBe(true)
    expect(err.inputImageRefused).toBe(true)
    expect(err.inputVideoRefused).toBe(false)
    expect(err.message).toBe(
      "The video model declined one of your pictures as possibly copyrighted. Try a different picture.",
    )
    expect(err.message).toBe(INPUT_COPYRIGHT_MESSAGES.input_image)
    // Never the vendor, never the prompt advice.
    expect(err.message).not.toMatch(/kie|seedance|bytedance/i)
    expect(err.message).not.toMatch(/prompt/i)
  })

  it("the output-resemblance case is unchanged", async () => {
    const err = await failWith(OUTPUT_VIDEO_COPYRIGHT, "500")

    expect(err.contentPolicyClass).toBe("copyright")
    expect(err.inputImageRefused).toBe(false)
    expect(err.message).toBe(CONTENT_POLICY_MESSAGES.copyright)
    expect(err.message).toBe(
      "The provider declined this generation: the output may resemble protected (copyrighted) content. Rephrasing the prompt usually resolves this.",
    )
  })
})

describe("input-image copyright — every throw path", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("createUpstreamFailureError classifies it on its own (other poll clients)", () => {
    const err = createUpstreamFailureError(`task failed: [400] ${INPUT_IMAGE_COPYRIGHT}`, "Generation")
    expect(err.contentPolicyClass).toBe("copyright")
    expect(err.inputImageRefused).toBe(true)
    expect(err.message).toBe(INPUT_COPYRIGHT_MESSAGES.input_image)
  })

  it("a caller-supplied message still wins, and the flag still rides", () => {
    const err = createUpstreamFailureError(`task failed: [400] ${INPUT_IMAGE_COPYRIGHT}`, "Generation", {
      userMessage: "custom",
    })
    expect(err.message).toBe("custom")
    expect(err.inputImageRefused).toBe(true)
  })

  it("the sanitizer (createTask refusals) uses the same sentence", () => {
    const err = createSanitizedError(
      `createTask error (code 400): ${INPUT_IMAGE_COPYRIGHT}`,
      "Generation",
      false,
      false,
      { upstreamStatus: 400 },
    )
    expect(err.message).toBe(INPUT_COPYRIGHT_MESSAGES.input_image)
  })

  it("the flag never rides a non-copyright class", () => {
    const err = new KieError("m", "i", "Generation", true, true, "safety", false, true)
    expect(err.inputImageRefused).toBe(false)
  })
})
