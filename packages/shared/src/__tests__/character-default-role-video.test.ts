// packages/shared/src/__tests__/character-default-role-video.test.ts
//
// Character node `defaultRole` + mapped `identityLock` must be honored by ALL
// THREE video resolution paths — canonical fallback, @-mention (un-roled
// token), and extras (first-sight via `CharacterMeta`) — mirroring the image
// side (character-default-role-image.test.ts) so the surfaces stay converged.
import { describe, it, expect } from "vitest"
import { resolveVideoReferenceCore } from "../video-reference-resolver.js"
import { characterLockToRefLock } from "../identity-lock.js"
import { buildImagePrompt } from "../prompt-builder.js"
import type { ConnectedReference } from "../types.js"

const kira = (over: Partial<ConnectedReference> = {}): ConnectedReference => ({
  id: "k", defaultName: "Kira", source: "wired-character", url: "u-kira", characterSlug: "kira", ...over,
})

describe("video canonical fallback honors the node defaultRole", () => {
  it("unmentioned wired character with defaultRole 'clothes' → 'the clothes from @image_1'", () => {
    const out = resolveVideoReferenceCore({
      prompt: "a slow dolly", wiredCharRefs: [kira({ defaultRole: "clothes" })], hybridRoles: true,
    })
    expect(out.prompt).toContain("the clothes from @image_1")
    expect(out.prompt).not.toContain("the person from @image_1")
  })

  it("unmentioned wired character with defaultUsageMode 'style' (no defaultRole) → 'the style from @image_1'", () => {
    const out = resolveVideoReferenceCore({
      prompt: "a slow dolly", wiredCharRefs: [kira({ defaultUsageMode: "style" })], hybridRoles: true,
    })
    expect(out.prompt).toContain("the style from @image_1")
    expect(out.prompt).not.toContain("the person from @image_1")
  })

  it("plain unmentioned wired character → 'the person from @image_1' (unchanged)", () => {
    const out = resolveVideoReferenceCore({
      prompt: "a slow dolly", wiredCharRefs: [kira()], hybridRoles: true,
    })
    expect(out.prompt).toContain("the person from @image_1")
  })
})

describe("video @-mention honors the node defaultRole for un-roled tokens", () => {
  it("un-roled '@kira:1' with defaultRole 'hair' → 'the hair from @image_1'", () => {
    const out = resolveVideoReferenceCore({
      prompt: "@kira:1 walks in", wiredCharRefs: [kira({ defaultRole: "hair" })], hybridRoles: true,
    })
    expect(out.prompt).toContain("the hair from @image_1 walks in")
  })

  it("a per-mention token role still overrides the node defaultRole", () => {
    const out = resolveVideoReferenceCore({
      prompt: "@kira:1:face walks in", wiredCharRefs: [kira({ defaultRole: "hair" })], hybridRoles: true,
    })
    expect(out.prompt).toContain("the face from @image_1 walks in")
    expect(out.prompt).not.toContain("the hair from")
  })
})

describe("video extras honor the node defaultRole + mapped identityLock (CharacterMeta)", () => {
  it("first-sight extra with meta.defaultRole 'hair' and no per-ref override → 'the hair from @image_1'", () => {
    const out = resolveVideoReferenceCore({
      prompt: "a portrait",
      wiredCharRefs: [],
      extraRefs: [{ url: "u-look", characterSlug: "kira", variantSlug: "look" }],
      lookupCharacterBySlug: () => ({ characterName: "Kira", defaultRole: "hair" }),
      hybridRoles: true,
    })
    expect(out.prompt).toContain("the hair from @image_1")
    expect(out.prompt).not.toContain("the person from @image_1")
  })

  it("a per-extra usageMode override suppresses meta.defaultRole", () => {
    const out = resolveVideoReferenceCore({
      prompt: "a portrait",
      wiredCharRefs: [],
      extraRefs: [{ url: "u-look", characterSlug: "kira", variantSlug: "look", usageMode: "style" }],
      lookupCharacterBySlug: () => ({ characterName: "Kira", defaultRole: "hair" }),
      hybridRoles: true,
    })
    expect(out.prompt).toContain("the style from @image_1")
    expect(out.prompt).not.toContain("the hair from")
  })

  it("meta.identityLock (node soft mapping) emits the lock line for a first-sight extra; per-extra lock wins when both set", () => {
    const softLock = characterLockToRefLock("soft")
    const out = resolveVideoReferenceCore({
      prompt: "a portrait",
      wiredCharRefs: [],
      extraRefs: [{ url: "u-look", characterSlug: "kira", variantSlug: "look" }],
      lookupCharacterBySlug: () => ({ characterName: "Kira", identityLock: softLock }),
      hybridRoles: true,
    })
    // The node's soft lock is {ref}-bound at emission (binding = @image_1).
    expect(out.prompt).toContain("overall facial likeness of the subject in @image_1")

    const perExtraOff = resolveVideoReferenceCore({
      prompt: "a portrait",
      wiredCharRefs: [],
      extraRefs: [{
        url: "u-look", characterSlug: "kira", variantSlug: "look",
        identityLock: { enabled: false },
      }],
      lookupCharacterBySlug: () => ({ characterName: "Kira", identityLock: softLock }),
      hybridRoles: true,
    })
    expect(perExtraOff.prompt).not.toContain("overall facial likeness")
  })
})

describe("route-shaped extras (generate-video / text-to-video / MCP adapter contract)", () => {
  it("a per-extra defaultRole wins even when usageMode carries the COALESCED mode (the route adapter shape)", () => {
    // The direct-API adapter can only feed the coalesced defaultUsageMode as
    // `usageMode` (always set for character extras) — which must NOT suppress
    // the node default when it rides the dedicated per-extra `defaultRole` slot.
    const out = resolveVideoReferenceCore({
      prompt: "a portrait",
      wiredCharRefs: [],
      extraRefs: [{
        url: "u-look", characterSlug: "kira", variantSlug: "look",
        usageMode: "identical", defaultRole: "hair",
      }],
      hybridRoles: true,
    })
    expect(out.prompt).toContain("the hair from @image_1")
    expect(out.prompt).not.toContain("the person from @image_1")
  })

  it("a per-extra identityLock (route CR passthrough) emits the lock line without any meta", () => {
    const out = resolveVideoReferenceCore({
      prompt: "a portrait",
      wiredCharRefs: [],
      extraRefs: [{
        url: "u-look", characterSlug: "kira", variantSlug: "look",
        usageMode: "identical",
        identityLock: characterLockToRefLock("strict"),
      }],
      hybridRoles: true,
    })
    expect(out.prompt).toContain("The facial identity of the subject in @image_1 must match exactly")
  })
})

describe("image/video parity for a defaultRole node (convergence pinned)", () => {
  it("the SAME defaultRole node yields the SAME role phrase on both surfaces", () => {
    const ref = kira({ url: "https://cdn/kira.png", defaultRole: "clothes" })
    const imageOut = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "a cinematic portrait",
      connectedReferences: [ref],
      referenceFormat: "hybrid",
    })
    const videoOut = resolveVideoReferenceCore({
      prompt: "a cinematic portrait", wiredCharRefs: [ref], hybridRoles: true,
    })
    expect(imageOut.prompt).toContain("the clothes from reference image A")
    expect(videoOut.prompt).toContain("the clothes from @image_1")
  })
})

describe("video legacy ignores defaultRole (byte-identical guard)", () => {
  it("legacy (hybridRoles: false) with a defaultRole-carrying ref emits the legacy block, no role phrase", () => {
    const out = resolveVideoReferenceCore({
      prompt: "a slow dolly", wiredCharRefs: [kira({ defaultRole: "clothes" })], hybridRoles: false,
    })
    expect(out.prompt).not.toContain("the clothes from @image_1")
    expect(out.prompt).toContain("Use these characters:")
  })
})
