/**
 * Described references (`DescribedReference` — a name + a description, no
 * media) and the per-use `descriptionOverride`, on the IMAGE lane, in BOTH
 * reference formats.
 *
 * Contract under test:
 *   - a described reference reaches the model as `<Name> — <description>.` —
 *     bulleted into the legacy "Use these characters:" block, a trailing scene
 *     directive in hybrid — even when the request carries NO connected
 *     references at all (the story-landing case: a cast role nothing is bound
 *     to yet).
 *   - `descriptionOverride` is the reference's identity description for THIS
 *     use: it fills the description slot a legacy bullet (and the hybrid
 *     extras' `, <desc>` clause) already has, winning over the entity's stored
 *     canonical description AND over the ref's own `description`; where hybrid
 *     has no such slot it adds ONE `reference image A — <override>.` line.
 *   - neither field present → byte-identical output.
 */

import { describe, it, expect } from "vitest"
import { getMaxImagePromptChars } from "@nodaro/shared"
import type { ConnectedReference, DescribedReference } from "@nodaro/shared"
import { buildImagePrompt } from "../prompt-builder.js"
import {
  appendReferenceLines,
  referenceDescriptionLine,
  renderDescribedReferenceLines,
  renderReferenceCaptionLines,
} from "../described-references.js"

const PROVIDER = "nano-banana-pro" // in MODELS_WITH_REFERENCE_IMAGE_SUPPORT

const described: DescribedReference[] = [
  { name: "Natalie", description: "a tall woman in a red coat" },
]

describe("renderDescribedReferenceLines", () => {
  it("renders `<Name> — <description>.`", () => {
    expect(renderDescribedReferenceLines(described)).toEqual([
      "Natalie — a tall woman in a red coat.",
    ])
  })

  it("drops an entry missing either half and dedups by name", () => {
    expect(
      renderDescribedReferenceLines([
        { name: "  ", description: "nameless" },
        { name: "Jack", description: "   " },
        { name: "Natalie", description: "a tall woman" },
        { name: "natalie", description: "a second take" },
      ]),
    ).toEqual(["Natalie — a tall woman."])
  })

  it("returns nothing for an absent or empty list", () => {
    expect(renderDescribedReferenceLines(undefined)).toEqual([])
    expect(renderDescribedReferenceLines([])).toEqual([])
  })
})

describe("referenceDescriptionLine", () => {
  it("takes the binding as the subject for a per-use override", () => {
    expect(referenceDescriptionLine("reference image A", "in a red coat")).toBe(
      "reference image A — in a red coat.",
    )
  })

  it("is empty when either half is blank", () => {
    expect(referenceDescriptionLine("reference image A", "  ")).toBe("")
    expect(referenceDescriptionLine("", "in a red coat")).toBe("")
    expect(referenceDescriptionLine("reference image A", undefined)).toBe("")
  })
})

describe("renderReferenceCaptionLines", () => {
  it("renders index-aligned `@video_N:` / `@audio_N:` lines", () => {
    expect(
      renderReferenceCaptionLines(
        ["the establishing drone shot", "the close-up"],
        ["the score"],
        { video: 2, audio: 1 },
      ),
    ).toEqual([
      "@video_1: the establishing drone shot.",
      "@video_2: the close-up.",
      "@audio_1: the score.",
    ])
  })

  it("keeps the alignment when a caption is blank and stops at the shipped count", () => {
    expect(
      renderReferenceCaptionLines(["", "the close-up", "dropped by the cap"], undefined, {
        video: 2,
        audio: 0,
      }),
    ).toEqual(["@video_2: the close-up."])
  })
})

describe("appendReferenceLines", () => {
  it("creates a legacy block ahead of the body", () => {
    expect(appendReferenceLines("A woman walks.", ["Natalie — tall."], "legacy")).toBe(
      "Use these characters:\n- Natalie — tall.\n\nA woman walks.",
    )
  })

  it("consolidates into an existing legacy block", () => {
    const prompt = "Use these characters:\n- Image 1 (Kira) — match exactly.\n\nA woman walks."
    expect(appendReferenceLines(prompt, ["Natalie — tall."], "legacy")).toBe(
      "Use these characters:\n- Image 1 (Kira) — match exactly.\n- Natalie — tall.\n\nA woman walks.",
    )
  })

  it("appends hybrid lines to the body", () => {
    expect(appendReferenceLines("A woman walks.", ["Natalie — tall."], "hybrid")).toBe(
      "A woman walks.\nNatalie — tall.",
    )
  })

  it("returns the prompt untouched with no lines", () => {
    expect(appendReferenceLines("A woman walks.", [], "legacy")).toBe("A woman walks.")
    expect(appendReferenceLines("A woman walks.", [], "hybrid")).toBe("A woman walks.")
  })
})

describe("buildImagePrompt — described references with no connected references", () => {
  it("bullets them into a legacy block", () => {
    const { prompt, referenceImageUrls } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "Natalie walks down the pier.",
      describedReferences: described,
    })
    expect(prompt).toBe(
      "Use these characters:\n- Natalie — a tall woman in a red coat.\n\nNatalie walks down the pier.",
    )
    // A described reference carries no url — nothing to attach.
    expect(referenceImageUrls).toBeUndefined()
  })

  it("appends them as hybrid trailing directives", () => {
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "Natalie walks down the pier.",
      describedReferences: described,
      referenceFormat: "hybrid",
    })
    expect(prompt).toBe("Natalie walks down the pier.\nNatalie — a tall woman in a red coat.")
  })

  it("keeps them inside the body, ahead of the [style] section", () => {
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "Natalie walks down the pier.\n\n[style]:\nsoft dusk light",
      describedReferences: described,
      referenceFormat: "hybrid",
    })
    expect(prompt).toBe(
      "Natalie walks down the pier.\nNatalie — a tall woman in a red coat.\n\n[style]:\nsoft dusk light",
    )
  })

  it("is byte-identical to the same call without the field when the list is empty", () => {
    const base = { provider: PROVIDER, prompt: "Natalie walks down the pier." }
    expect(buildImagePrompt({ ...base, describedReferences: [] }).prompt).toBe(
      buildImagePrompt(base).prompt,
    )
  })

  it("rides the provider prompt cap like any other body text", () => {
    const cap = getMaxImagePromptChars(PROVIDER)
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "A woman walks.",
      describedReferences: [{ name: "Natalie", description: "x".repeat(cap + 1000) }],
    })
    expect(prompt.length).toBeLessThanOrEqual(cap)
    expect(prompt.endsWith("...")).toBe(true)
  })
})

describe("buildImagePrompt — described references alongside connected references", () => {
  const kira: ConnectedReference = {
    id: "c1",
    defaultName: "Kira",
    source: "wired-character",
    characterSlug: "kira",
    url: "https://r2/kira.png",
    characterCanonicalDescription: "a woman with short black hair",
  }

  it("consolidates into the one legacy character block", () => {
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "Kira meets Natalie.",
      connectedReferences: [kira],
      describedReferences: described,
    })
    expect(prompt).toBe(
      "Use these characters:\n"
        + "- Image 1 (Kira) — a woman with short black hair. The subject must remain exactly the same person"
        + " — preserve 100% facial identity, bone structure, skin tone, proportions, and all unique features."
        + " Do not alter eyes, nose, mouth, or facial shape. Maintain natural skin texture, including pores"
        + " and imperfections.\n"
        + "- Natalie — a tall woman in a red coat.\n\n"
        + "Kira meets Natalie.",
    )
  })

  it("makes ONE block when the references produce the 'Use these references' wrap", () => {
    // A non-character ref with no wired character takes the legacy PREPEND
    // branch ("Use these references for the output image:… Compose them
    // naturally…"). The described block must be the block that wrap folds
    // into — never a second header stacked above it.
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "A still life with {image:1:vase}.",
      connectedReferences: [
        { id: "o1", defaultName: "Vase", source: "wired-object", url: "https://r2/vase.png", description: "a blue vase" },
      ],
      describedReferences: described,
    })
    expect(prompt.match(/Use these characters:/g)).toHaveLength(1)
    expect(prompt).not.toContain("Use these references for the output image:")
    expect(prompt).toBe(
      "Use these characters:\n"
        + "- Natalie — a tall woman in a red coat.\n"
        + "- Image 1 (vase — a blue vase) — match exactly. Maintain perfect likeness.\n\n"
        + "A still life with Image 1 (vase).",
    )
  })

  it("lands after the hybrid role phrases", () => {
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "Kira meets Natalie.",
      connectedReferences: [kira],
      describedReferences: described,
      referenceFormat: "hybrid",
    })
    expect(prompt).toBe(
      "Kira meets Natalie.\n"
        + "the person from reference image A\n"
        + "Natalie — a tall woman in a red coat.",
    )
  })
})

describe("descriptionOverride — legacy", () => {
  const withOverride: ConnectedReference = {
    id: "c1",
    defaultName: "Kira",
    source: "wired-character",
    characterSlug: "kira",
    url: "https://r2/kira.png",
    characterCanonicalDescription: "a woman with short black hair",
    descriptionOverride: "a woman with a shaved head and a scar",
  }

  it("replaces the canonical description on the canonical fallback", () => {
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "Kira walks.",
      connectedReferences: [withOverride],
    })
    expect(prompt).toContain("- Image 1 (Kira) — a woman with a shaved head and a scar.")
    expect(prompt).not.toContain("short black hair")
  })

  it("replaces the canonical description on an @-mention", () => {
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "@kira:1 walks.",
      connectedReferences: [withOverride],
    })
    expect(prompt).toContain("- Image 1 (Kira) — a woman with a shaved head and a scar.")
    expect(prompt).not.toContain("short black hair")
  })

  it("is honored in a mode that suppresses the canonical description", () => {
    // "emotion" gates the canonical description off — an explicit per-use
    // override is the caller speaking, so it rides every mode that emits a
    // bullet at all.
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "Kira walks.",
      connectedReferences: [{ ...withOverride, defaultUsageMode: "emotion" }],
    })
    expect(prompt).toContain("- Image 1 (Kira) — a woman with a shaved head and a scar.")
  })

  it("emits nothing extra in a mode that emits no bullet", () => {
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "Kira walks.",
      connectedReferences: [{ ...withOverride, defaultUsageMode: "none" }],
    })
    expect(prompt).toBe("Kira walks.")
  })

  it("wins over an extra-ref's own description", () => {
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "A still life.",
      connectedReferences: [
        {
          id: "m1",
          defaultName: "Vase",
          source: "manual",
          url: "https://r2/vase.png",
          isExtraRef: true,
          description: "a blue vase",
          descriptionOverride: "a cracked terracotta urn",
        },
      ],
    })
    expect(prompt).toContain("- Image 1 (reference): a cracked terracotta urn.")
    expect(prompt).not.toContain("blue vase")
  })

  it("wins over a MENTIONED location's canonical description", () => {
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "A wide shot of @old-library:1.",
      connectedReferences: [
        {
          id: "l1",
          defaultName: "Old Library",
          source: "wired-location",
          locationSlug: "old-library",
          url: "https://r2/library.png",
          locationCanonicalDescription: "a dusty reading room",
          descriptionOverride: "a flooded reading room at night",
        },
      ],
    })
    expect(prompt).toContain("- Image 1 (Old Library) — a flooded reading room at night.")
    expect(prompt).not.toContain("dusty reading room")
  })

  it("wins over an UNMENTIONED wired location's canonical description", () => {
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "A wide shot.",
      connectedReferences: [
        {
          id: "l1",
          defaultName: "Old Library",
          source: "wired-location",
          locationSlug: "old-library",
          url: "https://r2/library.png",
          locationCanonicalDescription: "a dusty reading room",
          descriptionOverride: "a flooded reading room at night",
        },
      ],
    })
    expect(prompt).toContain("a flooded reading room at night")
    expect(prompt).not.toContain("dusty reading room")
  })
})

describe("descriptionOverride — hybrid", () => {
  const kira: ConnectedReference = {
    id: "c1",
    defaultName: "Kira",
    source: "wired-character",
    characterSlug: "kira",
    url: "https://r2/kira.png",
    characterCanonicalDescription: "a woman with short black hair",
    descriptionOverride: "a woman with a shaved head and a scar",
  }

  it("adds one binding-subject line for a canonical fallback", () => {
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "Kira walks.",
      connectedReferences: [kira],
      referenceFormat: "hybrid",
    })
    expect(prompt).toBe(
      "Kira walks.\n"
        + "the person from reference image A\n"
        + "reference image A — a woman with a shaved head and a scar.",
    )
  })

  it("adds one binding-subject line for an @-mention", () => {
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "@kira:1 walks.",
      connectedReferences: [kira],
      referenceFormat: "hybrid",
    })
    expect(prompt).toBe(
      "the person from reference image A walks.\n"
        + "reference image A — a woman with a shaved head and a scar.",
    )
  })

  it("adds one binding-subject line for a wired location", () => {
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "A wide shot.",
      connectedReferences: [
        {
          id: "l1",
          defaultName: "Old Library",
          source: "wired-location",
          locationSlug: "old-library",
          url: "https://r2/library.png",
          locationCanonicalDescription: "a dusty reading room",
          descriptionOverride: "a flooded reading room at night",
        },
      ],
      referenceFormat: "hybrid",
    })
    expect(prompt).toContain("reference image A — a flooded reading room at night.")
  })

  it("adds one binding-subject line for a wired object", () => {
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "A still life.",
      connectedReferences: [
        {
          id: "o1",
          defaultName: "Vase",
          source: "wired-object",
          url: "https://r2/vase.png",
          descriptionOverride: "a cracked terracotta urn",
        },
      ],
      referenceFormat: "hybrid",
    })
    expect(prompt).toContain("reference image A — a cracked terracotta urn.")
  })

  it("fills the extras' own description clause instead of adding a line", () => {
    const { prompt } = buildImagePrompt({
      provider: PROVIDER,
      prompt: "A still life.",
      connectedReferences: [
        {
          id: "m1",
          defaultName: "Vase",
          source: "manual",
          url: "https://r2/vase.png",
          isExtraRef: true,
          description: "a blue vase",
          descriptionOverride: "a cracked terracotta urn",
        },
      ],
      referenceFormat: "hybrid",
    })
    expect(prompt).toBe("A still life.\na cracked terracotta urn (reference image A).")
    expect(prompt).not.toContain("blue vase")
  })
})
