// Variant + Role Separation: a mention's VARIANT picks the image, its ROLE
// picks the phrase — independently (`@kira:1:walking:clothes` → the walking
// image attached, "the clothes from …" injected). Covers the character
// resolvers on BOTH bindings (image letters, video @image_N), the location
// image resolver, ref-only composition, and the mode-in-seg4 back-compat.
import { describe, it, expect } from "vitest"
import { buildImagePrompt } from "../prompt-builder.js"
import { resolveVideoReferenceCore } from "../video-reference-resolver.js"
import type { ConnectedReference } from "@nodaro/shared"

const kira = (over: Partial<ConnectedReference> = {}): ConnectedReference => ({
  id: "k", defaultName: "Kira", source: "wired-character", url: "u-kira", characterSlug: "kira", ...over,
})
const kiraWalking = kira({ id: "kw", variantSlug: "walking", url: "u-walk" })

const library: ConnectedReference = {
  id: "l", defaultName: "Old Library", source: "wired-location",
  url: "u-lib", locationSlug: "oldlibrary",
}
const libraryRain: ConnectedReference = {
  ...library, id: "lr", url: "u-rain",
  locationVariantBucket: "weather", locationVariantSlug: "rain",
}

describe("character variant + role (image)", () => {
  it("@kira:1:walking:clothes → walking image attached, 'the clothes from reference image A'", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro", prompt: "@kira:1:walking:clothes in the rain",
      connectedReferences: [kira(), kiraWalking], referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the clothes from reference image A in the rain")
    expect(out.referenceImageUrls).toContain("u-walk")
  })

  it("@kira:1:walking:ref-only → walking image attached, bare 'reference image A'", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro", prompt: "@kira:1:walking:ref-only in the rain",
      connectedReferences: [kira(), kiraWalking], referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("reference image A in the rain")
    expect(out.prompt).not.toContain("from reference image A")
    expect(out.referenceImageUrls).toContain("u-walk")
  })

  it("a CUSTOM 4th-segment role survives verbatim", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro", prompt: "@kira:1:walking:earrings at dawn",
      connectedReferences: [kira(), kiraWalking], referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the earrings from reference image A at dawn")
  })

  it("back-compat: @kira:1:walking:pose (mode in seg4) is unchanged", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro", prompt: "@kira:1:walking:pose at dawn",
      connectedReferences: [kira(), kiraWalking], referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the pose from reference image A at dawn")
    expect(out.referenceImageUrls).toContain("u-walk")
  })
})

describe("character variant + role (video)", () => {
  it("@kira:1:walking:clothes → 'the clothes from @image_1', walking image attached", () => {
    const out = resolveVideoReferenceCore({
      prompt: "@kira:1:walking:clothes walks in",
      wiredCharRefs: [kira(), kiraWalking], hybridRoles: true,
    })
    expect(out.prompt).toContain("the clothes from @image_1 walks in")
    expect(out.additionalUrls).toContain("u-walk")
  })

  it("@kira:1:walking:ref-only → bare '@image_1'", () => {
    const out = resolveVideoReferenceCore({
      prompt: "@kira:1:walking:ref-only walks in",
      wiredCharRefs: [kira(), kiraWalking], hybridRoles: true,
    })
    expect(out.prompt).toContain("@image_1 walks in")
    expect(out.prompt).not.toContain("from @image_1")
  })
})

describe("location variant + role (image)", () => {
  it("@oldlibrary:1:weather/rain:lighting → rain image attached, 'the lighting from reference image A'", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro", prompt: "@oldlibrary:1:weather/rain:lighting a chase",
      connectedReferences: [library, libraryRain], referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the lighting from reference image A a chase")
    expect(out.referenceImageUrls).toContain("u-rain")
  })
})
