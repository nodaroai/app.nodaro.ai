import { describe, it, expect } from "vitest"
import { isGeminiOmniProvider, videoCharacterRefProviders, VIDEO_REF_LIMITS_BY_PROVIDER, GEMINI_OMNI_VOICE_PRESET_IDS } from "@nodaro/shared"
import { characterReferenceSchema, characterReferencesSchema } from "../character-reference-schema.js"

/**
 * The wire shape of `characterReferences`, with the REAL `safeUrlSchema` (the
 * route tests stub it with a bare `z.string().url()`, so the SSRF gate was never
 * exercised on these fields).
 */
const ok = { imageUrl: "https://cdn.example.com/portrait.png", description: "A woman with short silver hair" }

describe("characterReferenceSchema — SSRF parity with referenceImageUrls", () => {
  it("accepts a public portrait and body image", () => {
    expect(characterReferenceSchema.safeParse({ ...ok, bodyImageUrl: "https://cdn.example.com/body.png", name: "Ava" }).success).toBe(true)
  })

  it.each([
    ["localhost", "http://localhost/p.png"],
    ["a loopback IP", "http://127.0.0.1/p.png"],
    ["a private IP", "http://10.0.0.5/p.png"],
    ["the cloud metadata IP", "http://169.254.169.254/latest/meta-data"],
    ["a non-http scheme", "ftp://cdn.example.com/p.png"],
    ["not a URL", "not a url"],
  ])("rejects %s as the portrait", (_label, imageUrl) => {
    expect(characterReferenceSchema.safeParse({ ...ok, imageUrl }).success).toBe(false)
  })

  it("rejects a private body image too", () => {
    expect(characterReferenceSchema.safeParse({ ...ok, bodyImageUrl: "http://192.168.1.10/b.png" }).success).toBe(false)
  })
})

describe("characterReferenceSchema — description and name", () => {
  it("trims the description and the name", () => {
    const r = characterReferenceSchema.parse({ ...ok, description: "  silver hair  ", name: "  Ava " })
    expect(r.description).toBe("silver hair")
    expect(r.name).toBe("Ava")
  })
  it.each([
    ["a missing description", { description: undefined }],
    ["a whitespace-only description", { description: "   " }],
    ["a 2001-char description", { description: "x".repeat(2001) }],
    ["a blank name", { name: "  " }],
    ["a 101-char name", { name: "n".repeat(101) }],
  ])("rejects %s", (_label, over) => {
    expect(characterReferenceSchema.safeParse({ ...ok, ...over }).success).toBe(false)
  })
  it("accepts the exact limits (2000 / 100)", () => {
    expect(characterReferenceSchema.safeParse({ ...ok, description: "x".repeat(2000), name: "n".repeat(100) }).success).toBe(true)
  })
})

describe("characterReferencesSchema — count", () => {
  it("allows up to 3 and rejects 4", () => {
    expect(characterReferencesSchema.safeParse([ok, ok, ok]).success).toBe(true)
    expect(characterReferencesSchema.safeParse([ok, ok, ok, ok]).success).toBe(false)
  })
})

describe("characterReferences consumer guard", () => {
  // Provider support is DATA (a positive `characters` cap) — but only
  // `runGeminiOmni` consumes the field today. Give another provider a cap and
  // the route would accept the field while that provider silently dropped it:
  // the very failure this input exists to prevent. Wire the consumer first,
  // then widen this list on purpose.
  it("every provider that declares a `characters` cap has a provider path that threads characterReferences", () => {
    const withCap = Object.entries(VIDEO_REF_LIMITS_BY_PROVIDER)
      .filter(([, l]) => (l?.characters ?? 0) > 0)
      .map(([id]) => id)
    expect(withCap.length).toBeGreaterThan(0)
    for (const id of withCap) expect(isGeminiOmniProvider(id), `${id} declares characters but has no consumer`).toBe(true)
    expect(videoCharacterRefProviders().sort()).toEqual(withCap.sort())
  })
})

describe("characterReferenceSchema — voice persona", () => {
  it("accepts a preset-only voice and a full voice", () => {
    expect(characterReferenceSchema.safeParse({ ...ok, voice: { preset: "kore" } }).success).toBe(true)
    expect(
      characterReferenceSchema.safeParse({ ...ok, voice: { preset: "puck", description: "warm, slow", exampleLine: "Hello there" } }).success,
    ).toBe(true)
  })

  it("rejects an unknown preset and a missing preset", () => {
    expect(characterReferenceSchema.safeParse({ ...ok, voice: { preset: "morgan" } }).success).toBe(false)
    expect(characterReferenceSchema.safeParse({ ...ok, voice: { description: "warm" } }).success).toBe(false)
  })

  it("accepts every documented preset id", () => {
    for (const preset of GEMINI_OMNI_VOICE_PRESET_IDS) {
      expect(characterReferenceSchema.safeParse({ ...ok, voice: { preset } }).success).toBe(true)
    }
  })

  it("enforces the 2000 / 120 limits and trims", () => {
    expect(characterReferenceSchema.safeParse({ ...ok, voice: { preset: "kore", description: "x".repeat(2000) } }).success).toBe(true)
    expect(characterReferenceSchema.safeParse({ ...ok, voice: { preset: "kore", description: "x".repeat(2001) } }).success).toBe(false)
    expect(characterReferenceSchema.safeParse({ ...ok, voice: { preset: "kore", exampleLine: "x".repeat(120) } }).success).toBe(true)
    expect(characterReferenceSchema.safeParse({ ...ok, voice: { preset: "kore", exampleLine: "x".repeat(121) } }).success).toBe(false)
    const parsed = characterReferenceSchema.parse({ ...ok, voice: { preset: "kore", description: "  warm  ", exampleLine: " hi " } })
    expect(parsed.voice).toEqual({ preset: "kore", description: "warm", exampleLine: "hi" })
  })

  it("rejects unknown keys inside voice (no smuggling an upstream field)", () => {
    expect(characterReferenceSchema.safeParse({ ...ok, voice: { preset: "kore", audio_id: "x" } }).success).toBe(false)
  })
})
