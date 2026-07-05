// packages/shared/src/__tests__/expand-extra-refs-role.test.ts
//
// `expandExtraRefsToConnectedReferences` must stamp the character node's
// hybrid `defaultRole` + mapped `identityLock` (from ExtraRefCharacterContext)
// onto character-sourced extras — with the per-ref `usageMode` override
// SUPPRESSING the node defaultRole (the override wins), while the lock is
// orthogonal (always inherited unless the ref itself overrides downstream).
import { describe, it, expect } from "vitest"
import { expandExtraRefsToConnectedReferences } from "@nodaro/shared"
import { characterLockToRefLock } from "../identity-lock.js"

const lookup = (ctx: Record<string, unknown>) => (slug: string) =>
  slug === "kira" ? (ctx as never) : undefined

describe("expandExtraRefsToConnectedReferences — defaultRole + identityLock stamping", () => {
  it("stamps ctx.defaultRole when the extra has no per-ref usageMode override", () => {
    const [ref] = expandExtraRefsToConnectedReferences(
      [{ url: "u", characterSlug: "kira", variantSlug: "look" }],
      lookup({ displayName: "Kira", defaultRole: "hair" }),
    )
    expect(ref.defaultRole).toBe("hair")
  })

  it("a per-ref usageMode override suppresses the node defaultRole (override wins)", () => {
    const [ref] = expandExtraRefsToConnectedReferences(
      [{ url: "u", characterSlug: "kira", variantSlug: "look", usageMode: "face" }],
      lookup({ displayName: "Kira", defaultRole: "hair" }),
    )
    expect(ref.defaultRole).toBeUndefined()
    expect(ref.defaultUsageMode).toBe("face")
  })

  it("stamps ctx.identityLock (node's mapped lock) onto the character extra", () => {
    const lock = characterLockToRefLock("strict")
    const [ref] = expandExtraRefsToConnectedReferences(
      [{ url: "u", characterSlug: "kira", variantSlug: "look" }],
      lookup({ displayName: "Kira", identityLock: lock }),
    )
    expect(ref.identityLock).toEqual(lock)
  })

  it("manual extras (no characterSlug) get neither field", () => {
    const [ref] = expandExtraRefsToConnectedReferences(
      [{ url: "u", description: "a brass lantern" }],
      lookup({ defaultRole: "hair", identityLock: characterLockToRefLock("soft") }),
    )
    expect(ref.defaultRole).toBeUndefined()
    expect(ref.identityLock).toBeUndefined()
  })
})
