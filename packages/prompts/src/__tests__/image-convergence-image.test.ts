import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import type { ConnectedReference } from "@nodaro/shared"

/**
 * P3 — named-image mentions `@<name-slug>:<index>[:<role>]`.
 *
 * The image analog of `location-convergence-image.test.ts`. `referenceFormat`
 * is passed EXPLICITLY on every hybrid case: `packages/prompts` is env-free
 * (`content-free-contract.test.ts`), so `NODE_ENV=test` only steers the
 * *callers*, never this package.
 */

const town: ConnectedReference = {
  id: "n1", defaultName: "Town", source: "wired-image", url: "https://cdn/town.png",
}
const plaza: ConnectedReference = {
  id: "n2", defaultName: "Plaza", source: "wired-image", url: "https://cdn/plaza.png",
}
const kira: ConnectedReference = {
  id: "c1", defaultName: "Kira", source: "wired-character",
  url: "https://cdn/kira.png", characterSlug: "kira",
}
const library: ConnectedReference = {
  id: "l1", defaultName: "Old Library", source: "wired-location",
  url: "https://cdn/library.png", locationSlug: "old-library",
}

describe("named-image mentions resolve on the image hybrid path", () => {
  it("bare @town:3 → the reference's bare binding, token consumed, URL attached once", () => {
    const out = buildImagePrompt({
      prompt: "a wide shot of @town:3 at dusk",
      connectedReferences: [town],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    // `wired-image`'s default role is "" (DEFAULT_LABEL_BY_SOURCE) →
    // `roleToPhrase("", binding)` returns the BARE binding.
    expect(out.prompt).toContain("reference image A")
    expect(out.prompt).not.toContain("@town")
    expect(out.referenceImageUrls).toEqual(["https://cdn/town.png"])
  })

  it("@town:3:background → 'the background from reference image A'", () => {
    const out = buildImagePrompt({
      prompt: "a wide shot of @town:3:background at dusk",
      connectedReferences: [town],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the background from reference image A")
    expect(out.prompt).not.toContain("@town")
  })

  it("a CUSTOM role passes through verbatim → 'the signage from reference image A'", () => {
    const out = buildImagePrompt({
      prompt: "a wide shot of @town:3:signage at dusk",
      connectedReferences: [town],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the signage from reference image A")
  })

  it("the node's own defaultRole is the fallback when the token carries none", () => {
    const out = buildImagePrompt({
      prompt: "a wide shot of @town:3 at dusk",
      connectedReferences: [{ ...town, defaultRole: "texture" } as ConnectedReference],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the texture from reference image A")
  })

  it("mixed character + location + image: A = character, B = location, C = image", () => {
    const out = buildImagePrompt({
      prompt: "@kira:1 walks past @old-library:2 toward @town:3:background",
      connectedReferences: [kira, library, town],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    // Mention URLs merge in pass order: characters, then locations, then images.
    expect(out.referenceImageUrls).toEqual([
      "https://cdn/kira.png",
      "https://cdn/library.png",
      "https://cdn/town.png",
    ])
    // The letters are the assertion; the location pass's own default role
    // wording belongs to `location-convergence-image.test.ts`, not here.
    expect(out.prompt).toContain("from reference image A")
    expect(out.prompt).toContain("from reference image B")
    expect(out.prompt).toContain("the background from reference image C")
    expect(out.prompt).not.toContain("@town")
    expect(out.prompt).not.toContain("@kira")
    expect(out.prompt).not.toContain("@old-library")
  })

  it("PRECEDENCE: a character and an image sharing a name resolve as the CHARACTER", () => {
    const townCharacter: ConnectedReference = {
      id: "c2", defaultName: "Town", source: "wired-character",
      url: "https://cdn/town-character.png", characterSlug: "town",
    }
    const out = buildImagePrompt({
      prompt: "@town:1 stands in the square",
      connectedReferences: [townCharacter, town],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    // The character pass splices the token out first, so the image pass finds
    // nothing to bind and the image ref keeps its plain auto-attach slot.
    expect(out.prompt).toContain("the person from reference image A")
    expect(out.referenceImageUrls?.[0]).toBe("https://cdn/town-character.png")
  })

  it("DUPLICATE SLUGS bind FIRST-WINS", () => {
    const first: ConnectedReference = {
      id: "u1", defaultName: "Upload Image", source: "wired-image", url: "https://cdn/first.png",
    }
    const second: ConnectedReference = {
      id: "u2", defaultName: "Upload Image", source: "wired-image", url: "https://cdn/second.png",
    }
    const out = buildImagePrompt({
      prompt: "a shot of @upload-image:1",
      connectedReferences: [first, second],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    // The mention re-seats the FIRST ref, so it takes slot A; the unmentioned
    // second ref still auto-attaches after it.
    expect(out.referenceImageUrls).toEqual(["https://cdn/first.png", "https://cdn/second.png"])
    expect(out.prompt).toContain("reference image A")
  })

  it("~lock forces an identity-lock line; ~nolock suppresses a ref-level one", () => {
    const locked = buildImagePrompt({
      prompt: "a shot of @town:1~lock",
      connectedReferences: [{
        ...town,
        identityLock: { enabled: false, text: "Keep {ref} pixel-exact." },
      } as ConnectedReference],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(locked.prompt).toContain("Keep reference image A pixel-exact.")

    const unlocked = buildImagePrompt({
      prompt: "a shot of @town:1~nolock",
      connectedReferences: [{
        ...town,
        identityLock: { enabled: true, text: "Keep {ref} pixel-exact." },
      } as ConnectedReference],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(unlocked.prompt).not.toContain("pixel-exact")
  })

  it("a `manual` reference is mentionable too", () => {
    const out = buildImagePrompt({
      prompt: "a shot of @moodboard:1:style",
      connectedReferences: [{
        id: "m1", defaultName: "Moodboard", source: "manual", url: "https://cdn/mood.png",
      } as ConnectedReference],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the style from reference image A")
  })

  it("{image:N} and @town:3 coexist — each renders exactly once", () => {
    const out = buildImagePrompt({
      prompt: "put {image:1} beside @plaza:2:background",
      connectedReferences: [town, plaza],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).not.toContain("{image:")
    expect(out.prompt).not.toContain("@plaza")
    // Both URLs attach, each exactly once (the mention does NOT filter its ref
    // out of `connectedReferences`, and the New-path merge dedups by URL).
    expect(out.referenceImageUrls?.filter((u) => u === "https://cdn/town.png")).toHaveLength(1)
    expect(out.referenceImageUrls?.filter((u) => u === "https://cdn/plaza.png")).toHaveLength(1)
    const backgroundPhrases = out.prompt.match(/the background from reference image/g) ?? []
    expect(backgroundPhrases).toHaveLength(1)
  })
})

/**
 * THE GATE-ARM GUARD (program plan §6, Leg C: "must exist or the leg silently
 * no-ops"). An IMAGE-ONLY reference list — no wired character, no location, no
 * extras — is the commonest studio payload, and it is exactly the case that
 * reaches Phase 0 ONLY through the `hasImageMentionTokens` arm added to the
 * `prompt-builder.ts` gate. Delete that arm and this test is the one that fails.
 */
describe("Phase-0 gate arm: image-only references", () => {
  it("image-only refs + one mention → resolves (no character, no location, no extras)", () => {
    const out = buildImagePrompt({
      prompt: "a wide shot of @town:1:background at dusk",
      connectedReferences: [town],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the background from reference image A")
    expect(out.prompt).not.toContain("@town")
  })
})

/**
 * THE BYTE-PARITY GUARD (program plan §6, Leg C, the second mandatory test).
 *
 * The expected values below are FIXTURES CAPTURED FROM THE PRE-CHANGE TREE (the
 * branch point's `prompt-builder.ts`), not re-derived from the function under
 * test — a self-comparison would pin nothing. The gate is TOKEN presence, so a
 * mention-free graph never enters Phase 0 and its output is unchanged BY
 * CONSTRUCTION; these fixtures are what make that claim falsifiable.
 */
describe("mention-free graphs are byte-identical to the pre-change tree", () => {
  it("image-only, no mention", () => {
    const out = buildImagePrompt({
      prompt: "a wide shot of a quiet town square",
      connectedReferences: [town],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toBe("A wide shot of a quiet town square")
    expect(out.referenceImageUrls).toEqual(["https://cdn/town.png"])
  })

  it("two images, no mention", () => {
    const out = buildImagePrompt({
      prompt: "a wide shot of a quiet town square",
      connectedReferences: [town, plaza],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toBe("A wide shot of a quiet town square")
    expect(out.referenceImageUrls).toEqual(["https://cdn/town.png", "https://cdn/plaza.png"])
  })

  it("character mention + an unmentioned image", () => {
    const out = buildImagePrompt({
      prompt: "@kira:1 walks through the square",
      connectedReferences: [kira, town],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toBe("the person from reference image A walks through the square")
    expect(out.referenceImageUrls).toEqual(["https://cdn/kira.png", "https://cdn/town.png"])
  })

  it("a ref whose name slugs to a GRAMMAR-INVALID slug never arms the gate", () => {
    // "3D Render" → "3d-render": non-empty, but a leading digit is unparseable,
    // so `knownImageSlugsFromRefs` drops it and no token can ever match it.
    const out = buildImagePrompt({
      prompt: "a shot of @3d-render:1",
      connectedReferences: [{
        id: "r1", defaultName: "3D Render", source: "wired-image", url: "https://cdn/r.png",
      } as ConnectedReference],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("@3d-render:1")
  })

  it("an isExtraRef media ref is NOT mentionable (it renders through the extras path)", () => {
    const out = buildImagePrompt({
      prompt: "a shot of @town:1:background",
      connectedReferences: [{ ...town, isExtraRef: true } as ConnectedReference],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("@town:1:background")
    expect(out.prompt).not.toContain("the background from reference image")
  })
})

/**
 * CROSS-GRAMMAR: a LOCATION `bucket/variant` token must never be claimed — not
 * even in truncated form — by the image pass. The image pass is the only one of
 * the three that SPLICES its match, so a truncated claim does not merely fail
 * to resolve, it corrupts the model-facing prompt with a dangling `/variant`.
 */
describe("a location bucket/variant token is never claimed by the image pass", () => {
  const oldLibraryImage: ConnectedReference = {
    id: "n3", defaultName: "Old Library", source: "wired-image",
    url: "https://cdn/old-library-photo.png",
  }

  it("images-only graph: the whole token stays literal, no `/rain` left dangling", () => {
    const out = buildImagePrompt({
      prompt: "a shot of @old-library:1:weather/rain",
      connectedReferences: [oldLibraryImage],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("@old-library:1:weather/rain")
    // The corruption this pins shut: the truncated claim spliced
    // `@old-library:1:weather` and left `/rain` welded to the binding phrase.
    expect(out.prompt).not.toContain("reference image A/rain")
    expect(out.prompt).not.toContain("/rain\n")
  })

  it("4-part location token (variant + mode) is left alone too", () => {
    const out = buildImagePrompt({
      prompt: "a shot of @old-library:1:weather/rain:style",
      connectedReferences: [oldLibraryImage],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("@old-library:1:weather/rain:style")
  })

  it("PRECEDENCE: a shared name + an unresolvable variant does not demote the location to slot B", () => {
    // The location pass leaves the token alone (the node carries no
    // `weather/rain` variant); the image pass must not then mangle it, bind the
    // upload to slot A and push the user's actual location image to slot B.
    const out = buildImagePrompt({
      prompt: "a shot of @old-library:1:weather/rain",
      connectedReferences: [library, oldLibraryImage],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("@old-library:1:weather/rain")
    expect(out.referenceImageUrls[0]).toBe("https://cdn/library.png")
  })

  it("a slash BETWEEN two image mentions still resolves both", () => {
    const out = buildImagePrompt({
      prompt: "@town:1/@plaza:2",
      connectedReferences: [town, plaza],
      provider: "nano-banana-pro",
      referenceFormat: "hybrid",
    })
    expect(out.prompt).not.toContain("@town")
    expect(out.prompt).not.toContain("@plaza")
    expect(out.referenceImageUrls).toEqual([
      "https://cdn/town.png",
      "https://cdn/plaza.png",
    ])
  })
})

/**
 * LEGACY (the kill-switch path). `IMAGE_REFERENCE_FORMAT=legacy` reverts the
 * whole leg: there is no legacy image resolver, so a token stays literal text
 * and the reference attaches exactly as it does today.
 */
describe("LEGACY reference format: image mentions stay literal", () => {
  it("@town:3 is left verbatim and the URL still attaches", () => {
    const out = buildImagePrompt({
      prompt: "a wide shot of @town:3 at dusk",
      connectedReferences: [town],
      provider: "nano-banana-pro",
      // no referenceFormat → legacy (the prod default)
    })
    expect(out.prompt).toContain("@town:3")
    expect(out.prompt).not.toContain("reference image A")
    expect(out.referenceImageUrls).toContain("https://cdn/town.png")
  })

  it("@town:3:background is left verbatim too", () => {
    const out = buildImagePrompt({
      prompt: "a wide shot of @town:3:background at dusk",
      connectedReferences: [town],
      provider: "nano-banana-pro",
    })
    expect(out.prompt).toContain("@town:3:background")
    expect(out.prompt).not.toContain("the background from reference image")
  })
})
