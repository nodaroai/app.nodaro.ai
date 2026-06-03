import { describe, it, expect } from "vitest"
import { assembleImageInput } from "../assemble-image-input.js"
import { buildImagePrompt } from "../prompt-builder.js"
import {
  getFramingPromptHint,
  getLightingPromptHint,
} from "../index.js"
import type { ConnectedReference } from "../types.js"

/**
 * `assembleImageInput` is the keystone of removing the assembly mirror: the
 * platform callers (execute-node / payload-builder) and Studio all route their
 * `generate-image` assembly through it. These tests pin BOTH layers:
 *   (a) the id-based composition (direction / structured) — ported from
 *       Studio's `assembly.test.ts` as the oracle, and
 *   (b) the BY-CONSTRUCTION PARITY the caller refactor relies on: with no
 *       direction/structured, the wrapper === the old inline `buildImagePrompt`
 *       call + empty-check, byte-for-byte.
 */

// flux-2-max supports reference images (used to assert refs survive the gate).
const REF_PROVIDER = "flux-2-max"

describe("assembleImageInput — id-based composition (Studio oracle)", () => {
  it("returns the bare userPrompt verbatim with no direction/structured", () => {
    const result = assembleImageInput({
      userPrompt: "a knight",
      provider: REF_PROVIDER,
    })
    expect(result).toEqual({
      nativeNegativePrompt: undefined,
      prompt: "a knight",
      referenceImageUrls: undefined,
    })
  })

  it("bakes a framing hint and forwards a bound reference's URL", () => {
    const ref: ConnectedReference = {
      id: "ref-hero",
      defaultName: "Image 1",
      source: "manual",
      url: "https://r2.example/hero.png",
    }
    const result = assembleImageInput({
      userPrompt: "a knight",
      provider: REF_PROVIDER,
      connectedReferences: [ref],
      direction: { framingId: "medium-shot" },
    })
    expect(result.prompt).toBe(`a knight. ${getFramingPromptHint("medium-shot")}`)
    expect(result.referenceImageUrls).toEqual(["https://r2.example/hero.png"])
  })

  it("folds Shot Type + Angle independently (separate framing pills)", () => {
    const result = assembleImageInput({
      userPrompt: "a knight",
      provider: REF_PROVIDER,
      direction: { framingId: "medium-shot", framingAngleId: "low-angle" },
    })
    expect(result.prompt).toBe(
      `a knight. ${getFramingPromptHint("medium-shot")}. ${getFramingPromptHint("low-angle")}`,
    )
  })

  it("folds multi-dimension direction (Composer Framing path)", () => {
    const kira: ConnectedReference = {
      id: "kira-id",
      defaultName: "Kira",
      source: "wired-character",
      url: "https://r2.example/kira.png",
      description: "a young woman with red hair",
      characterSlug: "kira",
      variantSlug: undefined,
      characterCanonicalDescription: "a young woman with red hair",
      variantDescription: null,
      variantDisplayName: "canonical",
    }
    const result = assembleImageInput({
      userPrompt: "walking through the forest",
      provider: REF_PROVIDER,
      connectedReferences: [kira],
      direction: { framingId: "wide-shot", lightingId: "golden-hour" },
    })
    expect(result.prompt).toContain("walking through the forest")
    expect(result.prompt).toContain(getFramingPromptHint("wide-shot"))
    expect(result.prompt).toContain(getLightingPromptHint("golden-hour"))
    expect(result.referenceImageUrls).toEqual(["https://r2.example/kira.png"])
  })

  it("appends a rendered structured-fields fragment", () => {
    const result = assembleImageInput({
      userPrompt: "a portrait",
      provider: REF_PROVIDER,
      structured: { person: { age: 30, gender: "woman", expression: "calm" } },
    })
    expect(result.prompt).toBe("a portrait. Subject: 30 years old, woman, calm expression.")
  })
})

describe("assembleImageInput — empty-prompt throw (opt-in)", () => {
  it("throws on a truly-empty FINAL prompt when throwOnEmpty=true", () => {
    expect(() =>
      assembleImageInput({ userPrompt: "   ", provider: REF_PROVIDER, throwOnEmpty: true }),
    ).toThrow(/No prompt/)
  })

  it("does NOT throw on a blank prompt when throwOnEmpty is omitted, and preserves it VERBATIM (backend parity)", () => {
    const result = assembleImageInput({ userPrompt: "   ", provider: REF_PROVIDER })
    // No hints → exact no-op: the blank prompt is preserved byte-for-byte (the
    // old platform path passed it straight to buildImagePrompt, which doesn't
    // trim). Emptiness is decided by the throwOnEmpty check's own `.trim()`, not
    // by mutating the prompt here.
    expect(result.prompt).toBe("   ")
  })

  it("does NOT throw when a bound entity fills an otherwise-empty prompt", () => {
    const kira: ConnectedReference = {
      id: "kira-id",
      defaultName: "Kira",
      source: "wired-character",
      url: "https://r2.example/kira.png",
      characterSlug: "kira",
      variantSlug: undefined,
      characterCanonicalDescription: "a young woman with red hair",
      variantDescription: null,
      variantDisplayName: "canonical",
    }
    const result = assembleImageInput({
      userPrompt: "",
      provider: REF_PROVIDER,
      connectedReferences: [kira],
      throwOnEmpty: true,
    })
    // The canonical-fallback block filled the prompt → no throw.
    expect(result.prompt.length).toBeGreaterThan(0)
  })
})

describe("assembleImageInput — extras threading + per-provider ref gate", () => {
  it("threads extra URLs into referenceImageUrls for a supporting provider", () => {
    const result = assembleImageInput({
      userPrompt: "a city street",
      provider: REF_PROVIDER,
      extraReferenceImageUrls: ["https://r2.example/upload-a.png"],
    })
    expect(result.referenceImageUrls).toEqual(["https://r2.example/upload-a.png"])
  })

  it("drops refs for a provider with NO reference support (gate delegated to buildImagePrompt)", () => {
    // `flux-schnell` is a text-to-image model with no reference support, so the
    // builder returns `referenceImageUrls: undefined`.
    const result = assembleImageInput({
      userPrompt: "a city street",
      provider: "flux-schnell",
      extraReferenceImageUrls: ["https://r2.example/upload-a.png"],
    })
    expect(result.referenceImageUrls).toBeUndefined()
  })
})

/**
 * BY-CONSTRUCTION PARITY: this is the contract the two platform-caller
 * refactors rely on. With NO direction/structured, `assembleImageInput`
 * must return EXACTLY what the old inline `buildImagePrompt` call produced
 * for the same inputs — byte-for-byte on all three result fields.
 */
describe("assembleImageInput — platform-caller parity (no direction)", () => {
  const kira: ConnectedReference = {
    id: "ref-kira",
    defaultName: "Kira",
    source: "wired-character",
    description: "young woman with warm smile",
    url: "https://r2/kira-portrait.png",
    characterSlug: "kira",
    variantSlug: undefined,
    characterCanonicalDescription: "young woman, brown eyes, auburn hair",
    variantDescription: null,
    variantDisplayName: "canonical",
  }

  const fixtures: Array<{ name: string; cfg: Parameters<typeof buildImagePrompt>[0] }> = [
    {
      name: "plain prompt, no refs",
      cfg: { prompt: "a knight on a hill", provider: REF_PROVIDER },
    },
    {
      name: "directRefs via referenceImageUrls + style + negativePrompt",
      cfg: {
        prompt: "a city at night",
        provider: REF_PROVIDER,
        style: "cinematic",
        negativePrompt: "blurry, low quality",
        referenceImageUrls: ["https://r2/a.png", "https://r2/b.png"],
      },
    },
    {
      name: "connectedReferences (wired character canonical fallback)",
      cfg: {
        prompt: "@kira:1 walking through the rain",
        provider: REF_PROVIDER,
        connectedReferences: [kira],
        suppressedCanonicalCharacterIds: [],
        identityMeta: [],
      },
    },
    {
      name: "empty prompt (backend never throws here)",
      cfg: { prompt: "", provider: REF_PROVIDER, referenceImageUrls: [] },
    },
    {
      // Regression guard: the old platform path passed the prompt straight to
      // buildImagePrompt (no trim). The wrapper's no-direction path MUST return
      // it verbatim — trimming here would change the assembled prompt + the
      // recorded jobs.input_data byte-for-byte.
      name: "trailing-whitespace prompt — NOT trimmed (exact no-op parity)",
      cfg: { prompt: "a knight on a hill \n", provider: REF_PROVIDER },
    },
    {
      name: "leading-whitespace prompt — NOT trimmed (exact no-op parity)",
      cfg: { prompt: "  a city at night", provider: REF_PROVIDER },
    },
  ]

  for (const { name, cfg } of fixtures) {
    it(`matches the old inline buildImagePrompt for: ${name}`, () => {
      const oldResult = buildImagePrompt(cfg)

      const wrapped = assembleImageInput({
        userPrompt: cfg.prompt,
        provider: cfg.provider,
        connectedReferences: cfg.connectedReferences,
        extraReferenceImageUrls: cfg.referenceImageUrls as string[] | undefined,
        negativePrompt: cfg.negativePrompt,
        style: cfg.style,
        referenceOrder: cfg.referenceOrder,
        identityMeta: cfg.identityMeta,
        suppressedCanonicalCharacterIds: cfg.suppressedCanonicalCharacterIds,
        suppressedCanonicalLocationIds: cfg.suppressedCanonicalLocationIds,
        characterDefs: cfg.characterDefs,
        userTemplates: cfg.userTemplates,
        flowTemplates: cfg.flowTemplates,
        ancestorRefs: cfg.ancestorRefs,
        skipCharacterMentions: cfg.skipCharacterMentions,
        // no `throwOnEmpty` → backend parity (no throw)
      })

      expect(wrapped).toEqual(oldResult)
    })
  }
})
