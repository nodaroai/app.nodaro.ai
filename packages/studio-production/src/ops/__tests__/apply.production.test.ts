/**
 * Section 1 — `production`: the document's own settings.
 *
 * The oracle is the studio store's own suite: `production-store.test.ts` →
 * `describe("storyboard merge vs replace")` and the `selectShot` half of
 * `describe("selectors")`. Those assertions are ported VERBATIM — only the call
 * shape changes, from `store.setStoryboard(patch)` to
 * `productionHandlers.set_storyboard(production, op, ctx)`.
 *
 * Six of this section's nine ops have no store test to port (`set_name` and
 * `set_thumbnail` are SDK calls in `lib/production.ts`; `setArchived`,
 * `setMusic`, `setMusicPlan` and `setProductionFilm` are one-line reducers the
 * studio only ever exercises as SETUP for another test). Their tests below are
 * written from the reducer's own behaviour — the copy discipline (`copyLook`,
 * `copyMusicPlan`) included — and that is called out in the report.
 */
import { describe, expect, it } from "vitest"

import { isOpError, OpError } from "../errors"
import type { Production } from "../production"
import type { OpContext } from "../types"
import { productionHandlers, productionOpClasses, productionOpSchemas } from "../sections/production"

/** A still-only shot fixture (stable ids for assertions). */
const stillOnly = (id: string) => ({
  id,
  still: {
    nodeId: `generate-image-${id}`,
    url: `https://r2.example/${id}.png`,
    provider: "nano-banana",
    prompt: `prompt ${id}`,
  },
})

const ctx: OpContext = { now: "2026-09-06T12:00:00.000Z", mintId: () => "id-1" }

/** A production with two still-only shots and nothing else set. */
const twoShots = (): Production => ({
  shots: [stillOnly("a"), stillOnly("b")],
  selectedShotId: "a",
})

const empty = (): Production => ({ shots: [] })

// ── the two ROW ops: they write a workflow column, not settings.studio ──────

describe("set_name", () => {
  it("returns the production untouched and asks the route for the column", () => {
    const production = twoShots()
    const result = productionHandlers.set_name(
      production,
      { op: "set_name", name: "The Chase" },
      ctx,
    )

    expect(result.production).toBe(production)
    expect(result.receipt.row).toEqual({ name: "The Chase" })
    expect(result.receipt.summary).toBe("Renamed the production to “The Chase”.")
  })
})

describe("set_thumbnail", () => {
  it("carries the url on the receipt's row", () => {
    const production = twoShots()
    const result = productionHandlers.set_thumbnail(
      production,
      { op: "set_thumbnail", url: "https://r2.example/a.png" },
      ctx,
    )

    expect(result.production).toBe(production)
    expect(result.receipt.row).toEqual({ thumbnailUrl: "https://r2.example/a.png" })
    expect(result.receipt.summary).toBe("Set the production thumbnail.")
  })

  it("carries a null to CLEAR the column", () => {
    const result = productionHandlers.set_thumbnail(
      twoShots(),
      { op: "set_thumbnail", url: null },
      ctx,
    )

    expect(result.receipt.row).toEqual({ thumbnailUrl: null })
    expect(result.receipt.summary).toBe("Cleared the production thumbnail.")
  })
})

// ── the soft hide ───────────────────────────────────────────────────────────

describe("set_archived", () => {
  it("archives and unarchives, copy-on-write", () => {
    const production = twoShots()
    const archived = productionHandlers.set_archived(
      production,
      { op: "set_archived", archived: true },
      ctx,
    )

    expect(archived.production.archived).toBe(true)
    expect(archived.production).not.toBe(production)
    expect(production.archived).toBeUndefined()
    expect(archived.receipt.summary).toBe("Archived the production.")

    const back = productionHandlers.set_archived(
      archived.production,
      { op: "set_archived", archived: false },
      ctx,
    )
    expect(back.production.archived).toBe(false)
    expect(back.receipt.summary).toBe("Restored the production from the archive.")
  })

  it("warns when the flag already reads that way", () => {
    const result = productionHandlers.set_archived(
      { ...twoShots(), archived: true },
      { op: "set_archived", archived: true },
      ctx,
    )

    expect(result.warnings).toEqual(["The production was already archived."])
  })

  it("is classed a delete when it hides and safe when it restores", () => {
    expect(productionOpClasses.set_archived).toBe("D")
  })
})

// ── the selection ───────────────────────────────────────────────────────────

describe("select_shot", () => {
  // Ported from `production-store.test.ts` → describe("selectors"), the
  // `selectShot` half: selecting a shot makes it the selected one.
  it("selects the shot", () => {
    const result = productionHandlers.select_shot(
      twoShots(),
      { op: "select_shot", shotId: "b" },
      ctx,
    )

    expect(result.production.selectedShotId).toBe("b")
    expect(result.receipt.summary).toBe("Selected Shot 2.")
  })

  it("names a shot by its own name when it has one", () => {
    const production: Production = {
      shots: [stillOnly("a"), { ...stillOnly("b"), name: "Rooftop" }],
    }
    const result = productionHandlers.select_shot(
      production,
      { op: "select_shot", shotId: "b" },
      ctx,
    )

    expect(result.receipt.summary).toBe("Selected “Rooftop”.")
  })

  // The one deliberate generalisation over the store: the store lets a ghost id
  // sit in `selectedShotId` (its SELECTOR returns undefined); an operation
  // addresses by stable key and refuses a target that is not there.
  it("refuses a shot that is not in the production", () => {
    expect(() =>
      productionHandlers.select_shot(
        twoShots(),
        { op: "select_shot", shotId: "ghost" },
        ctx,
      ),
    ).toThrow(OpError)

    try {
      productionHandlers.select_shot(
        twoShots(),
        { op: "select_shot", shotId: "ghost" },
        ctx,
      )
    } catch (error) {
      expect(isOpError(error)).toBe(true)
      if (!isOpError(error)) throw error
      expect(error.code).toBe("op_target_missing")
    }
  })
})

// ── the production-wide film look ───────────────────────────────────────────

describe("set_film", () => {
  it("REPLACES the film map", () => {
    const production: Production = { ...twoShots(), film: { styleId: "noir" } }
    const result = productionHandlers.set_film(
      production,
      { op: "set_film", film: { styleId: "sepia", eraId: "1980s-neon" } },
      ctx,
    )

    expect(result.production.film).toEqual({ styleId: "sepia", eraId: "1980s-neon" })
    expect(result.production).not.toBe(production)
    expect(production.film).toEqual({ styleId: "noir" })
    expect(result.receipt.summary).toBe("Set the film look (2 picks).")
  })

  it("an empty map clears the look", () => {
    const result = productionHandlers.set_film(
      { ...twoShots(), film: { styleId: "noir" } },
      { op: "set_film", film: {} },
      ctx,
    )

    expect(result.production.film).toEqual({})
    expect(result.receipt.summary).toBe("Cleared the film look.")
  })

  it("never aliases the caller's map (the store's copyLook)", () => {
    const film: Record<string, string | string[]> = {
      styleId: "noir",
      atmosphereId: ["fog", "dust"],
    }
    const result = productionHandlers.set_film(
      twoShots(),
      { op: "set_film", film },
      ctx,
    )

    film.styleId = "MUTATED"
    ;(film.atmosphereId as string[])[0] = "MUTATED"

    expect(result.production.film).toEqual({
      styleId: "noir",
      atmosphereId: ["fog", "dust"],
    })
  })
})

// ── the soundtrack and its plan ─────────────────────────────────────────────

describe("set_music / clear_music", () => {
  const music = {
    url: "https://r2.example/track.mp3",
    prompt: "gentle piano",
    duration: 20,
    provider: "suno-v5",
  }

  it("sets the soundtrack, copy-on-write", () => {
    const production = empty()
    const result = productionHandlers.set_music(
      production,
      { op: "set_music", music },
      ctx,
    )

    expect(result.production.music).toEqual(music)
    expect(result.production).not.toBe(production)
    expect(production.music).toBeUndefined()
    expect(result.receipt.summary).toBe("Set the soundtrack to “gentle piano”.")
  })

  it("clears the soundtrack — the key goes away, not to undefined", () => {
    const production: Production = { ...empty(), music }
    const result = productionHandlers.clear_music(
      production,
      { op: "clear_music" },
      ctx,
    )

    expect("music" in result.production).toBe(false)
    expect(production.music).toEqual(music)
    expect(result.receipt.summary).toBe("Removed the soundtrack.")
    expect(result.warnings).toBeUndefined()
  })

  it("warns when there was no soundtrack to remove", () => {
    const result = productionHandlers.clear_music(
      empty(),
      { op: "clear_music" },
      ctx,
    )

    expect(result.warnings).toEqual(["There was no soundtrack to remove."])
  })
})

describe("set_music_plan", () => {
  const plan = {
    prompt: "a slow build",
    duration: 30,
    selections: {
      vocals: "instrumental" as const,
      vocalGender: "any" as const,
      genre: "ambient",
      instruments: ["piano", "strings"],
    },
  }

  it("REPLACES the plan and never aliases it (the store's copyMusicPlan)", () => {
    const production = empty()
    const result = productionHandlers.set_music_plan(
      production,
      { op: "set_music_plan", plan },
      ctx,
    )

    expect(result.production.musicPlan).toEqual(plan)
    expect(result.production.musicPlan).not.toBe(plan)
    expect(result.production.musicPlan?.selections?.instruments).not.toBe(
      plan.selections.instruments,
    )
    expect(production.musicPlan).toBeUndefined()
    expect(result.receipt.summary).toBe("Set the soundtrack plan to “a slow build”.")
  })

  it("a null plan clears it — the key goes away", () => {
    const production: Production = { ...empty(), musicPlan: plan }
    const result = productionHandlers.set_music_plan(
      production,
      { op: "set_music_plan", plan: null },
      ctx,
    )

    expect("musicPlan" in result.production).toBe(false)
    expect(production.musicPlan).toEqual(plan)
    expect(result.receipt.summary).toBe("Cleared the soundtrack plan.")
  })
})

// ── the storyboard ──────────────────────────────────────────────────────────

/**
 * Ported from `production-store.test.ts` → `describe("storyboard merge vs
 * replace")`. The load-bearing distinction the studio pins: `setStoryboard`
 * MERGES and CANNOT drop a key. `resetStoryboard` (the REPLACE half) is a
 * hydrate/project-switch concern with no operation of its own (§6 lists only
 * the merge), so its assertions and the functional-updater case — the op's arg
 * is a plain patch, never a function — are not ported; see the report.
 */
describe("storyboard merge vs replace", () => {
  const setStoryboard = (
    production: Production,
    patch: Record<string, unknown>,
  ) =>
    productionHandlers.set_storyboard(
      production,
      { op: "set_storyboard", patch },
      ctx,
    ).production

  it("merges a partial patch (keeps other keys)", () => {
    // The studio's own first line — `expect(get().storyboard).toEqual({})` —
    // asserts the STORE's initial state, not the reducer's behaviour, and a
    // parsed production carries no storyboard key at all. Omitted rather than
    // softened (the oracle rule cuts both ways).
    let production = empty()
    production = setStoryboard(production, { brief: "a chase" })
    production = setStoryboard(production, { on: true })
    expect(production.storyboard).toEqual({ brief: "a chase", on: true })
  })

  it("merge can't drop a key", () => {
    let production = setStoryboard(empty(), {
      brief: "x",
      scripts: { s1: "a" },
      on: true,
    })
    // A merge with an empty patch is a NO-OP — it can't clear (the new-empty-project bug).
    production = setStoryboard(production, {})
    expect(production.storyboard).toEqual({ brief: "x", scripts: { s1: "a" }, on: true })
  })

  it("names the merged keys in the receipt and warns on an empty patch", () => {
    const merged = productionHandlers.set_storyboard(
      empty(),
      { op: "set_storyboard", patch: { brief: "x", on: true } },
      ctx,
    )
    expect(merged.receipt.summary).toBe("Updated the storyboard (brief, on).")
    expect(merged.warnings).toBeUndefined()

    const noop = productionHandlers.set_storyboard(
      empty(),
      { op: "set_storyboard", patch: {} },
      ctx,
    )
    expect(noop.receipt.summary).toBe("Left the storyboard unchanged.")
    expect(noop.warnings).toEqual(["The storyboard patch was empty; nothing changed."])
  })

  it("is copy-on-write: the input's storyboard is untouched", () => {
    const production: Production = { ...empty(), storyboard: { brief: "x" } }
    const result = setStoryboard(production, { on: true })

    expect(result.storyboard).toEqual({ brief: "x", on: true })
    expect(production.storyboard).toEqual({ brief: "x" })
  })
})

// ── the section's own tables ────────────────────────────────────────────────

describe("the production section", () => {
  it("declares a schema, a handler and a class for each of its nine ops", () => {
    const ops = [
      "set_name",
      "set_thumbnail",
      "set_archived",
      "select_shot",
      "set_film",
      "set_music_plan",
      "set_music",
      "clear_music",
      "set_storyboard",
    ]

    expect(Object.keys(productionOpSchemas).sort()).toEqual([...ops].sort())
    expect(Object.keys(productionHandlers).sort()).toEqual([...ops].sort())
    expect(Object.keys(productionOpClasses).sort()).toEqual([...ops].sort())
  })

  it("each schema pins its own discriminator", () => {
    for (const [name, schema] of Object.entries(productionOpSchemas)) {
      const parsed = schema.safeParse({ op: "not_this_one" })
      expect(parsed.success, name).toBe(false)
    }
    expect(
      productionOpSchemas.set_archived.safeParse({
        op: "set_archived",
        archived: true,
      }).success,
    ).toBe(true)
  })
})
