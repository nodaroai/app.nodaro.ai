import { describe, it, expect } from "vitest"
import { resolveVideoReferenceCore, REF_BINDING, resolveReferenceTokens } from "../video-reference-resolver.js"
import type { ConnectedReference } from "../types.js"

const charRef = (over: Partial<ConnectedReference>): ConnectedReference => ({
  id: "n1", defaultName: "Kira", source: "wired-character", url: "https://r2/kira.png",
  characterSlug: "kira", variantSlug: undefined, characterCanonicalDescription: null,
  variantDescription: null, variantDisplayName: "canonical", ...over,
})

describe("resolveVideoReferenceCore — character canonical fallback", () => {
  // NOTE: the brief's draft asserted `toContain("Image 1")` here, but that is
  // wrong for the DEFAULT "identical" usage mode: the canonical fallback emits a
  // name-based bullet (`- Kira. <directive>`), never `Image N` numbering (only
  // "name"/"none" modes or extras are positionally numbered). This lift-and-shift
  // is behavior-preserving, so the assertion is corrected to the directive the
  // resolver actually emits — identical to the backend mirror test
  // (`payload-builder-video-mentions.test.ts`: "falls back to canonical URL when
  // character is wired but not @-mentioned"). The `Image N` numbering path is
  // still covered by the manual-extras test below.
  it("emits a 'Use these characters' block with the identity directive for an unmentioned wired character", () => {
    const out = resolveVideoReferenceCore({
      prompt: "a woman dancing",
      wiredCharRefs: [charRef({})],
    })
    expect(out.prompt).toContain("Use these characters:")
    expect(out.prompt).toContain("The subject must remain exactly the same person")
    expect(out.additionalUrls).toEqual(["https://r2/kira.png"])
  })
})

describe("resolveVideoReferenceCore — manual extras", () => {
  it("numbers a manual extra after the characters and emits its bullet", () => {
    const out = resolveVideoReferenceCore({
      prompt: "scene",
      wiredCharRefs: [charRef({})],
      extraRefs: [{ url: "https://r2/x.png", description: "a red car" }],
    })
    expect(out.additionalUrls).toEqual(["https://r2/kira.png", "https://r2/x.png"])
    expect(out.prompt).toContain("@image_2 (reference): a red car")
  })
})

// FE/BE PARITY GOLDEN CASES (Phase 1, Task 1.4).
//
// The frontend (`video-prompt-assembly.ts`) and backend (`payload-builder.ts`)
// video-reference resolvers now BOTH delegate to `resolveVideoReferenceCore`,
// so they cannot diverge by construction. These three cases pin the behaviors
// that previously lived duplicated across both layers: same-character pair-back,
// `referenceOrder` reorder + `@image_N` renumber, and the `usageMode: "none"`
// "URL attached, no bullet" contract. Each expected string was derived by
// reading the core's loops (and the `applyReferenceOrderToVideo` →
// `buildTileIdForUrl` tile-id scheme in prompt-builder.ts) and cross-checked
// against the backend mirror suite (`payload-builder-video-mentions.test.ts`).
describe("resolveVideoReferenceCore — FE/BE parity golden cases", () => {
  // Case 1 — pair-back. A wired character (canonical Kira at Image 1, default
  // "identical" mode) plus a SAME-character extra (`characterSlug: "kira"`).
  // The extras loop sees `positionsByChar.get("kira") === 1`, so instead of a
  // fresh identity directive it emits the pair-back bullet "@image_2 is the same
  // subject as @image_1." (no per-ref description → no trailing ", <desc>").
  // Mirrors the backend's "pairs character-sourced extras back…" test, which
  // asserts the byte-identical wording.
  it("pairs a same-character extra back to the canonical character (@image_2 is the same subject as @image_1)", () => {
    const out = resolveVideoReferenceCore({
      prompt: "scene",
      wiredCharRefs: [charRef({})],
      extraRefs: [{ url: "https://r2/kira-extra.png", characterSlug: "kira" }],
    })
    // Canonical Kira first, then the paired-back extra — both URLs attached.
    expect(out.additionalUrls).toEqual([
      "https://r2/kira.png",
      "https://r2/kira-extra.png",
    ])
    // The extra's bullet is the same-subject pair-back, not a fresh directive.
    expect(out.prompt).toContain("- @image_2 is the same subject as @image_1.")
  })

  // Case 2 — referenceOrder reorder + `@image_N` renumber. Two DISTINCT wired
  // characters in "name" mode (the canonical-fallback branch that emits
  // positional `- @image_N (Name)` bullets; the default "identical" mode emits
  // a name-only bullet with NO ordinal, so it can't exercise renumbering).
  // `referenceOrder` keys on the stable tile ids from `buildTileIdForUrl`: an
  // unmentioned wired-character canonical URL → `char-canonical:<slug>`.
  // Reversing the two ids must reverse `additionalUrls` AND renumber the
  // bullets so each `@image_N` tracks its new slot.
  it("applies referenceOrder: reverses additionalUrls AND renumbers the @image_N bullets to follow the new order", () => {
    const kira = charRef({ defaultUsageMode: "name" }) // → "- @image_1 (Kira)", char-canonical:kira
    const mira = charRef({
      id: "n2",
      defaultName: "Mira",
      url: "https://r2/mira.png",
      characterSlug: "mira",
      defaultUsageMode: "name", // → "- @image_2 (Mira)", char-canonical:mira
    })
    const out = resolveVideoReferenceCore({
      prompt: "two people talking",
      wiredCharRefs: [kira, mira],
      // Reverse: Mira's tile first, Kira's second.
      referenceOrder: ["char-canonical:mira", "char-canonical:kira"],
    })
    // URL list reversed to match referenceOrder.
    expect(out.additionalUrls).toEqual([
      "https://r2/mira.png",
      "https://r2/kira.png",
    ])
    // Bullets renumbered to follow the new order: Mira → @image_1, Kira → @image_2.
    expect(out.prompt).toContain("- @image_1 (Mira)")
    expect(out.prompt).toContain("- @image_2 (Kira)")
    // The pre-reorder numbering is gone — proves the renumber pass actually ran
    // (not just an unchanged prompt riding along with reordered URLs).
    expect(out.prompt).not.toContain("- @image_1 (Kira)")
    expect(out.prompt).not.toContain("- @image_2 (Mira)")
  })

  // Case 3 — usageMode "none" extra. A wired Kira (so the slug is known and
  // canonically attached at @image_1) plus a same-character extra with
  // `usageMode: "none"`. The extra's URL IS attached, but the pair-back branch's
  // `effectiveMode !== "none"` guard suppresses any bullet for it — the
  // minimal-intervention contract (image speaks for itself, no textual bias).
  it("attaches a usageMode:'none' extra's URL but emits NO bullet for it", () => {
    const out = resolveVideoReferenceCore({
      prompt: "scene",
      wiredCharRefs: [charRef({})],
      extraRefs: [
        { url: "https://r2/kira-extra.png", characterSlug: "kira", usageMode: "none" },
      ],
    })
    // The extra's URL is still attached to the worker payload.
    expect(out.additionalUrls).toEqual([
      "https://r2/kira.png",
      "https://r2/kira-extra.png",
    ])
    // Exactly one bullet (Kira's canonical) — the "none" extra adds none.
    const bulletLines = (out.prompt ?? "").split("\n").filter((l) => l.startsWith("- "))
    expect(bulletLines).toHaveLength(1)
    // Neither a pair-back ("same subject") nor the extra's positional marker.
    expect(out.prompt).not.toContain("same subject")
    expect(out.prompt).not.toContain("@image_2")
  })
})

// REF_BINDING — the single swap-point for the binding surface-string (D1/D7).
// This is purely additive in Task 2.1: defined + exported + tested here, but NOT
// yet wired into the core's logic (that is Task 2.2). The default form is
// `@image_N`; flipping to the legacy `Image N` form is editing the five arrows
// in `video-reference-resolver.ts` only.
describe("REF_BINDING", () => {
  it("formats subject + ordinal + frame in @image_N form by default", () => {
    expect(REF_BINDING.image("person", 2)).toBe("the person from @image_2")
    expect(REF_BINDING.ordinal(1)).toBe("@image_1")
    expect(REF_BINDING.frame(3, "opening")).toBe("Use @image_3 as the opening (first) frame of the video.")
  })
})

// resolveReferenceTokens — rewrites editor `{image|video|audio:N:label}` tokens
// into `@image_N`-style subject bindings (Task 2.3). Positional, 1-based against
// the corresponding count. Out-of-range / missing count → drop to the bare label
// (legacy `stripVideoImageTokens` strip behavior). Label-less in-range token →
// "the subject in @kind_N" so the binding still lands. Purely additive in 2.3 —
// defined + exported + tested here, NOT yet called by the core (that is Task 2.4).
describe("resolveReferenceTokens", () => {
  const counts = { image: 4, video: 0, audio: 0 }
  it("resolves repeated labels distinctly by slot", () => {
    expect(resolveReferenceTokens(
      "{image:1:person} wearing {image:2:clothes} and {image:3:person} wearing {image:4:clothes}", counts))
      .toBe("the person from @image_1 wearing the clothes from @image_2 and the person from @image_3 wearing the clothes from @image_4")
  })
  it("drops out-of-range tokens to bare label", () => {
    expect(resolveReferenceTokens("a {image:9:ghost} here", counts)).toBe("a ghost here")
  })
  it("handles a label-less token", () => {
    expect(resolveReferenceTokens("{image:1}", counts)).toBe("the subject in @image_1")
  })
  it("resolves video + audio tokens against their own counts", () => {
    expect(resolveReferenceTokens("dance like {video:1:clip} to {audio:1:song}", { image: 0, video: 1, audio: 1 }))
      .toBe("dance like the clip from @video_1 to the song from @audio_1")
  })
  // The docstring's stated intent is "runs of 2+ SPACES" — horizontal cleanup
  // after a dropped label-less token. The collapse must NOT eat newline block
  // separators (`\n\n` between the "Use these characters:" block and the body),
  // which is exactly the surface this function is applied to once Task 2.4 wires
  // it into the FULLY-ASSEMBLED core prompt. Guards against a regression back to
  // `\s{2,}` (which also matches `\n`).
  it("preserves \\n\\n block separators (collapses horizontal whitespace only)", () => {
    expect(resolveReferenceTokens("Use these characters:\n- Kira.\n\n{image:1:person} runs", { image: 1, video: 0, audio: 0 }))
      .toBe("Use these characters:\n- Kira.\n\nthe person from @image_1 runs")
  })
  it("still collapses the horizontal gap left by a dropped label-less token", () => {
    expect(resolveReferenceTokens("walk past {image:9} slowly", { image: 1, video: 0, audio: 0 }))
      .toBe("walk past slowly")
  })
})

// Task 2.4 — the core resolves the editor's curly `{image:N}` / `{video:N}` /
// `{audio:N}` body tokens into `@image_N`-style subject bindings via
// resolveReferenceTokens, applied LAST (after mention/canonical/extras assembly
// AND after the optional `referenceOrder` reorder, so the reorder's `@image_N`
// renumber never touches a freshly-resolved body token). The positional counts
// come from the caller-declared reference-handle totals (`imageRefCount` /
// `videoRefCount` / `audioRefCount`); image falls back to the core's own merged
// URL count when the caller hasn't wired it through yet (pre-Tasks 3.2/4.1).
describe("resolveVideoReferenceCore — {image:N} body-token resolution (Task 2.4)", () => {
  it("resolves {image:N} subject tokens in the body against the reference count", () => {
    const out = resolveVideoReferenceCore({
      prompt: "camera circles {image:1:person} for a 360 spin",
      wiredCharRefs: [charRef({})],
      imageRefCount: 1,
    })
    expect(out.prompt).toContain("camera circles the person from @image_1 for a 360 spin")
  })

  it("resolves {image:N} on the early-return path (no wired chars, no extras) using imageRefCount", () => {
    const out = resolveVideoReferenceCore({
      prompt: "a slow dolly toward {image:1:object} on the table",
      wiredCharRefs: [],
      imageRefCount: 1,
    })
    // Early return (no chars, no extras) — the whole prompt is the resolved body.
    expect(out.prompt).toBe("a slow dolly toward the object from @image_1 on the table")
    expect(out.additionalUrls).toEqual([])
  })

  it("preserves the canonical block's \\n\\n separator while resolving the body token (no \\s-collapse regression)", () => {
    const out = resolveVideoReferenceCore({
      prompt: "circle {image:1:person}",
      wiredCharRefs: [charRef({})],
      imageRefCount: 1,
    })
    // The block + body stay separated by the blank line; only the curly token
    // changed. Proves the assembled `\n\n` survives the token-resolution pass.
    expect(out.prompt).toContain("\n\ncircle the person from @image_1")
  })
})
