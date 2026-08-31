// Location `defaultRole` (the ref-level hybrid role pick) must be honored by
// BOTH image location paths — the @-mention resolver (un-roled token) and the
// canonical fallback (wired, unmentioned) — with the precedence:
//   token role → token mode → ref defaultRole → defaultUsageMode-derived → "location".
//
// `ConnectedReference.defaultRole` is on the wire schema for every source and the
// character / named-image mention paths have always read it (`resolveDefaultRole`);
// the location paths read only the usage mode, so a caller's ref-level role was
// silently dropped. It is the ONLY channel a location has for a custom default
// role — a location mention's 3rd segment is a bucket/variant or a role, so a
// caller cannot pin a per-mention role AND keep the canonical image.
//
// Legacy format ignores `defaultRole` entirely (byte-identical guard).
import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import type { ConnectedReference } from "@nodaro/shared"

const library: ConnectedReference = {
  id: "l", defaultName: "Old Library", source: "wired-location",
  url: "https://cdn/library.png", locationSlug: "old-library",
}

const build = (prompt: string, over: Partial<ConnectedReference> = {}, hybrid = true) =>
  buildImagePrompt({
    provider: "nano-banana-pro",
    prompt,
    connectedReferences: [{ ...library, ...over } as ConnectedReference],
    ...(hybrid ? { referenceFormat: "hybrid" as const } : {}),
  }).prompt

describe("location @-mention honors the ref defaultRole for un-roled tokens", () => {
  it("bare '@old-library:1' with defaultRole 'atmosphere' → 'the atmosphere from reference image A'", () => {
    expect(build("@old-library:1 a chase scene", { defaultRole: "atmosphere" }))
      .toContain("the atmosphere from reference image A")
  })

  it("a Custom defaultRole survives verbatim", () => {
    expect(build("@old-library:1 a chase scene", { defaultRole: "brickwork" }))
      .toContain("the brickwork from reference image A")
  })

  it("a multi-word preset slug is normalized to its phrase key, like a token role", () => {
    expect(build("@old-library:1 a chase scene", { defaultRole: "empty-background" }))
      .toContain("the background from reference image A (without its foreground objects)")
  })

  it("an explicit token ROLE still overrides the ref defaultRole", () => {
    expect(build("@old-library:1:lighting a chase scene", { defaultRole: "atmosphere" }))
      .toContain("the lighting from reference image A")
  })

  it("an explicit token MODE still overrides the ref defaultRole", () => {
    expect(build("@old-library:1:layout a chase scene", { defaultRole: "atmosphere" }))
      .toContain("the layout from reference image A")
  })

  it("defaultRole beats a legacy defaultUsageMode on the same ref", () => {
    expect(build("@old-library:1 a chase scene", { defaultRole: "atmosphere", defaultUsageMode: "style" }))
      .toContain("the atmosphere from reference image A")
  })
})

describe("location canonical fallback honors the ref defaultRole", () => {
  it("unmentioned wired location with defaultRole 'atmosphere' → 'the atmosphere from reference image A'", () => {
    expect(build("a detective at her desk", { defaultRole: "atmosphere" }))
      .toContain("the atmosphere from reference image A")
  })

  // The mention and the canonical paths run ONE role chain, so the same wired
  // location can never phrase itself one way mentioned and another unmentioned.
  it("mentioned and unmentioned agree on the phrase for the same ref", () => {
    const mentioned = build("@old-library:1 a chase scene", { defaultRole: "brickwork" })
    const unmentioned = build("a chase scene", { defaultRole: "brickwork" })
    expect(mentioned).toContain("the brickwork from reference image A")
    expect(unmentioned).toContain("the brickwork from reference image A")
  })
})

describe("NO defaultRole → byte-identical to the pre-change derivation", () => {
  it("bare mention, no ref-level defaults → the source default", () => {
    expect(build("@old-library:1 a chase scene")).toBe(
      "the location from reference image A a chase scene",
    )
  })

  it("bare mention with defaultUsageMode 'style' → the mode-derived role, unchanged", () => {
    expect(build("@old-library:1 a chase scene", { defaultUsageMode: "style" })).toBe(
      "the style from reference image A a chase scene",
    )
  })

  // No mention converged, so the hybrid scene render still capitalizes the
  // line-initial; the canonical phrase is appended after that pass, lowercase.
  it("unmentioned, no ref-level defaults → the source default", () => {
    expect(build("a detective at her desk")).toBe(
      "A detective at her desk\nthe location from reference image A",
    )
  })

  it("unmentioned with defaultUsageMode 'layout' → the mode-derived role, unchanged", () => {
    expect(build("a detective at her desk", { defaultUsageMode: "layout" as never })).toBe(
      "A detective at her desk\nthe layout from reference image A",
    )
  })
})

describe("legacy format ignores defaultRole (byte-identical guard)", () => {
  it("legacy assembly with a defaultRole-carrying location emits no role phrase", () => {
    const out = build("@old-library:1 a chase scene", { defaultRole: "atmosphere" }, false)
    expect(out).not.toContain("the atmosphere from reference image A")
    expect(out).not.toContain("from reference image A")
  })
})
