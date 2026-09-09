/**
 * The system block, per surface.
 *
 * The canvas prompt is the doctrine plus the workflow reference; the studio
 * prompt is its own doctrine plus the two slices the studio service SERVES —
 * the operation vocabulary and the plan format's rules. Keeping the served
 * text out of this repo is the point: there is one home for it, and the copilot
 * reads that home rather than carrying a copy that drifts.
 *
 * Which makes the cache key the interesting part. The served guide carries no
 * version of its own, so the BYTES are the version: a deployment that starts
 * serving a different vocabulary composes a different prompt, and one that
 * serves the same vocabulary reuses the composition it already paid for — the
 * cached prefix is what keeps a studio turn cheap.
 */
import { describe, expect, it, beforeEach } from "vitest"
import { buildSystemPrompt, resetSystemPromptCache } from "../system-prompt.js"
import { COPILOT_DOCTRINE, STUDIO_COPILOT_DOCTRINE } from "../doctrine.js"

const TAILS = { vocabulary: "## Editing a production\n\nset_shot_name …", rules: "## Rules\n\nA plan is …" }

beforeEach(() => resetSystemPromptCache())

describe("the canvas prompt", () => {
  it("is what it was, with no argument and with its surface named", () => {
    expect(buildSystemPrompt()).toContain(COPILOT_DOCTRINE)
    expect(buildSystemPrompt()).toBe(buildSystemPrompt("workflow"))
    expect(buildSystemPrompt()).not.toContain(STUDIO_COPILOT_DOCTRINE)
  })
})

describe("the studio prompt", () => {
  it("is the studio doctrine and the two served slices, and nothing of the canvas", () => {
    const prompt = buildSystemPrompt("studio", TAILS)
    expect(prompt).toContain(STUDIO_COPILOT_DOCTRINE)
    expect(prompt).toContain(TAILS.vocabulary)
    expect(prompt).toContain(TAILS.rules)
    expect(prompt).not.toContain(COPILOT_DOCTRINE)
  })

  it("omits a slice the guide did not carry, rather than leaving a gap where it was", () => {
    const prompt = buildSystemPrompt("studio", { vocabulary: TAILS.vocabulary, rules: null })
    expect(prompt).toContain(TAILS.vocabulary)
    expect(prompt).not.toContain("\n\n\n")
  })
})

describe("the cache", () => {
  it("reuses one composition for the same served bytes", () => {
    expect(buildSystemPrompt("studio", TAILS)).toBe(buildSystemPrompt("studio", { ...TAILS }))
  })

  it("composes again when the served bytes change", () => {
    const first = buildSystemPrompt("studio", TAILS)
    const second = buildSystemPrompt("studio", { ...TAILS, vocabulary: `${TAILS.vocabulary} and one more op` })
    expect(second).not.toBe(first)
    expect(second).toContain("and one more op")
    // The first composition is still the first: a second guide does not
    // rewrite the prompt a thread already paid a cache write for.
    expect(buildSystemPrompt("studio", TAILS)).toBe(first)
  })

  it("keeps the two surfaces apart", () => {
    const studio = buildSystemPrompt("studio", TAILS)
    expect(buildSystemPrompt("workflow")).not.toBe(studio)
    expect(buildSystemPrompt("studio", TAILS)).toBe(studio)
  })
})
