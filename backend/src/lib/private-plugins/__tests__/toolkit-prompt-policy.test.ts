/**
 * `tk.prompts.applyPolicies` — the plugin lane's door into the deployment's
 * prompt policy (`lib/prompt-policy.ts`).
 *
 * The invariant: a prompt a plugin assembles passes through exactly the
 * policies a core route's prompt does, in registration order, read at CALL
 * time (a policy registered after the toolkit was built still applies). With
 * nothing registered the member is the identity, so a plugin that adopts it
 * changes nothing on an install without a content policy.
 */
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { buildToolkit } from "../toolkit.js"
import { clearPromptPolicies, registerPromptPolicy, type PromptAssembly } from "../../prompt-policy.js"
import { clearContentGuard, CONTENT_GUARD_MESSAGE, registerContentGuard } from "../../content-guard.js"
import { isDeterministicJobError } from "../../deterministic-job-error.js"
import { jobBlockHintOf } from "../../safety-block.js"

afterEach(() => {
  clearPromptPolicies()
  clearContentGuard()
})

function applyPolicies() {
  const member = buildToolkit().prompts?.applyPolicies
  expect(typeof member).toBe("function")
  return member!
}

describe("tk.prompts.applyPolicies", () => {
  it("is the identity when no policy is registered, and hands back a new object", () => {
    const assembly = { prompt: "a dancer on a rooftop", negativePrompt: "blurry", kind: "video" as const }

    const out = applyPolicies()(assembly)

    expect(out).toEqual(assembly)
    expect(out).not.toBe(assembly)
  })

  it("runs the registered policies in order, over the whole assembly", () => {
    registerPromptPolicy({ id: "first", apply: (a) => ({ ...a, prompt: `${a.prompt} [first]` }) })
    registerPromptPolicy({
      id: "second",
      apply: (a) => ({ ...a, prompt: `${a.prompt} [second]`, negativePrompt: `${a.negativePrompt}, extra`, vocalGender: "m" }),
    })

    const out = applyPolicies()({ prompt: "p", negativePrompt: "n", kind: "audio", vocalGender: "f" })

    expect(out).toEqual({ prompt: "p [first] [second]", negativePrompt: "n, extra", kind: "audio", vocalGender: "m" })
  })

  it("applies a policy registered after the toolkit was built", () => {
    const tk = buildToolkit()
    registerPromptPolicy({ id: "late", apply: (a) => ({ ...a, prompt: `${a.prompt}!` }) })

    expect(tk.prompts!.applyPolicies({ prompt: "p", negativePrompt: "", kind: "image" }).prompt).toBe("p!")
  })

  it("hands the policy the kind and the minor flag, and never mutates the caller's object", () => {
    const seen: PromptAssembly[] = []
    registerPromptPolicy({
      id: "spy",
      apply: (a) => {
        seen.push({ ...a })
        a.prompt = "rewritten in place"
        return a
      },
    })
    const input = Object.freeze({ prompt: "p", negativePrompt: "", kind: "image" as const, subjectMinor: true })

    const out = applyPolicies()(input)

    expect(seen).toEqual([{ prompt: "p", negativePrompt: "", kind: "image", subjectMinor: true }])
    expect(input.prompt).toBe("p")
    expect(out.prompt).toBe("rewritten in place")
  })

  it("a prompt the content guard refuses reaches the plugin as a sendable refusal, final for a job", () => {
    registerContentGuard({
      proveReady: () => true,
      id: "placeholder-guard",
      check: (subject) => (subject.texts.join(" ").includes("MINORTERM") ? { refused: true, reason: "placeholder" } : { refused: false }),
    })
    let thrown: unknown
    try {
      applyPolicies()({ prompt: "MINORTERM", negativePrompt: "", kind: "image" })
    } catch (err) {
      thrown = err
    }
    const refusal = thrown as { name: string; statusCode: number; body: { error: { code: string; message: string } } }
    expect(refusal.name).toBe("PluginHttpError")
    expect(refusal.statusCode).toBe(422)
    expect(refusal.body).toEqual({ error: { code: "job_blocked", message: CONTENT_GUARD_MESSAGE } })
    // A plugin job handler that lets this escape is failed for good, with the
    // block's hint, because the worker reads the cause chain.
    expect(isDeterministicJobError(thrown)).toBe(true)
    expect(jobBlockHintOf(thrown)).toEqual({ kind: "policy-block", policyId: "platform:content-guard", reason: CONTENT_GUARD_MESSAGE, hookPoint: "request" })
  })
})
