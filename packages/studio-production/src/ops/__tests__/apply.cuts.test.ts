/**
 * The `cuts` section — the exported versions of the film.
 *
 * The assertions in the first four cases are PORTED VERBATIM from the studio
 * store's `describe("cut versions (settings.studio.cuts)")`; only the call
 * shape changes, from `get().addCut(cut)` to
 * `cutsHandlers.add_cut(production, op, ctx)`. That is the oracle rule: the
 * studio suite is the specification of these reducers.
 *
 * Two of the oracle's cases do NOT survive the move, and deliberately so:
 *  - the `setCuts` (hydrate) and `reset()` halves — `setCuts`/`adoptCuts`/
 *    `reset` are store LIFECYCLE reducers, not operations; nothing in the op
 *    vocabulary replaces the cut list wholesale.
 *  - `describe("cut deletion tombstones …")` — `deletedCutIds` is a SESSION
 *    Set the studio client keeps for its save-time `mergeCuts` union; it is
 *    not in `settings.studio` and so not on `Production`. The half of that
 *    test which IS about the document (the entry is dropped) is ported below.
 *
 * Everything after "beyond the oracle" is written from the reducer behaviour
 * plus the section contract (a missing target throws, a duplicate id is
 * refused, every handler is copy-on-write).
 */
import { describe, expect, it } from "vitest"

import { isOpError } from "../errors"
import type { Production } from "../production"
import type { OpContext } from "../types"
import { cutsHandlers, cutsOpClasses, cutsOpSchemas } from "../sections/cuts"

const ctx: OpContext = { now: "2026-09-06T12:00:00.000Z", mintId: () => "minted-1" }

/** The oracle's own fixture helper, verbatim. */
const cut = (id: string, name: string, final?: true) => ({
  id,
  name,
  url: `https://r2/${id}.mp4`,
  exportedAt: "2026-07-27T12:00:00.000Z",
  ...(final ? { final } : {}),
})

const withCuts = (...cuts: ReturnType<typeof cut>[]): Production => ({
  shots: [],
  cuts,
})

// ── ported from the studio store's cut-version suite ─────────────────────────

describe("cut versions (settings.studio.cuts)", () => {
  it("add_cut APPENDS (never overwrites)", () => {
    const production = withCuts(cut("a", "Cut A", true))
    const { production: next } = cutsHandlers.add_cut(
      production,
      { op: "add_cut", cut: cut("b", "Cut B") },
      ctx,
    )
    expect(next.cuts?.map((c) => c.id)).toEqual(["a", "b"])
  })

  it("mark_cut_final is EXCLUSIVE (the tag moves) and toggles off on the current final", () => {
    const production = withCuts(cut("a", "Cut A", true), cut("b", "Cut B"))
    const moved = cutsHandlers.mark_cut_final(
      production,
      { op: "mark_cut_final", id: "b" },
      ctx,
    ).production
    expect(moved.cuts?.find((c) => c.id === "a")?.final).toBeUndefined()
    expect(moved.cuts?.find((c) => c.id === "b")?.final).toBe(true)
    // Toggling the current final CLEARS the tag entirely.
    const toggled = cutsHandlers.mark_cut_final(
      moved,
      { op: "mark_cut_final", id: "b" },
      ctx,
    ).production
    expect(toggled.cuts?.some((c) => c.final)).toBe(false)
  })

  it("duplicate_cut copies media/project but NEVER inherits the FINAL tag", () => {
    const production = withCuts(cut("a", "Cut A", true))
    const { production: next } = cutsHandlers.duplicate_cut(
      production,
      { op: "duplicate_cut", id: "a", newId: "a-copy" },
      ctx,
    )
    const cuts = next.cuts ?? []
    expect(cuts).toHaveLength(2)
    expect(cuts[1].name).toBe("Cut A copy")
    expect(cuts[1].url).toBe(cuts[0].url)
    expect(cuts[1].id).not.toBe(cuts[0].id)
    expect(cuts[1].final).toBeUndefined()
  })

  it("rename_cut trims and ignores blank; delete_cut drops the entry", () => {
    const production = withCuts(cut("a", "Cut A"))
    const renamed = cutsHandlers.rename_cut(
      production,
      { op: "rename_cut", id: "a", name: "  Director's cut  " },
      ctx,
    ).production
    expect(renamed.cuts?.[0].name).toBe("Director's cut")
    const blank = cutsHandlers.rename_cut(
      renamed,
      { op: "rename_cut", id: "a", name: "   " },
      ctx,
    ).production
    expect(blank.cuts?.[0].name).toBe("Director's cut")
    const deleted = cutsHandlers.delete_cut(
      blank,
      { op: "delete_cut", id: "a" },
      ctx,
    ).production
    expect(deleted.cuts).toEqual([])
  })
})

// ── beyond the oracle: the section contract ──────────────────────────────────

describe("cut operations beyond the store's suite", () => {
  it("appends onto a production that has no cuts yet", () => {
    const { production: next } = cutsHandlers.add_cut(
      { shots: [] },
      { op: "add_cut", cut: cut("a", "Cut A") },
      ctx,
    )
    expect(next.cuts?.map((c) => c.id)).toEqual(["a"])
  })

  it("keeps the duplicate's freecut project url and drops nothing else", () => {
    const source = { ...cut("a", "Cut A"), freecutProjectUrl: "https://r2/a.json" }
    const { production: next } = cutsHandlers.duplicate_cut(
      { shots: [], cuts: [source] },
      { op: "duplicate_cut", id: "a", newId: "a-copy" },
      ctx,
    )
    expect(next.cuts?.[1]).toEqual({
      ...source,
      id: "a-copy",
      name: "Cut A copy",
    })
  })

  it("refuses an id that is not in the production", () => {
    const production = withCuts(cut("a", "Cut A"))
    const missing = [
      () => cutsHandlers.rename_cut(production, { op: "rename_cut", id: "zz", name: "X" }, ctx),
      () => cutsHandlers.delete_cut(production, { op: "delete_cut", id: "zz" }, ctx),
      () => cutsHandlers.mark_cut_final(production, { op: "mark_cut_final", id: "zz" }, ctx),
      () =>
        cutsHandlers.duplicate_cut(
          production,
          { op: "duplicate_cut", id: "zz", newId: "zz-copy" },
          ctx,
        ),
    ]
    for (const call of missing) {
      try {
        call()
        throw new Error("expected the handler to refuse a missing cut")
      } catch (error) {
        expect(isOpError(error)).toBe(true)
        if (!isOpError(error)) throw error
        expect(error.code).toBe("op_target_missing")
      }
    }
  })

  it("refuses an id the production already carries", () => {
    const production = withCuts(cut("a", "Cut A"))
    for (const call of [
      () => cutsHandlers.add_cut(production, { op: "add_cut", cut: cut("a", "Again") }, ctx),
      () =>
        cutsHandlers.duplicate_cut(
          production,
          { op: "duplicate_cut", id: "a", newId: "a" },
          ctx,
        ),
    ]) {
      try {
        call()
        throw new Error("expected the handler to refuse a duplicate id")
      } catch (error) {
        expect(isOpError(error)).toBe(true)
        if (!isOpError(error)) throw error
        expect(error.code).toBe("op_invalid")
      }
    }
  })

  it("never mutates the production or its cut list", () => {
    const before = withCuts(cut("a", "Cut A", true), cut("b", "Cut B"))
    const cutsBefore = before.cuts
    const snapshot = JSON.parse(JSON.stringify(before)) as unknown

    cutsHandlers.add_cut(before, { op: "add_cut", cut: cut("c", "Cut C") }, ctx)
    cutsHandlers.rename_cut(before, { op: "rename_cut", id: "a", name: "Renamed" }, ctx)
    cutsHandlers.delete_cut(before, { op: "delete_cut", id: "a" }, ctx)
    cutsHandlers.mark_cut_final(before, { op: "mark_cut_final", id: "b" }, ctx)
    cutsHandlers.duplicate_cut(
      before,
      { op: "duplicate_cut", id: "a", newId: "a-copy" },
      ctx,
    )

    expect(before).toEqual(snapshot)
    expect(before.cuts).toBe(cutsBefore)
  })

  it("warns instead of failing when a rename is blank", () => {
    const { warnings, production } = cutsHandlers.rename_cut(
      withCuts(cut("a", "Cut A")),
      { op: "rename_cut", id: "a", name: "   " },
      ctx,
    )
    expect(production.cuts?.[0].name).toBe("Cut A")
    expect(warnings).toEqual(["Kept the name “Cut A” — the new name was blank."])
  })

  it("reports each cut by its display name, with no ids in the prose", () => {
    const production = withCuts(cut("a", "Cut A", true), cut("b", "Cut B"))
    const summaries = [
      cutsHandlers.add_cut(production, { op: "add_cut", cut: cut("c", "Cut C") }, ctx).receipt,
      cutsHandlers.rename_cut(
        production,
        { op: "rename_cut", id: "a", name: "Director's cut" },
        ctx,
      ).receipt,
      cutsHandlers.delete_cut(production, { op: "delete_cut", id: "a" }, ctx).receipt,
      cutsHandlers.mark_cut_final(production, { op: "mark_cut_final", id: "b" }, ctx).receipt,
      cutsHandlers.mark_cut_final(production, { op: "mark_cut_final", id: "a" }, ctx).receipt,
      cutsHandlers.duplicate_cut(
        production,
        { op: "duplicate_cut", id: "a", newId: "a-copy" },
        ctx,
      ).receipt,
    ]

    expect(summaries.map((r) => r.summary)).toEqual([
      "Added cut “Cut C”.",
      "Renamed cut “Cut A” to “Director's cut”.",
      "Deleted cut “Cut A”.",
      "Marked “Cut B” as the final cut.",
      "Cleared the final tag from “Cut A”.",
      "Duplicated cut “Cut A” as “Cut A copy”.",
    ])
    for (const receipt of summaries) {
      expect(receipt.ids).toBeUndefined()
      expect(receipt.summary).not.toMatch(/\ba-copy\b/)
    }
  })

  it("declares a confirmation class for every op it declares", () => {
    expect(Object.keys(cutsOpClasses)).toEqual(Object.keys(cutsOpSchemas))
    expect(Object.keys(cutsOpSchemas)).toEqual([
      "add_cut",
      "rename_cut",
      "delete_cut",
      "mark_cut_final",
      "duplicate_cut",
    ])
    expect(cutsOpClasses.delete_cut).toBe("D")
  })

  it("parses its own arguments", () => {
    expect(
      cutsOpSchemas.duplicate_cut.parse({
        op: "duplicate_cut",
        id: "a",
        newId: "b",
      }),
    ).toEqual({ op: "duplicate_cut", id: "a", newId: "b" })
    expect(cutsOpSchemas.add_cut.safeParse({ op: "add_cut", cut: { id: "a" } }).success).toBe(
      false,
    )
  })
})
