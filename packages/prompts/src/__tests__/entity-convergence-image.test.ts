import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import type { ConnectedReference } from "@nodaro/shared"

/**
 * Wired-entity mentions — `@<name-slug>:<index>[:<role>]` for `wired-creature`
 * and `wired-object`.
 *
 * The entity analog of `image-convergence-image.test.ts`, plus the two things
 * only this leg has: FALLBACK SUPPRESSION (a mentioned entity must not ALSO emit
 * its trailing canonical phrase — the live bug) and CROSS-KIND PRECEDENCE
 * (character → location → image → creature → object).
 *
 * `referenceFormat` is passed EXPLICITLY on every hybrid case: `packages/prompts`
 * is env-free (`content-free-contract.test.ts`), so `NODE_ENV=test` only steers
 * the *callers*, never this package.
 */

const nessie: ConnectedReference = {
  id: "cr1", defaultName: "Nessie", source: "wired-creature", url: "https://cdn/nessie.png",
}
const chair: ConnectedReference = {
  id: "ob1", defaultName: "Chair", source: "wired-object", url: "https://cdn/chair.png",
}
const kira: ConnectedReference = {
  id: "c1", defaultName: "Kira", source: "wired-character",
  url: "https://cdn/kira.png", characterSlug: "kira",
}
const library: ConnectedReference = {
  id: "l1", defaultName: "Old Library", source: "wired-location",
  url: "https://cdn/library.png", locationSlug: "old-library",
}
const town: ConnectedReference = {
  id: "n1", defaultName: "Town", source: "wired-image", url: "https://cdn/town.png",
}

/** Count non-overlapping occurrences — the double-render detector. */
const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1

describe("wired-entity mentions resolve on the image hybrid path", () => {
  it("bare @nessie:4 → the SOURCE-default creature phrase, inline, token consumed", () => {
    const out = buildImagePrompt({
      prompt: "a wide shot of @nessie:4 rising from the lake",
      connectedReferences: [nessie],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the creature from reference image A")
    expect(out.prompt).not.toContain("@nessie")
    expect(out.referenceImageUrls).toEqual(["https://cdn/nessie.png"])
  })

  it("the phrase renders where the user TYPED it, not appended after the scene", () => {
    const out = buildImagePrompt({
      prompt: "a wide shot of @nessie:4 rising from the lake",
      connectedReferences: [nessie],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    // The whole point: bound INSIDE the sentence, so "rising from the lake"
    // still attaches to the reference rather than to a bare name.
    expect(out.prompt).toContain("the creature from reference image A rising from the lake")
  })

  it("SUPPRESSES the trailing canonical fallback for the mentioned ref (the live bug)", () => {
    const out = buildImagePrompt({
      prompt: "a wide shot of @nessie:4 rising from the lake",
      connectedReferences: [nessie],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    // Before this leg the same ref rendered TWICE: the name as plain prose in
    // the body, plus a dangling trailing phrase after the style hints.
    expect(occurrences(out.prompt, "the creature from reference image A")).toBe(1)
  })

  it("@nessie:4:markings → the curated creature role", () => {
    const out = buildImagePrompt({
      prompt: "a close shot of @nessie:4:markings",
      connectedReferences: [nessie],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the markings from reference image A")
    expect(occurrences(out.prompt, "reference image A")).toBe(1)
  })

  it("@chair:2:material → the curated OBJECT role, fallback suppressed", () => {
    const out = buildImagePrompt({
      prompt: "a still life of @chair:2:material",
      connectedReferences: [chair],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the material from reference image A")
    expect(out.prompt).not.toContain("the object from reference image A")
  })

  it("a CUSTOM role passes through verbatim", () => {
    const out = buildImagePrompt({
      prompt: "a close shot of @nessie:4:dorsal-fin",
      connectedReferences: [nessie],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the dorsal-fin from reference image A")
  })

  it("the node's own defaultRole is the fallback when the token carries none", () => {
    const out = buildImagePrompt({
      prompt: "a close shot of @nessie:4",
      connectedReferences: [{ ...nessie, defaultRole: "anatomy" } as ConnectedReference],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the anatomy from reference image A")
    expect(out.prompt).not.toContain("the creature from reference image A")
  })

  it("a token role BEATS the node's defaultRole", () => {
    const out = buildImagePrompt({
      prompt: "a close shot of @nessie:4:pose",
      connectedReferences: [{ ...nessie, defaultRole: "anatomy" } as ConnectedReference],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the pose from reference image A")
    expect(out.prompt).not.toContain("the anatomy from")
  })

  it("mentions ONE of two wired entities — the other keeps its trailing canonical", () => {
    const out = buildImagePrompt({
      prompt: "@nessie:1 looms over the room",
      connectedReferences: [nessie, chair],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the creature from reference image A looms over the room")
    // The unmentioned chair still auto-attaches with its trailing phrase — the
    // pre-mention behavior, untouched.
    expect(out.prompt).toContain("the object from reference image B")
    expect(occurrences(out.prompt, "the creature from reference image A")).toBe(1)
  })

  it("two mentions of the SAME entity render twice inline but attach ONE URL", () => {
    const out = buildImagePrompt({
      prompt: "@nessie:1 circles, then @nessie:1 dives",
      connectedReferences: [nessie],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(occurrences(out.prompt, "the creature from reference image A")).toBe(2)
    expect(out.referenceImageUrls).toEqual(["https://cdn/nessie.png"])
  })

  it("a mention whose slug matches NO wired entity stays literal text", () => {
    const out = buildImagePrompt({
      prompt: "a shot of @dragon:1 over the lake",
      connectedReferences: [nessie],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("@dragon:1")
    // Nessie was never mentioned, so it keeps its canonical trailing phrase.
    expect(out.prompt).toContain("the creature from reference image A")
  })
})

describe("wired-entity mention locks and element injections", () => {
  it("~lock forces the creature's identity lock ON, emitted ONCE", () => {
    const locked = buildImagePrompt({
      prompt: "@nessie:1 rises",
      connectedReferences: [nessie],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    const forced = buildImagePrompt({
      prompt: "@nessie:1~lock rises",
      connectedReferences: [nessie],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    // `wired-creature` lock wording is OFF by default, so the sentinel is the
    // only difference between these two prompts.
    expect(forced.prompt.length).toBeGreaterThan(locked.prompt.length)
    expect(forced.prompt).not.toContain("~lock")
    expect(forced.prompt).toContain("reference image A")
  })

  it("carries the ref's elementInjection ONCE — not once inline and once canonical", () => {
    const inject = "keep the bioluminescent spines visible"
    const out = buildImagePrompt({
      prompt: "@nessie:1 rises",
      connectedReferences: [{ ...nessie, elementInjection: inject } as ConnectedReference],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(occurrences(out.prompt, inject)).toBe(1)
  })
})

describe("cross-kind precedence: character → location → image → creature → object", () => {
  it("a slug known to a CHARACTER and a CREATURE resolves as the CHARACTER", () => {
    const twin: ConnectedReference = {
      id: "cr2", defaultName: "Kira", source: "wired-creature", url: "https://cdn/kira-creature.png",
    }
    const out = buildImagePrompt({
      prompt: "@kira:1 steps forward",
      connectedReferences: [kira, twin],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    // The character pass spliced the token, so the creature pass saw nothing.
    expect(out.prompt).toContain("the person from reference image A")
    expect(out.referenceImageUrls?.[0]).toBe("https://cdn/kira.png")
    // The creature was never mentioned → it keeps its trailing canonical phrase.
    expect(out.prompt).toContain("the creature from reference image B")
  })

  it("a slug known to a LOCATION and a CREATURE resolves as the LOCATION", () => {
    const twin: ConnectedReference = {
      id: "cr3", defaultName: "Old Library", source: "wired-creature", url: "https://cdn/lib-creature.png",
    }
    const out = buildImagePrompt({
      prompt: "a shot inside @old-library:1",
      connectedReferences: [library, twin],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.referenceImageUrls?.[0]).toBe("https://cdn/library.png")
    expect(out.prompt).not.toContain("@old-library")
  })

  it("a slug known to an IMAGE and a CREATURE resolves as the IMAGE", () => {
    const twin: ConnectedReference = {
      id: "cr4", defaultName: "Town", source: "wired-creature", url: "https://cdn/town-creature.png",
    }
    const out = buildImagePrompt({
      prompt: "a wide shot of @town:1 at dusk",
      connectedReferences: [town, twin],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    // `wired-image`'s default role is "" → the BARE binding, and the image URL
    // is the one that got the mention's slot.
    expect(out.referenceImageUrls?.[0]).toBe("https://cdn/town.png")
    expect(out.prompt).not.toContain("@town")
    // The creature was never mentioned → trailing canonical, at its own letter.
    expect(out.prompt).toContain("the creature from reference image B")
  })

  it("a slug known to a CREATURE and an OBJECT resolves as the CREATURE", () => {
    // The tail of the chain, settled by the creature-first slug → ref map.
    const twinCreature: ConnectedReference = {
      id: "cr5", defaultName: "Totem", source: "wired-creature", url: "https://cdn/totem-creature.png",
    }
    const twinObject: ConnectedReference = {
      id: "ob5", defaultName: "Totem", source: "wired-object", url: "https://cdn/totem-object.png",
    }
    // Object listed FIRST, so ref order cannot be what decides it.
    const out = buildImagePrompt({
      prompt: "@totem:1 stands in the clearing",
      connectedReferences: [twinObject, twinCreature],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the creature from")
    expect(out.prompt).toContain("stands in the clearing")
  })

  it("all five kinds in one prompt each bind their own reference", () => {
    const out = buildImagePrompt({
      prompt: "@kira:1 walks past @old-library:2 toward @town:3 with @nessie:4 and @chair:5",
      connectedReferences: [kira, library, town, nessie, chair],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    for (const t of ["@kira", "@old-library", "@town", "@nessie", "@chair"]) {
      expect(out.prompt).not.toContain(t)
    }
    expect(out.referenceImageUrls).toHaveLength(5)
    // Both entities were mentioned → NO trailing canonical phrases for them.
    expect(occurrences(out.prompt, "the creature from")).toBe(1)
    expect(occurrences(out.prompt, "the object from")).toBe(1)
  })
})

describe("byte-identity guarantees", () => {
  const cases: Array<[string, Parameters<typeof buildImagePrompt>[0]]> = [
    ["mention-free prompt with a wired creature", {
      prompt: "a wide shot of a lake monster at dusk",
      connectedReferences: [nessie],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    }],
    ["mention-free prompt with a wired creature AND object", {
      prompt: "a still life in a dim room",
      connectedReferences: [nessie, chair],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    }],
    ["prompt with an @-token that matches no entity", {
      prompt: "a shot of @dragon:1 over the lake",
      connectedReferences: [nessie],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    }],
    ["no connectedReferences at all", {
      prompt: "a wide shot of a lake at dusk",
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    }],
  ]

  // PINNED OUTPUTS. The entity pass is gated on TOKEN presence, so an
  // unmentioned graph never enters it. These snapshots were VERIFIED against the
  // pre-leg resolver (the entity wiring reverted, the snapshots kept) and matched
  // byte-for-byte, so they are a real regression pin and not a recording of
  // whatever the new code happens to emit. A diff here means the gate leaked.
  it.each(cases)("%s is unchanged", (_name, config) => {
    expect(buildImagePrompt(config).prompt).toMatchSnapshot()
  })

  it("an unmentioned creature still renders its trailing canonical phrase", () => {
    const out = buildImagePrompt({
      prompt: "a wide shot of a lake monster at dusk",
      connectedReferences: [nessie],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the creature from reference image A")
    expect(out.referenceImageUrls).toEqual(["https://cdn/nessie.png"])
  })

  it("LEGACY leaves the token literal and attaches the entity exactly as today", () => {
    const withMention = buildImagePrompt({
      prompt: "a wide shot of @nessie:4 rising",
      connectedReferences: [nessie],
      provider: "nano-banana-pro",
      referenceFormat: "legacy",
    })
    // No hybrid resolver runs under legacy — the token survives as typed.
    expect(withMention.prompt).toContain("@nessie:4")
    expect(withMention.referenceImageUrls).toEqual(["https://cdn/nessie.png"])
  })
})
