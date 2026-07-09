// End-to-end coverage for the "ref-only" reference role: a mention or node
// default of `ref-only` injects ONLY the bare reference pointer — `reference
// image A` on image nodes, `@image_1` on video nodes — with no "the {role}
// from …" wrapper. Character is preset-gated (ref-only must be a curated
// preset); location honors the token role verbatim. Both route through the one
// `roleToPhrase` chokepoint.
import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import { resolveVideoReferenceCore } from "../video-reference-resolver.js"
import type { ConnectedReference } from "@nodaro/shared"

const kira = (over: Partial<ConnectedReference> = {}): ConnectedReference => ({
  id: "k", defaultName: "Kira", source: "wired-character", url: "u-kira", characterSlug: "kira", ...over,
})
const library: ConnectedReference = {
  id: "l", defaultName: "Old Library", source: "wired-location",
  url: "https://cdn/library.png", locationSlug: "old-library",
}

describe("ref-only character (image)", () => {
  it("mention '@kira:1:ref-only' → bare 'reference image A'", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro", prompt: "@kira:1:ref-only in the rain",
      connectedReferences: [kira()], referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("reference image A in the rain")
    expect(out.prompt).not.toContain("the person from reference image A")
  })
  it("node defaultRole 'ref-only' (unmentioned canonical) → no 'the person from …'", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro", prompt: "a portrait",
      connectedReferences: [kira({ defaultRole: "ref-only" })], referenceFormat: "hybrid",
    })
    expect(out.prompt).not.toContain("the person from reference image A")
  })
})

describe("ref-only character (video)", () => {
  it("mention '@kira:1:ref-only' → bare '@image_1'", () => {
    const out = resolveVideoReferenceCore({
      prompt: "@kira:1:ref-only walks in", wiredCharRefs: [kira()], hybridRoles: true,
    })
    expect(out.prompt).toContain("@image_1 walks in")
    expect(out.prompt).not.toContain("the person from @image_1")
  })
  it("node defaultRole 'ref-only' (unmentioned canonical) → no 'the person from @image_1'", () => {
    const out = resolveVideoReferenceCore({
      prompt: "a slow dolly", wiredCharRefs: [kira({ defaultRole: "ref-only" })], hybridRoles: true,
    })
    expect(out.prompt).not.toContain("the person from @image_1")
  })
})

describe("ref-only location (image)", () => {
  it("mention '@old-library:1:ref-only' → bare 'reference image A'", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro", prompt: "@old-library:1:ref-only at night",
      connectedReferences: [library], referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("reference image A at night")
    expect(out.prompt).not.toContain("the background from reference image A")
  })
})
