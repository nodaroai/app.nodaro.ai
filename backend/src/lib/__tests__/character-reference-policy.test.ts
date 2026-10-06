import { describe, it, expect, afterEach } from "vitest"
import { applyPromptPoliciesToCharacterReferences } from "../character-reference-policy.js"
import { registerPromptPolicy, clearPromptPolicies } from "../prompt-policy.js"

const ref = (over: Record<string, unknown> = {}) => ({
  imageUrl: "https://cdn.example/p.png",
  description: "A woman with short silver hair",
  ...over,
})

afterEach(() => clearPromptPolicies())

function registerTagPolicy(): string[] {
  const seen: string[] = []
  registerPromptPolicy({
    id: "test-tag",
    apply: (a) => {
      seen.push(a.prompt)
      return { ...a, prompt: a.prompt.includes("[policed]") ? a.prompt : `${a.prompt} [policed]` }
    },
  })
  return seen
}

describe("applyPromptPoliciesToCharacterReferences", () => {
  it("is the identity with no policy registered, including a voice", () => {
    const refs = [ref({ voice: { preset: "kore", description: "warm", exampleLine: "Hi" } })]
    expect(applyPromptPoliciesToCharacterReferences(refs as never)).toEqual(refs)
    expect(applyPromptPoliciesToCharacterReferences(undefined)).toBeUndefined()
  })

  it("polices the character description AND the voice description through the same funnel", () => {
    const seen = registerTagPolicy()
    const out = applyPromptPoliciesToCharacterReferences([
      ref({ name: "Ava", voice: { preset: "kore", description: "warm, slow", exampleLine: "Hello there" } }),
    ] as never)!
    expect(out[0]!.description).toBe("A woman with short silver hair [policed]")
    expect(out[0]!.voice?.description).toBe("warm, slow [policed]")
    expect(seen).toEqual(["A woman with short silver hair", "warm, slow"])
    // Labels and the spoken example line are not subject text: never policed.
    expect(out[0]!.name).toBe("Ava")
    expect(out[0]!.voice?.exampleLine).toBe("Hello there")
    expect(out[0]!.voice?.preset).toBe("kore")
  })

  it("a preset-only voice has no description to police and is kept as is", () => {
    registerTagPolicy()
    const out = applyPromptPoliciesToCharacterReferences([ref({ voice: { preset: "puck" } })] as never)!
    expect(out[0]!.voice).toEqual({ preset: "puck" })
  })

  it("a character without a voice gains none", () => {
    registerTagPolicy()
    const out = applyPromptPoliciesToCharacterReferences([ref()] as never)!
    expect("voice" in out[0]!).toBe(false)
  })
})
