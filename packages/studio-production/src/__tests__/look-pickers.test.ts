import { describe, it, expect } from "vitest"

import { DIRECTION_FIELDS, DIRECTION_KEYS } from "@nodaro/prompts"

import {
  LOOK_PICKERS,
  LOOK_GROUP_ORDER,
  CHARACTER_FX_KEY,
  characterFxPicker,
  pickersForSurface,
  groupedPickersForSurface,
  cameraMovementPicker,
  modeForPicker,
  pickerFragment,
} from "../look-pickers"

/**
 * The Look registry is the single source of truth for every cinematic dimension —
 * and it's data-driven off `@nodaro/shared` helpers wired by hand (one `getLabel`
 * + one `getHint` per row). These invariants catch a mis-wire LOUDLY: a `getHint`
 * pointed at the wrong catalog would silently inject "" into every prompt; a
 * missing `platformField` would mean a picker the user can set that reaches no
 * model at all; an entry whose category is missing from the order would vanish
 * from the grid. Far better to fail a test than to ship a dead picker.
 */

/** The platform row for a projection key (the wire's own maxPicks / surface). */
const platformRow = (key: string) => DIRECTION_FIELDS.find((f) => f.key === key)

describe("LOOK_PICKERS — registry integrity", () => {
  it("has a non-trivial set of pickers (the full Nodaro cinematic surface)", () => {
    // We surface the whole catalog set — guard against a regression that quietly
    // drops back to a handful.
    expect(LOOK_PICKERS.length).toBeGreaterThanOrEqual(20)
  })

  it("every picker key is unique", () => {
    const keys = LOOK_PICKERS.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("every picker has a non-empty catalog and resolves a label", () => {
    for (const p of LOOK_PICKERS) {
      expect(p.catalog.length, `${p.key} catalog`).toBeGreaterThan(0)
      const first = p.catalog[0]
      expect(p.getLabel(first.id), `${p.key} getLabel`).toBeTruthy()
    }
  })

  it("every picker's getHint produces a RICH clause for at least one option", () => {
    // The load-bearing wiring: a wrong `get*PromptHint` would return "" for every
    // id. Require ≥1 non-empty hint so a mis-wire can't pass.
    for (const p of LOOK_PICKERS) {
      const hasHint = p.catalog.some((e) => p.getHint(e.id).length > 0)
      expect(hasHint, `${p.key} produced no non-empty hint`).toBe(true)
    }
  })

  // G3 — the PROJECTION-COMPLETENESS invariant. Studio folds no look clause
  // itself any more, so a picker without a `platformField` is a control the user
  // can set that reaches no model at all. Adding a picker without a mapping must
  // fail the build, not ship silently.
  it("every picker projects onto a real platform DirectionKey", () => {
    const projectable = [...LOOK_PICKERS, cameraMovementPicker()]
    for (const p of projectable) {
      expect(p.platformField, `${p.key} has no platformField`).toBeTruthy()
      expect(
        DIRECTION_KEYS,
        `${p.key} → ${p.platformField} is not a registry key`,
      ).toContain(p.platformField)
    }
    // Two pickers must never share one wire key — the second would overwrite the
    // first in the flat projection.
    const fields = projectable.map((p) => p.platformField)
    expect(new Set(fields).size).toBe(fields.length)
  })

  it("Character FX is THE documented exception — and stays one", () => {
    // The platform registry excludes `characterFx` by design ("a per-shot
    // composer with catalog timing levers positioned at an in-prose effect
    // token; a single-id channel cannot carry it"), so it keeps folding
    // client-side at its `[fx:…]` position. Named here so the invariant above
    // stays absolute for everything else.
    expect(characterFxPicker().platformField).toBeUndefined()
    expect(DIRECTION_KEYS).not.toContain("characterFx")
    expect(LOOK_PICKERS.some((p) => p.key === CHARACTER_FX_KEY)).toBe(false)
  })

  it("each picker's surface and cap agree with its platform row", () => {
    // A studio-side cap wider than the wire's `maxPicks` would silently drop the
    // extra pick at render; a picker shown on a stage the registry calls
    // off-surface would fold nothing.
    for (const p of [...LOOK_PICKERS, cameraMovementPicker()]) {
      const row = platformRow(p.platformField!)
      expect(row, `${p.key} → ${p.platformField}`).toBeTruthy()
      expect(p.maxPicks ?? 1, `${p.key} maxPicks`).toBeLessThanOrEqual(row!.maxPicks)
      if (p.surface !== "both") {
        expect([p.surface, "both"], `${p.key} surface`).toContain(row!.surface)
      }
    }
  })

  it("categorized pickers cover every entry's category in their order", () => {
    // groupByCategory renders ONLY categories in `order`; an entry whose category
    // is absent would be silently dropped from the grid.
    for (const p of LOOK_PICKERS) {
      if (!p.categories) continue
      const order = new Set(p.categories.order)
      for (const e of p.catalog) {
        const cat = p.categories.categoryOf(e)
        expect(order.has(cat), `${p.key}: category "${cat}" missing from order`).toBe(true)
      }
    }
  })

  it("every picker belongs to a known UI group", () => {
    const groups = new Set(LOOK_GROUP_ORDER)
    for (const p of LOOK_PICKERS) {
      expect(groups.has(p.group), `${p.key} group ${p.group}`).toBe(true)
    }
  })
})

describe("LOOK_PICKERS — per-stage surface filtering", () => {
  it("image stage excludes video-only pickers (and vice versa)", () => {
    const image = pickersForSurface("image")
    const video = pickersForSurface("video")
    expect(image.every((p) => p.surface !== "video")).toBe(true)
    expect(video.every((p) => p.surface !== "image")).toBe(true)
    // "both" pickers appear on both stages.
    const both = LOOK_PICKERS.filter((p) => p.surface === "both")
    expect(image).toEqual(expect.arrayContaining(both))
    expect(video).toEqual(expect.arrayContaining(both))
  })

  it("only the video stage exposes the Motion & Time group", () => {
    const imageGroups = groupedPickersForSurface("image").map((g) => g.group)
    const videoGroups = groupedPickersForSurface("video").map((g) => g.group)
    expect(imageGroups).not.toContain("motion")
    expect(videoGroups).toContain("motion")
  })

  it("grouped sections preserve the canonical group order and are non-empty", () => {
    for (const surface of ["image", "video"] as const) {
      const sections = groupedPickersForSurface(surface)
      // Each section has pickers.
      for (const s of sections) expect(s.pickers.length).toBeGreaterThan(0)
      // Order is a subsequence of LOOK_GROUP_ORDER.
      const idx = sections.map((s) => LOOK_GROUP_ORDER.indexOf(s.group))
      const sorted = [...idx].sort((a, b) => a - b)
      expect(idx).toEqual(sorted)
    }
  })
})

describe("LOOK_PICKERS — multi-pick dimensions", () => {
  // Exactly the dimensions Nodaro lets you blend (cap 2). Pinned so a registry
  // edit can't silently drop multi-pick from one, or add it to a single-pick
  // catalog whose fold can't compose arrays.
  const MULTI_KEYS = [
    "framingCompositionId",
    "lighting-style",
    "moodId",
    "atmosphereId",
    "actionFxId",
    "aestheticId",
    "photographerId",
    "postProcessId",
    "transitionId",
  ]

  it("marks exactly the expected dimensions multi-pick, capped at 2", () => {
    const multi = LOOK_PICKERS.filter((p) => p.multi).map((p) => p.key)
    expect(new Set(multi)).toEqual(new Set(MULTI_KEYS))
    for (const p of LOOK_PICKERS) {
      if (p.multi) expect(p.maxPicks, p.key).toBe(2)
    }
  })

  it("every multi-pick dimension rides the wire as an array the route honors", () => {
    // Arrays go server-side now; the platform slices at its own `maxPicks`, so a
    // studio cap wider than the wire's would silently lose a pick.
    for (const p of LOOK_PICKERS) {
      if (!p.multi) continue
      const row = platformRow(p.platformField!)
      expect(row!.maxPicks, `${p.key} → ${p.platformField}`).toBeGreaterThanOrEqual(
        p.maxPicks ?? 2,
      )
    }
  })
})

/**
 * The COMPACT half of every picker is wired by hand exactly like the hint half
 * (one `get*Term` per row), so it has the same failure mode: a getter pointed at
 * the wrong catalog returns "" for every id, or — the copy-paste slip a
 * non-empty check would miss — someone pastes the HINT getter into `getTerm`
 * and the "compact" mode silently stays verbose. Both are caught below.
 */
describe("LOOK_PICKERS — compact term wiring", () => {
  it("every picker resolves a term that is non-empty AND not its own hint", () => {
    for (const p of LOOK_PICKERS) {
      const real = p.catalog.filter((e) => p.getTerm(e.id).length > 0)
      expect(real.length, `${p.key} produced no non-empty term`).toBeGreaterThan(0)
      const distinct = real.some((e) => p.getTerm(e.id) !== p.getHint(e.id))
      expect(distinct, `${p.key} term getter looks copy-pasted from getHint`).toBe(
        true,
      )
    }
  })

  it("a term is SHORT — never the paragraph the hint injects", () => {
    // The platform caps an authored term at TERM_MAX_CHARS (60); a derived one
    // is a lowercased label. Either way it must never be sentence-length.
    for (const p of LOOK_PICKERS) {
      for (const e of p.catalog) {
        const term = p.getTerm(e.id)
        expect(term.length, `${p.key}/${e.id}: "${term}"`).toBeLessThanOrEqual(60)
      }
    }
  })

  it("an entry that injects NOTHING injects nothing in both modes", () => {
    // A no-op ("auto"/"none") entry has an empty hint; its term must be empty
    // too, or compact mode would resurrect a dimension the user turned off.
    for (const p of LOOK_PICKERS) {
      for (const e of p.catalog) {
        if (p.getHint(e.id).length === 0) {
          expect(p.getTerm(e.id), `${p.key}/${e.id}`).toBe("")
        }
      }
    }
  })

  it("the standalone Camera Movement picker carries both halves too", () => {
    const movement = cameraMovementPicker()
    expect(movement.group).toBe("motion")
    const real = movement.catalog.filter((m) => movement.getTerm(m.id).length > 0)
    expect(real.length).toBeGreaterThan(0)
    expect(real.some((m) => movement.getTerm(m.id) !== movement.getHint(m.id))).toBe(
      true,
    )
  })
})

describe("LOOK_PICKERS — mode resolution", () => {
  const SPLIT = { look: "full", motion: "compact" } as const

  it("a bare mode applies to EVERY picker", () => {
    for (const p of LOOK_PICKERS) {
      expect(modeForPicker(p, "full"), p.key).toBe("full")
      expect(modeForPicker(p, "compact"), p.key).toBe("compact")
    }
  })

  it("a split mode is decided by the registry's own group — nothing hardcoded", () => {
    for (const p of LOOK_PICKERS) {
      expect(modeForPicker(p, SPLIT), p.key).toBe(
        p.group === "motion" ? "compact" : "full",
      )
    }
    // The Motion & Time group is a real, non-empty family (else the split above
    // would be vacuously satisfied by a registry with no motion pickers).
    expect(LOOK_PICKERS.some((p) => p.group === "motion")).toBe(true)
  })

  it("pickerFragment picks the term in compact and the hint in full", () => {
    const motion = LOOK_PICKERS.find((p) => p.group === "motion")!
    const id = motion.catalog.find((e) => motion.getTerm(e.id).length > 0)!.id
    expect(pickerFragment(motion, id, SPLIT)).toBe(motion.getTerm(id))
    expect(pickerFragment(motion, id, "full")).toBe(motion.getHint(id))
  })

  it("a cleared pill injects nothing in either mode", () => {
    for (const p of LOOK_PICKERS) {
      expect(pickerFragment(p, undefined, "full"), p.key).toBe("")
      expect(pickerFragment(p, "", "compact"), p.key).toBe("")
    }
  })

  it("the standalone Camera Movement picker resolves under the same policy", () => {
    const movement = cameraMovementPicker()
    const id = movement.catalog.find((m) => movement.getTerm(m.id).length > 0)!.id
    // Camera Movement declares group "motion", so the split policy compacts it —
    // and the projection sends its id, which the route folds under exactly this
    // policy (VIDEO_HINT_MODE === VIDEO_HINT_MODE_DEFAULT).
    expect(pickerFragment(movement, id, SPLIT)).toBe(movement.getTerm(id))
    expect(pickerFragment(movement, id, "full")).toBe(movement.getHint(id))
    expect(pickerFragment(movement, undefined, SPLIT)).toBe("")
  })
})
