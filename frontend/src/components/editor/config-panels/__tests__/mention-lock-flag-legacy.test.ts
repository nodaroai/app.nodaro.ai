import { describe, it, expect } from "vitest"
import { collectTokens, type KnownSlugSets } from "../prompt-editor"

/**
 * Legacy-format guard for the `~lock` sentinel (Task 4). The test env resolves
 * `IMAGE_REFERENCE_FORMAT` to "legacy", so promotion must STRIP the lock —
 * mirroring the Plan-D role gate — so a stray sentinel from a prior hybrid
 * session never flips a legacy pill's (hidden, toggle-less) lock on.
 */
function known(opts: { chars?: string[]; locs?: string[] } = {}): KnownSlugSets {
  return { characters: new Set(opts.chars ?? []), locations: new Set(opts.locs ?? []), snippets: [] }
}

describe("collectTokens — ~lock is inert in legacy", () => {
  it("character @kira:1:face~lock → promoted but lock:false (stripped)", () => {
    const out = collectTokens("@kira:1:face~lock runs", known({ chars: ["kira"] }))
    expect(out).toHaveLength(1)
    expect(out[0].node.type).toBe("characterRef")
    expect(out[0].node.attrs).toMatchObject({ characterSlug: "kira", usageMode: "face", lock: false })
  })

  it("location role @old-library:1:background~lock → NOT promoted (role is hybrid-only), stays text", () => {
    const out = collectTokens("@old-library:1:background~lock now", known({ locs: ["old-library"] }))
    expect(out).toEqual([])
  })
})
