import { describe, it, expect } from "vitest"
import { resolveVideoReferenceCore } from "../video-reference-resolver.js"
import type { ConnectedReference } from "@nodaro/shared"

const kira = (over: Partial<ConnectedReference> = {}): ConnectedReference => ({
  id: "k", defaultName: "Kira", source: "wired-character", url: "u-kira", characterSlug: "kira", ...over,
})

describe("video character convergence (hybridRoles)", () => {
  it("hybridRoles: @-mention → 'the face from @image_1', no legacy block", () => {
    const out = resolveVideoReferenceCore({
      prompt: "@kira:1:face runs", wiredCharRefs: [kira()], hybridRoles: true,
    })
    expect(out.prompt).toContain("the face from @image_1 runs")
    expect(out.prompt).not.toContain("Use these characters:")
    expect(out.additionalUrls).toContain("u-kira")
  })

  it("hybridRoles: unmentioned character → canonical 'the person from @image_1', no block, no auto-lock", () => {
    const out = resolveVideoReferenceCore({
      prompt: "a slow dolly", wiredCharRefs: [kira()], hybridRoles: true,
    })
    expect(out.prompt).toContain("the person from @image_1")
    expect(out.prompt).not.toContain("Lock the exact identity")
    expect(out.prompt).not.toContain("Use these characters:")
  })

  it("opt-in lock appears when enabled", () => {
    const out = resolveVideoReferenceCore({
      prompt: "a portrait", wiredCharRefs: [kira({ identityLock: { enabled: true } })], hybridRoles: true,
    })
    expect(out.prompt).toContain("Lock the exact identity of the person in @image_1")
  })

  it("elementInjection preserved (unmentioned/canonical path)", () => {
    const out = resolveVideoReferenceCore({
      prompt: "a cafe", wiredCharRefs: [kira({ elementInjection: "holding a smartphone" })], hybridRoles: true,
    })
    expect(out.prompt?.toLowerCase()).toContain("holding a smartphone")
  })

  it("elementInjection preserved on the MENTIONED path (with role phrase)", () => {
    const out = resolveVideoReferenceCore({
      prompt: "@kira:1 walks in", wiredCharRefs: [kira({ elementInjection: "wearing a red scarf" })], hybridRoles: true,
    })
    expect(out.prompt?.toLowerCase()).toContain("red scarf")
    expect(out.prompt).toContain("the person from @image_1")
    expect(out.prompt).not.toContain("Use these characters:")
  })

  it("hybridRoles: manual extra surfaces description tied to @image_N, URL attached, no block, no legacy bullet", () => {
    const out = resolveVideoReferenceCore({
      prompt: "a still life",
      wiredCharRefs: [],
      extraRefs: [{ url: "u-lantern", description: "a brass lantern" }],
      hybridRoles: true,
    })
    expect(out.prompt?.toLowerCase()).toContain("a brass lantern")
    expect(out.prompt).toContain("@image_1")
    expect(out.prompt).not.toContain("Use these characters:")
    expect(out.prompt).not.toContain("(reference):") // legacy manual shape gone
    expect(out.additionalUrls).toContain("u-lantern")
  })

  it("hybridRoles: same-character extra pairs back to the earlier @image_M", () => {
    const out = resolveVideoReferenceCore({
      prompt: "a duet",
      wiredCharRefs: [kira()], // canonical → @image_1
      extraRefs: [{ url: "u-kira-2", characterSlug: "kira", description: "mid-action" }],
      lookupCharacterBySlug: () => ({ characterName: "Kira" }),
      hybridRoles: true,
    })
    expect(out.prompt).toContain("@image_2 is the same subject as @image_1")
    expect(out.prompt?.toLowerCase()).toContain("mid-action")
    expect(out.additionalUrls).toEqual(["u-kira", "u-kira-2"])
  })

  it("hybridRoles: first-sight character extra → mapped role phrase + elementInjection, no block", () => {
    const out = resolveVideoReferenceCore({
      prompt: "a reveal",
      wiredCharRefs: [],
      extraRefs: [{ url: "u-vex", characterSlug: "vex", usageMode: "face", elementInjection: "wearing a red scarf" }],
      lookupCharacterBySlug: () => ({ characterName: "Vex" }),
      hybridRoles: true,
    })
    expect(out.prompt).toContain("the face from @image_1")
    expect(out.prompt?.toLowerCase()).toContain("red scarf")
    expect(out.prompt).not.toContain("Use these characters:")
    expect(out.additionalUrls).toContain("u-vex")
  })

  it("LEGACY (hybridRoles false/default) unchanged → still the block", () => {
    const out = resolveVideoReferenceCore({ prompt: "@kira:1 runs", wiredCharRefs: [kira()] })
    expect(out.prompt).toContain("Use these characters:")
  })
})
