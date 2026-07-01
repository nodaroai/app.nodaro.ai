import { describe, it, expect } from "vitest"
import { collectTokens, type KnownSlugSets } from "../prompt-editor"

/**
 * Legacy-format guard for the `~lock` / `~nolock` sentinels (Task 4 + F4). The
 * test env resolves `IMAGE_REFERENCE_FORMAT` to "legacy", so promotion must
 * STRIP the lock (to `undefined`, inert) — mirroring the Plan-D role gate — so a
 * stray sentinel from a prior hybrid session never flips a legacy pill's
 * (hidden, toggle-less) lock on/off. Stripping to `undefined` (NOT `false`) is
 * critical: `false` would re-serialize as a spurious `~nolock`.
 */
function known(opts: { chars?: string[]; locs?: string[] } = {}): KnownSlugSets {
  return { characters: new Set(opts.chars ?? []), locations: new Set(opts.locs ?? []), snippets: [] }
}

describe("collectTokens — lock sentinels are inert in legacy", () => {
  it("character @kira:1:face~lock → promoted but lock stripped (undefined)", () => {
    const out = collectTokens("@kira:1:face~lock runs", known({ chars: ["kira"] }))
    expect(out).toHaveLength(1)
    expect(out[0].node.type).toBe("characterRef")
    expect(out[0].node.attrs).toMatchObject({ characterSlug: "kira", usageMode: "face" })
    expect(out[0].node.attrs?.lock).toBeUndefined()
  })

  it("character @kira:1:face~nolock → promoted but lock stripped (undefined, Task F4)", () => {
    const out = collectTokens("@kira:1:face~nolock runs", known({ chars: ["kira"] }))
    expect(out).toHaveLength(1)
    expect(out[0].node.type).toBe("characterRef")
    expect(out[0].node.attrs).toMatchObject({ characterSlug: "kira", usageMode: "face" })
    expect(out[0].node.attrs?.lock).toBeUndefined()
  })

  it("location role @old-library:1:background~lock → NOT promoted (role is hybrid-only), stays text", () => {
    const out = collectTokens("@old-library:1:background~lock now", known({ locs: ["old-library"] }))
    expect(out).toEqual([])
  })

  it("location role @old-library:1:background~nolock → NOT promoted (role is hybrid-only), stays text", () => {
    const out = collectTokens("@old-library:1:background~nolock now", known({ locs: ["old-library"] }))
    expect(out).toEqual([])
  })
})
