/**
 * Described references, per-use `descriptionOverride` and the video/audio rail
 * CAPTIONS, on the VIDEO lane, in BOTH reference formats.
 *
 * The video core has THREE ways out — the "no wired characters and no extras"
 * early return (the described-only case: a story landing before any entity
 * exists), the reorder return and the plain return — so the join is pinned on
 * each. Phrasing itself comes from `described-references.ts`; there is no second
 * spelling here.
 */

import { describe, it, expect } from "vitest"
import type { ConnectedReference } from "@nodaro/shared"
import { resolveVideoReferenceCore } from "../video-reference-resolver.js"

const charRef = (over: Partial<ConnectedReference> = {}): ConnectedReference => ({
  id: "n1",
  defaultName: "Kira",
  source: "wired-character",
  url: "https://r2/kira.png",
  characterSlug: "kira",
  characterCanonicalDescription: "a woman with short black hair",
  ...over,
})

const described = [{ name: "Natalie", description: "a tall woman in a red coat" }]

describe("video core — described references with nothing wired", () => {
  it("bullets them into a legacy block", () => {
    const out = resolveVideoReferenceCore({
      prompt: "Natalie walks down the pier.",
      wiredCharRefs: [],
      describedReferences: described,
    })
    expect(out.prompt).toBe(
      "Use these characters:\n- Natalie — a tall woman in a red coat.\n\nNatalie walks down the pier.",
    )
    expect(out.additionalUrls).toEqual([])
  })

  it("appends them as hybrid trailing directives", () => {
    const out = resolveVideoReferenceCore({
      prompt: "Natalie walks down the pier.",
      wiredCharRefs: [],
      describedReferences: described,
      hybridRoles: true,
    })
    expect(out.prompt).toBe(
      "Natalie walks down the pier.\nNatalie — a tall woman in a red coat.",
    )
  })

  it("still returns an undefined prompt when there is nothing at all to say", () => {
    const out = resolveVideoReferenceCore({ prompt: undefined, wiredCharRefs: [] })
    expect(out.prompt).toBeUndefined()
  })
})

describe("video core — described references alongside a wired character", () => {
  it("consolidates into the one legacy character block", () => {
    const out = resolveVideoReferenceCore({
      prompt: "Kira meets Natalie.",
      wiredCharRefs: [charRef()],
      describedReferences: described,
    })
    expect(out.prompt).toContain("Use these characters:\n- Kira — a woman with short black hair.")
    expect(out.prompt).toContain("- Natalie — a tall woman in a red coat.")
    // ONE block, not two.
    expect(out.prompt?.match(/Use these characters:/g)).toHaveLength(1)
  })

  it("lands after the hybrid role phrases", () => {
    const out = resolveVideoReferenceCore({
      prompt: "Kira meets Natalie.",
      wiredCharRefs: [charRef()],
      describedReferences: described,
      hybridRoles: true,
    })
    expect(out.prompt).toBe(
      "Kira meets Natalie.\n"
        + "the person from @image_1\n"
        + "Natalie — a tall woman in a red coat.",
    )
  })

  it("rides the reorder exit unrenumbered — it carries no @image_N binding", () => {
    const wiredCharRefs = [
      charRef(),
      charRef({
        id: "n2",
        defaultName: "Milo",
        url: "https://r2/milo.png",
        characterSlug: "milo",
        characterCanonicalDescription: "a boy with a red scarf",
      }),
    ]
    const out = resolveVideoReferenceCore({
      prompt: "Kira and Milo meet Natalie.",
      wiredCharRefs,
      describedReferences: described,
      hybridRoles: true,
      // Swap the two canonical seats — the tile ids the reorder matches on.
      referenceOrder: ["char-canonical:milo", "char-canonical:kira"],
    })
    // Non-vacuous: the reorder branch really ran (assets swapped) and its
    // `@image_N` renumber pass rewrote both role phrases…
    expect(out.additionalUrls).toEqual(["https://r2/milo.png", "https://r2/kira.png"])
    expect(out.prompt).toBe(
      "Kira and Milo meet Natalie.\n"
        + "the person from @image_2\n"
        + "the person from @image_1\n"
        // …while the described line, which binds no seat, is byte-identical to
        // the un-reordered run's.
        + "Natalie — a tall woman in a red coat.",
    )
  })
})

describe("video core — rail captions", () => {
  it("renders index-aligned video and audio captions in legacy", () => {
    const out = resolveVideoReferenceCore({
      prompt: "A cut between two shots.",
      wiredCharRefs: [],
      videoRefCount: 2,
      audioRefCount: 1,
      videoCaptions: ["the establishing drone shot", "the close-up"],
      audioCaptions: ["the score"],
    })
    expect(out.prompt).toBe(
      "Use these characters:\n"
        + "- @video_1: the establishing drone shot.\n"
        + "- @video_2: the close-up.\n"
        + "- @audio_1: the score.\n\n"
        + "A cut between two shots.",
    )
  })

  it("never binds a caption to a rail slot the payload does not ship", () => {
    const out = resolveVideoReferenceCore({
      prompt: "A single shot.",
      wiredCharRefs: [],
      videoRefCount: 1,
      videoCaptions: ["the establishing drone shot", "dropped by the provider cap"],
      hybridRoles: true,
    })
    expect(out.prompt).toBe(
      "A single shot.\n@video_1: the establishing drone shot.",
    )
  })

  it("reaches the main path too, alongside a wired character", () => {
    const out = resolveVideoReferenceCore({
      prompt: "Kira reacts.",
      wiredCharRefs: [charRef()],
      videoRefCount: 1,
      videoCaptions: ["the establishing drone shot"],
      hybridRoles: true,
    })
    expect(out.prompt).toContain("@video_1: the establishing drone shot.")
  })
})

describe("video core — descriptionOverride", () => {
  const overridden = charRef({ descriptionOverride: "a woman with a shaved head and a scar" })

  it("replaces the canonical description on the legacy canonical fallback", () => {
    const out = resolveVideoReferenceCore({
      prompt: "Kira walks.",
      wiredCharRefs: [overridden],
    })
    expect(out.prompt).toContain("- Kira — a woman with a shaved head and a scar.")
    expect(out.prompt).not.toContain("short black hair")
  })

  it("is honored in a mode that suppresses the canonical description", () => {
    const out = resolveVideoReferenceCore({
      prompt: "Kira walks.",
      wiredCharRefs: [charRef({ ...overridden, defaultUsageMode: "emotion" })],
    })
    expect(out.prompt).toContain("- Kira — a woman with a shaved head and a scar.")
  })

  it("adds one binding-subject line on the hybrid canonical fallback", () => {
    const out = resolveVideoReferenceCore({
      prompt: "Kira walks.",
      wiredCharRefs: [overridden],
      hybridRoles: true,
    })
    expect(out.prompt).toBe(
      "Kira walks.\n"
        + "the person from @image_1\n"
        + "@image_1 — a woman with a shaved head and a scar.",
    )
  })

  it("adds one binding-subject line on a hybrid @-mention", () => {
    const out = resolveVideoReferenceCore({
      prompt: "@kira:1 walks.",
      wiredCharRefs: [overridden],
      hybridRoles: true,
    })
    expect(out.prompt).toBe(
      "the person from @image_1 walks.\n@image_1 — a woman with a shaved head and a scar.",
    )
  })

  it("replaces the canonical description on the legacy @-mention bullet", () => {
    const out = resolveVideoReferenceCore({
      prompt: "@kira:1 walks.",
      wiredCharRefs: [overridden],
    })
    // The shared `resolveCharacterMentions` bullet — `Image N (Name)` subject,
    // not the canonical fallback's bare name (pinned above).
    expect(out.prompt).toContain("- Image 1 (Kira) — a woman with a shaved head and a scar.")
    expect(out.prompt).not.toContain("short black hair")
  })

  it("fills an extra-ref's own description slot", () => {
    const out = resolveVideoReferenceCore({
      prompt: "A still life.",
      wiredCharRefs: [],
      extraRefs: [
        {
          url: "https://r2/vase.png",
          description: "a blue vase",
          descriptionOverride: "a cracked terracotta urn",
        },
      ],
    })
    expect(out.prompt).toContain("- @image_1 (reference): a cracked terracotta urn.")
    expect(out.prompt).not.toContain("blue vase")
  })

  it("fills an extra-ref's own description slot in hybrid too", () => {
    const out = resolveVideoReferenceCore({
      prompt: "A still life.",
      wiredCharRefs: [],
      hybridRoles: true,
      extraRefs: [
        {
          url: "https://r2/vase.png",
          description: "a blue vase",
          descriptionOverride: "a cracked terracotta urn",
        },
      ],
    })
    expect(out.prompt).toBe("A still life.\na cracked terracotta urn (@image_1).")
    expect(out.prompt).not.toContain("blue vase")
  })
})
