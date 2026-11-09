/**
 * The content guard's funnel and its two signal sources (lib/content-guard.ts,
 * lib/content-guard-subject.ts).
 *
 * The guard's vocabulary is a deployment's private content, so nothing here
 * uses real words: `MINORTERM` / `ADULTTERM` stand in for the two lists, and the
 * registered guard below is the same shape a deployment registers.
 *
 * The first describe block is the one that protects every other deployment:
 * with no guard registered the funnel returns before looking at anything.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const audit = vi.hoisted(() => ({
  recordJobPolicyDecision: vi.fn(async (_input: Record<string, unknown>) => "decision-1"),
  hashGateSubject: vi.fn((_subject: unknown) => "hash-1"),
}))
vi.mock("../job-policy-audit.js", () => audit)

import {
  __flushContentGuardAuditForTests,
  clearContentGuard,
  CONTENT_GUARD_MESSAGE,
  CONTENT_GUARD_POLICY_ID,
  guardAssembledPrompt,
  hasContentGuard,
  refuseProhibitedContent,
  registerContentGuard,
  type ContentGuard,
  type ContentGuardSubject,
} from "../content-guard.js"
import { subjectOfAssembly, subjectOfInputData } from "../content-guard-subject.js"
import { JobBlockedError, POLICY_UNAVAILABLE_MESSAGE, PLATFORM_POLICY_ID } from "../job-policy.js"
import { applyPromptPolicies, clearPromptPolicies } from "../prompt-policy.js"
import { isDeterministicJobError } from "../deterministic-job-error.js"

/** Refuses when a minor signal or MINORTERM meets ADULTTERM, like a deployment's guard. */
function registerPlaceholderGuard(): ContentGuardSubject[] {
  const seen: ContentGuardSubject[] = []
  registerContentGuard({
    proveReady: () => true,
    id: "placeholder-guard",
    check(subject) {
      seen.push(subject)
      const text = subject.texts.join(" ")
      const minor = subject.minorSignal || text.includes("MINORTERM")
      return minor && text.includes("ADULTTERM") ? { refused: true, reason: "placeholder-combination" } : { refused: false }
    },
  })
  return seen
}

const lane = { lane: "test-lane", userId: "user-1", jobType: "generate-image" }

beforeEach(() => {
  clearContentGuard()
  clearPromptPolicies()
  vi.clearAllMocks()
})

afterEach(async () => {
  await __flushContentGuardAuditForTests()
  clearContentGuard()
})

describe("with no guard registered", () => {
  it("is inert: nothing is checked, nothing is written, the prompt funnel is the identity", async () => {
    expect(hasContentGuard()).toBe(false)
    expect(refuseProhibitedContent({ texts: ["MINORTERM ADULTTERM"], minorSignal: true }, lane)).toBeNull()
    const assembly = { prompt: "MINORTERM ADULTTERM", negativePrompt: "", kind: "image" as const }
    expect(applyPromptPolicies(assembly)).toEqual(assembly)
    await __flushContentGuardAuditForTests()
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
  })
})

describe("registration", () => {
  const unproven = { id: "no-vocabulary", check: () => ({ refused: false as const }) }

  it("a guard that cannot prove it has a vocabulary is not registered", () => {
    expect(() => registerContentGuard({ ...unproven, proveReady: () => false })).toThrow(/no-vocabulary/)
    expect(hasContentGuard()).toBe(false)
  })

  it("a guard whose proof throws is not registered", () => {
    expect(() =>
      registerContentGuard({
        ...unproven,
        proveReady: () => {
          throw new Error("boom")
        },
      }),
    ).toThrow(/no-vocabulary/)
    expect(hasContentGuard()).toBe(false)
  })

  it("a guard with no proof at all is not registered", () => {
    expect(() => registerContentGuard(unproven as unknown as ContentGuard)).toThrow(/no-vocabulary/)
    expect(hasContentGuard()).toBe(false)
  })

  it("a guard that proves itself is registered", () => {
    registerContentGuard({ ...unproven, proveReady: () => true })
    expect(hasContentGuard()).toBe(true)
  })
})

describe("the combination rule", () => {
  beforeEach(() => {
    registerPlaceholderGuard()
  })

  it("refuses a minor term with an adult term, with the platform's sentence and id", () => {
    const block = refuseProhibitedContent({ texts: ["MINORTERM and ADULTTERM"], minorSignal: false }, lane)
    expect(block).toEqual({ code: "job_blocked", policyId: CONTENT_GUARD_POLICY_ID, message: CONTENT_GUARD_MESSAGE })
  })

  it("allows either term alone", () => {
    expect(refuseProhibitedContent({ texts: ["MINORTERM at the park"], minorSignal: false }, lane)).toBeNull()
    expect(refuseProhibitedContent({ texts: ["ADULTTERM in a studio"], minorSignal: false }, lane)).toBeNull()
  })

  it("refuses an adult term with a structured minor signal and no minor word", () => {
    expect(refuseProhibitedContent({ texts: ["ADULTTERM"], minorSignal: true }, lane)?.code).toBe("job_blocked")
  })

  it("the sentence names no term and echoes nothing from the request", () => {
    expect(CONTENT_GUARD_MESSAGE).not.toMatch(/MINORTERM|ADULTTERM/)
    expect(CONTENT_GUARD_MESSAGE.length).toBeGreaterThan(10)
  })
})

describe("refusal record", () => {
  it("writes job_policy_decisions: a request block with a hash, never the text", async () => {
    registerPlaceholderGuard()
    refuseProhibitedContent({ texts: ["MINORTERM ADULTTERM"], minorSignal: false }, lane)
    await __flushContentGuardAuditForTests()
    expect(audit.recordJobPolicyDecision).toHaveBeenCalledTimes(1)
    const row = audit.recordJobPolicyDecision.mock.calls[0]![0]
    expect(row).toMatchObject({
      jobId: null,
      hookPoint: "request",
      policyId: CONTENT_GUARD_POLICY_ID,
      verdict: "block",
      reason: "placeholder-combination",
      userMessage: CONTENT_GUARD_MESSAGE,
      payloadHash: "hash-1",
      userId: "user-1",
      jobType: "generate-image",
    })
    expect(JSON.stringify(row)).not.toMatch(/MINORTERM|ADULTTERM/)
  })

  it("logs the lane and the guard, never the text", () => {
    registerPlaceholderGuard()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    refuseProhibitedContent({ texts: ["MINORTERM ADULTTERM"], minorSignal: false }, lane)
    const logged = warn.mock.calls.flat().map(String).join(" ")
    warn.mockRestore()
    expect(logged).toContain("test-lane")
    expect(logged).not.toMatch(/MINORTERM|ADULTTERM/)
  })
})

describe("fail closed", () => {
  it("a guard that throws refuses, in the platform's own words", async () => {
    registerContentGuard({
      proveReady: () => true,
      id: "broken-guard",
      check() {
        throw new Error("boom")
      },
    })
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const block = refuseProhibitedContent({ texts: ["a cat"], minorSignal: false }, lane)
    error.mockRestore()
    expect(block).toEqual({ code: "job_blocked", policyId: PLATFORM_POLICY_ID, message: POLICY_UNAVAILABLE_MESSAGE })
    await __flushContentGuardAuditForTests()
    expect(audit.recordJobPolicyDecision.mock.calls[0]![0]).toMatchObject({ policyId: PLATFORM_POLICY_ID, reason: "policy-unavailable", verdict: "block" })
  })
})

describe("a request too large to read", () => {
  it("is refused in the platform's own words, and never reaches the guard as a partial read", async () => {
    const seen = registerPlaceholderGuard()
    const block = refuseProhibitedContent({ texts: ["a cat"], minorSignal: false, overLimit: true }, lane)
    expect(block).toEqual({ code: "job_blocked", policyId: PLATFORM_POLICY_ID, message: POLICY_UNAVAILABLE_MESSAGE })
    expect(seen).toHaveLength(0)
    await __flushContentGuardAuditForTests()
    expect(audit.recordJobPolicyDecision.mock.calls[0]![0]).toMatchObject({ policyId: PLATFORM_POLICY_ID, reason: "content-guard:over-limit", verdict: "block" })
  })

  it("is not refused with no guard registered", () => {
    expect(refuseProhibitedContent({ texts: ["a cat"], minorSignal: false, overLimit: true }, lane)).toBeNull()
  })
})

describe("the prompt funnel", () => {
  beforeEach(() => {
    registerPlaceholderGuard()
  })

  it("throws JobBlockedError for the assembled prompt before any policy runs", () => {
    expect(() => applyPromptPolicies({ prompt: "MINORTERM ADULTTERM", negativePrompt: "", kind: "video" })).toThrow(JobBlockedError)
  })

  it("never reads the negative prompt: it lists what to keep OUT", () => {
    const assembly = { prompt: "MINORTERM at the park", negativePrompt: "ADULTTERM", kind: "image" as const }
    expect(applyPromptPolicies(assembly)).toEqual(assembly)
  })

  it("subjectMinor counts as a minor signal", () => {
    expect(() => applyPromptPolicies({ prompt: "ADULTTERM", negativePrompt: "", kind: "image", subjectMinor: true })).toThrow(JobBlockedError)
  })

  it("a JobBlockedError is final: a job is not retried for it", () => {
    let thrown: unknown
    try {
      guardAssembledPrompt({ prompt: "MINORTERM ADULTTERM", negativePrompt: "", kind: "image" })
    } catch (err) {
      thrown = err
    }
    expect(isDeterministicJobError(thrown)).toBe(true)
  })
})

describe("subjectOfAssembly", () => {
  it("reads the prompt, the catalog's minor hints and subjectMinor, and never the negative", () => {
    expect(subjectOfAssembly({ prompt: "a cat", negativePrompt: "x", kind: "image" })).toEqual({ texts: ["a cat"], minorSignal: false, kind: "image" })
    expect(subjectOfAssembly({ prompt: "a cat", negativePrompt: "", kind: "image", subjectMinor: true }).minorSignal).toBe(true)
    // `a child around 8 years old` is the Person catalog's own hint for its `age-child` entry.
    expect(subjectOfAssembly({ prompt: "a child around 8 years old", negativePrompt: "", kind: "image" }).minorSignal).toBe(true)
    expect(subjectOfAssembly({ prompt: "a grandmother in a garden", negativePrompt: "", kind: "image" }).minorSignal).toBe(false)
  })
})

describe("subjectOfInputData", () => {
  it("collects every text the request carries, deep, without URLs or negatives", () => {
    const subject = subjectOfInputData({
      prompt: "MINORTERM",
      promptPrefix: "before",
      userPrompt: "typed",
      negativePrompt: "ADULTTERM-NEGATIVE",
      negative_prompt: "ADULTTERM-NEGATIVE-2",
      negativeStyle: "ADULTTERM-NEGATIVE-3",
      imageUrl: "https://cdn.example.test/ADULTTERM-url.png",
      shots: [{ prompt: "shot one", negativePrompt: "ADULTTERM-NEGATIVE-4" }, { prompt: "shot two" }],
      dialogue: { line: "spoken" },
      duration: 8,
      keep: true,
    })
    const all = subject.texts.join(" | ")
    expect(all).toContain("MINORTERM")
    expect(all).toContain("before")
    expect(all).toContain("typed")
    expect(all).toContain("shot one")
    expect(all).toContain("shot two")
    expect(all).toContain("spoken")
    expect(all).not.toContain("ADULTTERM")
    expect(subject.minorSignal).toBe(false)
  })

  it("reads text that begins with a scheme: only a value that is wholly an address is skipped", () => {
    const subject = subjectOfInputData({
      first: "https: MINORTERM",
      second: "data: ADULTTERM one",
      third: "http://example.test/a.png ADULTTERM two",
      fourth: "gs:MINORTERM and more",
      fifth: "blob: ADULTTERM three",
      imageUrl: "https://cdn.example.test/ADULTTERM-url.png",
      frame: "data:image/png;base64,QUJDRA==",
      upload: "blob:https://example.test/0000",
      bucket: "s3://bucket/ADULTTERM-key.png",
      storage: "gs://bucket/ADULTTERM-object.png",
    })
    const all = subject.texts.join(" | ")
    expect(all).toContain("https: MINORTERM")
    expect(all).toContain("data: ADULTTERM one")
    expect(all).toContain("http://example.test/a.png ADULTTERM two")
    expect(all).toContain("gs:MINORTERM and more")
    expect(all).toContain("blob: ADULTTERM three")
    expect(all).not.toContain("ADULTTERM-url")
    expect(all).not.toContain("QUJDRA")
    expect(all).not.toContain("ADULTTERM-key")
    expect(all).not.toContain("ADULTTERM-object")
  })

  it("reads the minor signal from a Person value, derived from the catalog", () => {
    expect(subjectOfInputData({ person: { age: "age-child" } }).minorSignal).toBe(true)
    expect(subjectOfInputData({ person: { age: "age-30s" } }).minorSignal).toBe(false)
    expect(subjectOfInputData({ person: { age: "age-custom", customAge: 14 } }).minorSignal).toBe(true)
    expect(subjectOfInputData({ person: { age: "age-custom", customAge: 34 } }).minorSignal).toBe(false)
    expect(subjectOfInputData({ subject: { age: "age-early-teen" } }).minorSignal).toBe(true)
    expect(subjectOfInputData({ characterPerson: { age: "age-toddler" } }).minorSignal).toBe(true)
    expect(subjectOfInputData({ node: { person: { age: "age-pre-teen" } } }).minorSignal).toBe(true)
  })

  it("reads the flag, and the catalog's minor hint in any text", () => {
    expect(subjectOfInputData({ subjectMinor: true, prompt: "a cat" }).minorSignal).toBe(true)
    expect(subjectOfInputData({ subjectMinor: false, prompt: "a cat" }).minorSignal).toBe(false)
    expect(subjectOfInputData({ prompt: "a child around 8 years old" }).minorSignal).toBe(true)
  })

  it("reads a structured age and the child gender of the structured-prompt shape", () => {
    expect(subjectOfInputData({ fields: { person: { age: 9 } } }).minorSignal).toBe(true)
    expect(subjectOfInputData({ fields: { person: { age: 34 } } }).minorSignal).toBe(false)
    expect(subjectOfInputData({ fields: { person: { gender: "child" } } }).minorSignal).toBe(true)
  })

  it("reads a long text to its end", () => {
    const subject = subjectOfInputData({ prompt: `${"word ".repeat(10_000)}MINORTERM` })
    expect(subject.texts.join(" ")).toContain("MINORTERM")
  })

  it("reads a text however many come before it", () => {
    const subject = subjectOfInputData({ list: Array.from({ length: 5000 }, (_, i) => `item ${i}`), prompt: "MINORTERM" })
    expect(subject.texts.join(" ")).toContain("MINORTERM")
  })

  it("reads past many characters of other fields", () => {
    const subject = subjectOfInputData({ a: "x ".repeat(100_000), prompt: "MINORTERM" })
    expect(subject.texts.join(" ")).toContain("MINORTERM")
  })

  it("reads at any depth, and a minor signal there counts", () => {
    let nested: Record<string, unknown> = { prompt: "MINORTERM", person: { age: "age-child" } }
    for (let i = 0; i < 40; i++) nested = { next: nested }
    const subject = subjectOfInputData(nested)
    expect(subject.texts).toContain("MINORTERM")
    expect(subject.minorSignal).toBe(true)
  })

  it("very deep nesting neither overflows the stack nor goes unread", () => {
    let nested: Record<string, unknown> = { prompt: "MINORTERM" }
    for (let i = 0; i < 200_000; i++) nested = { next: nested }
    expect(subjectOfInputData(nested).texts).toContain("MINORTERM")
  })

  it("a value that holds itself does not hang the funnel", () => {
    const looped: Record<string, unknown> = { prompt: "MINORTERM" }
    looped.self = looped
    expect(subjectOfInputData(looped).texts).toEqual(["MINORTERM"])
  })

  it("keeps the order the request wrote its fields in", () => {
    expect(subjectOfInputData({ a: "one", nested: { b: "two" }, c: "three" }).texts).toEqual(["one", "two", "three"])
  })

  it("past what any request can carry, it says so instead of reading part of it", () => {
    const subject = subjectOfInputData({ prompt: "x ".repeat(20_000_000), other: "MINORTERM" })
    expect(subject.overLimit).toBe(true)
  })

  it("handles nothing at all", () => {
    expect(subjectOfInputData(null)).toEqual({ texts: [], minorSignal: false })
    expect(subjectOfInputData(undefined)).toEqual({ texts: [], minorSignal: false })
  })
})
