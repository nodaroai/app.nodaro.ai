import { describe, it, expect, afterEach } from "vitest"
import { getAdultOnlyHintStrings } from "@nodaro/prompts"
import {
  buildPortraitPrompt,
  buildAssetPromptText,
  buildMotionPromptText,
  portraitScaffolding,
  assetStillScaffolding,
  PORTRAIT_SCAFFOLDING,
  ASSET_STILL_SCAFFOLDING,
  ASSET_MOTION_SCAFFOLDING,
  CLOTHED_DEFAULT,
} from "../character-prompts.js"
import { MODEST_ATTIRE_CLAUSE, registerMainlinePromptPolicies } from "../prompt-policies/index.js"
import { applyPromptPolicies, clearPromptPolicies } from "../prompt-policy.js"

/** Occurrences of `needle` in `haystack` (the "exactly once" assertions). */
function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe("buildPortraitPrompt", () => {
  it("appends portrait scaffolding to the seed prompt", () => {
    const prompt = buildPortraitPrompt({ seedPrompt: "young woman, designer glasses, warm smile" })
    expect(prompt).toContain("young woman, designer glasses, warm smile")
    expect(prompt).toContain(PORTRAIT_SCAFFOLDING)
  })

  it("does NOT include canonical description even when provided", () => {
    // canonical_description is anchored to the OLD portrait — must not bias re-gens
    const prompt = buildPortraitPrompt({ seedPrompt: "young woman" })
    expect(prompt).not.toContain("canonical")
  })

  it("weaves injectedAssets after the seed, before the scaffolding", () => {
    // Element/asset injection: wired-in text composed by the editor.
    const prompt = buildPortraitPrompt({ seedPrompt: "young woman", injectedAssets: "wearing a leather jacket" })
    expect(prompt).toContain("young woman, wearing a leather jacket")
    expect(prompt.indexOf("wearing a leather jacket")).toBeLessThan(prompt.indexOf(PORTRAIT_SCAFFOLDING))
  })

  it("is a no-op when injectedAssets is empty / whitespace / absent", () => {
    const base = buildPortraitPrompt({ seedPrompt: "young woman" })
    expect(buildPortraitPrompt({ seedPrompt: "young woman", injectedAssets: "" })).toBe(base)
    expect(buildPortraitPrompt({ seedPrompt: "young woman", injectedAssets: "   " })).toBe(base)
  })

  it("defaults the subject to clothed (a face-referenced studio shot renders nude/underwear otherwise)", () => {
    // No outfit picked → nothing specifies clothing → the model fills a bare body.
    // The scaffolding carries a clothed floor so an outfit-less portrait is dressed.
    expect(PORTRAIT_SCAFFOLDING).toMatch(/clothed/i)
    expect(buildPortraitPrompt({ seedPrompt: "young woman" })).toMatch(/clothed/i)
  })
})

describe("buildAssetPromptText", () => {
  it("composes canonical + asset + variant + scaffolding", () => {
    const prompt = buildAssetPromptText({
      canonicalDescription: "Kira: late 20s, Indian, dark hair, brown eyes, designer glasses, warm presence",
      assetDescription: "warm closed-mouth smile, slight eye crinkle",
      variantOrPrompt: "smile",
      assetType: "expressions",
    })
    expect(prompt).toContain("Kira: late 20s")
    expect(prompt).toContain("warm closed-mouth smile")
    expect(prompt).toContain(ASSET_STILL_SCAFFOLDING)
  })

  it("omits canonical when null/empty", () => {
    const prompt = buildAssetPromptText({
      canonicalDescription: null,
      assetDescription: "smile",
      variantOrPrompt: "smile",
      assetType: "expressions",
    })
    expect(prompt).not.toContain("undefined")
    expect(prompt).not.toContain("null")
  })

  it("inserts the assetType framing fragment for poses", () => {
    const prompt = buildAssetPromptText({
      canonicalDescription: "Kira",
      assetDescription: "walking confidently",
      variantOrPrompt: "walking",
      assetType: "poses",
    })
    expect(prompt).toContain("full body visible including feet")
  })

  it("defaults full-body assets to clothed (the 'full body' framing renders nude/underwear otherwise)", () => {
    // poses/bodyAngles/lighting demand a full body; without a clothed default the
    // model dresses it in underwear or nothing. The still scaffolding fixes it.
    expect(ASSET_STILL_SCAFFOLDING).toMatch(/clothed/i)
    const prompt = buildAssetPromptText({
      canonicalDescription: "Kira",
      assetDescription: "standing",
      variantOrPrompt: "front",
      assetType: "poses",
    })
    expect(prompt).toMatch(/clothed/i)
  })

  it("omits framing for unknown assetType (e.g. custom)", () => {
    const prompt = buildAssetPromptText({
      canonicalDescription: "Kira",
      assetDescription: "warm smile",
      variantOrPrompt: "smile",
      assetType: "custom",
    })
    expect(prompt).not.toContain("portrait headshot")
    expect(prompt).not.toContain("full body")
  })

  it("strips trailing periods from fragments so the output has no double-periods", () => {
    const prompt = buildAssetPromptText({
      canonicalDescription: "Kira: late 20s.",
      assetDescription: "warm smile.",
      variantOrPrompt: "smile",
      assetType: "expressions",
    })
    expect(prompt).not.toMatch(/\.\s*\./)
  })

  it("uses motion scaffolding for motions and includes motionDescription when provided", () => {
    const prompt = buildMotionPromptText({
      canonicalDescription: "Kira: …",
      assetDescription: "walking confidently forward",
      motionDescription: "smooth stride, head held high, eyes forward",
      variantOrPrompt: "walking",
    })
    expect(prompt).toContain("walking confidently forward")
    expect(prompt).toContain("smooth stride")
    expect(prompt).toContain(ASSET_MOTION_SCAFFOLDING)
  })

  it("strips trailing periods from motion fragments", () => {
    const prompt = buildMotionPromptText({
      canonicalDescription: "Kira.",
      assetDescription: "walking.",
      motionDescription: "smooth stride.",
      variantOrPrompt: "walking",
    })
    expect(prompt).not.toMatch(/\.\s*\./)
  })
})

// ---------------------------------------------------------------------------
// W1-a minor-age floor — adult byte-identity pins.
//
// Task 7 turns the two scaffolding constants into functions of the subject's
// age. These two pins hold the ADULT output to the exact string the pre-change
// code produced, so "adults are byte-identical" is asserted, not assumed.
// ---------------------------------------------------------------------------
describe("adult byte-identity pins (pre-change output)", () => {
  it("portrait: seed + person hints + the adult scaffolding, verbatim", () => {
    expect(
      buildPortraitPrompt({ seedPrompt: "a woman in a red coat", person: { age: "age-30s", bust: "bust-full" } }),
    ).toBe(`a woman in a red coat, in their 30s, full bust. ${PORTRAIT_SCAFFOLDING}.`)
  })

  it("asset still: canonical + description + variant + framing + the adult scaffolding, verbatim", () => {
    expect(
      buildAssetPromptText({
        canonicalDescription: "Kira",
        assetDescription: "standing",
        variantOrPrompt: "front",
        assetType: "poses",
      }),
    ).toBe(`Kira. standing. front. full body visible including feet. ${ASSET_STILL_SCAFFOLDING}.`)
  })
})

// ---------------------------------------------------------------------------
// W1-a minor-age floor — the scaffolding is a function of the subject's age.
// ---------------------------------------------------------------------------
describe("scaffolding as a function of the age (W1-a)", () => {
  it("the adult branch is the pre-change scaffolding TEXT, verbatim", () => {
    // Literal, not `toBe(PORTRAIT_SCAFFOLDING)` — comparing the function to the
    // constant it now defines is a tautology and would pass even if both drifted.
    expect(portraitScaffolding(false)).toBe(
      "4k portrait, plain background, studio lighting, neutral expression unless described otherwise, fully clothed in simple everyday attire unless the outfit is otherwise described, no text, no labels, no watermarks",
    )
    expect(assetStillScaffolding(false)).toBe(
      "The subject must remain exactly the same person — preserve facial identity, bone structure, eye color, hair color, skin tone, proportions, and unique features. Do not alter eyes, nose, mouth, or facial shape. Maintain natural skin texture. Ultra-detailed, 8K quality, cinematic framing, plain background, fully clothed in simple everyday attire unless the outfit is otherwise described, no text, no labels, no watermarks",
    )
    // …and the exported constants are still exactly those adult strings.
    expect(PORTRAIT_SCAFFOLDING).toBe(portraitScaffolding(false))
    expect(ASSET_STILL_SCAFFOLDING).toBe(assetStillScaffolding(false))
    expect(PORTRAIT_SCAFFOLDING).toContain(CLOTHED_DEFAULT)
    expect(ASSET_STILL_SCAFFOLDING).toContain(CLOTHED_DEFAULT)
  })

  it("minor portrait: the modest clause replaces the self-disabling default, and Layer 1 already dropped the flagged hint", () => {
    const p = buildPortraitPrompt({
      seedPrompt: "a child in a red coat",
      person: { age: "age-child", bust: "bust-full" },
      subjectMinor: true,
    })
    expect(p).not.toContain(CLOTHED_DEFAULT)
    expect(countOf(p, MODEST_ATTIRE_CLAUSE)).toBe(1)
    expect(p).not.toMatch(/full bust/)
  })

  it("minor asset still: the modest clause replaces the self-disabling default", () => {
    const p = buildAssetPromptText({
      canonicalDescription: "Kira",
      assetDescription: "standing",
      variantOrPrompt: "front",
      assetType: "poses",
      subjectMinor: true,
    })
    expect(p).not.toContain(CLOTHED_DEFAULT)
    expect(countOf(p, MODEST_ATTIRE_CLAUSE)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// The route -> worker chain for a minor. The client assembles `seedPrompt`
// as FREE TEXT, so a flagged phrase can arrive there with no picker value to
// filter (the 2026-07-30 incident). Assembly (here) + the Layer-2 policy (the
// entity handler) together must strip it and leave exactly one modest clause
// -- the modest clause's own internal comma must survive the policy's
// clause-splitting untouched, or the handler would append a second copy.
// ---------------------------------------------------------------------------
describe("route -> worker chain: a flagged fragment inside seedPrompt only (W1-a)", () => {
  afterEach(() => clearPromptPolicies())

  it("strips the flagged free text and carries the modest clause exactly once", () => {
    const flagged = getAdultOnlyHintStrings()[0]
    expect(typeof flagged).toBe("string")

    const assembled = buildPortraitPrompt({
      seedPrompt: `a child in a red coat, ${flagged}`,
      person: { age: "age-child" },
      subjectMinor: true,
    })

    registerMainlinePromptPolicies()
    const out = applyPromptPolicies({
      prompt: assembled,
      negativePrompt: "",
      kind: "image",
      subjectMinor: true,
    }).prompt

    expect(out.toLowerCase()).not.toContain(flagged.toLowerCase())
    expect(out).not.toContain(CLOTHED_DEFAULT)
    expect(countOf(out, MODEST_ATTIRE_CLAUSE)).toBe(1)
    // The subject survived the repair -- the floor must not erase the person.
    expect(out).toContain("a child in a red coat")
  })

  it("is idempotent: a second pass over the policed prompt changes nothing", () => {
    const assembled = buildPortraitPrompt({
      seedPrompt: `a child in a red coat, ${getAdultOnlyHintStrings()[0]}`,
      person: { age: "age-child" },
      subjectMinor: true,
    })
    registerMainlinePromptPolicies()
    const once = applyPromptPolicies({ prompt: assembled, negativePrompt: "", kind: "image", subjectMinor: true }).prompt
    const twice = applyPromptPolicies({ prompt: once, negativePrompt: "", kind: "image", subjectMinor: true }).prompt
    expect(twice).toBe(once)
  })
})
