import { describe, it, expect, afterEach } from "vitest"
import {
  registerPromptPolicy,
  clearPromptPolicies,
  applyPromptPolicies,
  type PromptPolicy,
} from "../prompt-policy.js"

afterEach(() => clearPromptPolicies())

describe("applyPromptPolicies", () => {
  it("is the identity when no policy is registered (inert default)", () => {
    const input = { prompt: "a cat", negativePrompt: "blurry", kind: "image" as const }
    const out = applyPromptPolicies(input)
    expect(out).toEqual(input)
  })

  it("runs registered policies in registration order", () => {
    const tag = (id: string): PromptPolicy => ({
      id,
      apply: (a) => ({ ...a, prompt: `${a.prompt} [${id}]` }),
    })
    registerPromptPolicy(tag("first"))
    registerPromptPolicy(tag("second"))
    const out = applyPromptPolicies({ prompt: "x", negativePrompt: "", kind: "image" })
    expect(out.prompt).toBe("x [first] [second]")
  })

  it("carries audio vocalGender through the transform", () => {
    const forceMale: PromptPolicy = {
      id: "force-male",
      apply: (a) => (a.kind === "audio" ? { ...a, vocalGender: "male" } : a),
    }
    registerPromptPolicy(forceMale)
    const audio = applyPromptPolicies({ prompt: "song", negativePrompt: "", kind: "audio", vocalGender: "female" })
    expect(audio.vocalGender).toBe("male")
    const image = applyPromptPolicies({ prompt: "cat", negativePrompt: "", kind: "image" })
    expect(image.vocalGender).toBeUndefined()
  })

  it("supports an idempotent marker-segment policy (author contract)", () => {
    const MARKER = " <<modesty>>"
    const modesty: PromptPolicy = {
      id: "modesty",
      apply: (a) => (a.prompt.includes(MARKER) ? a : { ...a, prompt: a.prompt + MARKER }),
    }
    registerPromptPolicy(modesty)
    const once = applyPromptPolicies({ prompt: "p", negativePrompt: "", kind: "image" })
    const twice = applyPromptPolicies(once)
    expect(twice.prompt).toBe("p" + MARKER)
  })
})
