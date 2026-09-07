/**
 * The `stills` section — `set_active_still` and `rename_still_result`, plus
 * the receipts and the refusal shape the whole section shares.
 *
 * One of three siblings carrying the ported still suite; the harness, and the
 * doc comment that explains the port, live in
 * `./helpers/stills-fixtures.ts`. The assertions here are untouched.
 */

import { describe, expect, it } from "vitest"
import type { Shot } from "../../shot"
import { OpError, isOpError } from "../errors"
import type { Production } from "../production"
import { stillsHandlers } from "../sections/stills"

import {
  addStill,
  ctx,
  empty,
  keyAt,
  removeStill,
  renameStill,
  resetCtx,
  setActive,
  stillOnly,
} from "./helpers/stills-fixtures"

// ── setActiveStillResult (production-store.test.ts L554) ────────────────────

describe("set_active_still", () => {
  const seedTwo = (): Production => {
    let p = addStill(empty("s1"), "s1", {
      url: "https://r2/1.png",
      provider: "p",
      prompt: "q",
    }).production
    p = addStill(p, "s1", { url: "https://r2/2.png", provider: "p", prompt: "q" })
      .production
    return p
  }

  /** The clip an `addShotClipResult` would have left — the `clips` section's op. */
  const withClip = (production: Production): Production => ({
    ...production,
    shots: production.shots.map((shot) => ({
      ...shot,
      clip: {
        nodeId: `generate-video-${shot.id}`,
        url: "https://r2/c.mp4",
        provider: "grok-i2v",
        prompt: "move",
      },
    })),
  })

  it("picks an existing result as active (updates url) and KEEPS the clip", () => {
    const seeded = withClip(seedTwo())
    const p = setActive(seeded, "s1", keyAt(seeded, 0, 0)).production
    const shot = p.shots[0]
    expect(shot.still?.activeIndex).toBe(0)
    expect(shot.still?.url).toBe("https://r2/1.png")
    expect(shot.clip?.url).toBe("https://r2/c.mp4") // browsing keeps the clip
  })

  it("is a no-op for an already-active result (same reference), and REFUSES an unknown one", () => {
    const before = seedTwo() // active = 1
    const active = stillsHandlers.set_active_still(
      before,
      { op: "set_active_still", shotId: "s1", result: keyAt(before, 0, 1) },
      ctx,
    )
    expect(Object.is(before, active.production)).toBe(true)
    expect(active.warnings?.length).toBeGreaterThan(0)

    // PORT NOTE: the reducer no-opped on an out-of-range INDEX; a `ResultKey`
    // that names nothing is a missing target instead (contract rule 5).
    expect(() => setActive(before, "s1", "https://r2/9.png")).toThrow(OpError)
  })

  // A loaded / legacy shot (no explicit `startFrame`) with ≥2 results — exactly
  // the shape that LEAKED the start frame before the anchor (the effective start
  // frame is `startFrame ?? still.url`, so switching the active still moved it).
  const loadedMultiNoStart = (id: string): Shot => ({
    id,
    still: {
      nodeId: `generate-image-${id}`,
      url: "https://r2/2.png", // active = the 2nd result
      provider: "p",
      prompt: "q",
      results: [{ url: "https://r2/1.png" }, { url: "https://r2/2.png" }],
      activeIndex: 1,
    },
  })

  it("(#7) anchors an UNSET startFrame to the OUTGOING still — select never moves it", () => {
    const before: Production = { shots: [loadedMultiNoStart("a")] }
    expect(before.shots[0].startFrame).toBeUndefined()
    // Select result 0 (a different result). Before the fix the effective start
    // frame would silently follow to result 0; now it anchors to the OUTGOING
    // active still (result 1) so the effective start frame stays put.
    const p = setActive(before, "a", "https://r2/1.png").production
    const shot = p.shots[0]
    expect(shot.still?.url).toBe("https://r2/1.png") // active still DID move…
    expect(shot.startFrame).toBe("https://r2/2.png") // …start frame anchored to the OUTGOING still
    expect(shot.startFrame).not.toBe("https://r2/1.png") // never the newly-selected url
  })

  it("(#7) leaves an EXPLICIT startFrame untouched on select", () => {
    const before: Production = {
      shots: [{ ...loadedMultiNoStart("a"), startFrame: "https://r2/pinned.png" }],
    }
    const p = setActive(before, "a", "https://r2/1.png").production
    const shot = p.shots[0]
    expect(shot.still?.url).toBe("https://r2/1.png") // active still moved
    expect(shot.startFrame).toBe("https://r2/pinned.png") // explicit pin survives untouched
  })
})

// ── setStillResultName (production-store.test.ts L247) ──────────────────────

describe("rename_still_result", () => {
  const seed = () =>
    addStill(empty("s1"), "s1", {
      url: "https://r2/1.png",
      provider: "p",
      prompt: "q",
    }).production

  it("sets a trimmed custom name + KEEPS a lone named result's list", () => {
    const p = renameStill(seed(), "s1", "https://r2/1.png", "  Hero astronaut  ").production
    const still = p.shots[0].still
    expect(still?.results?.[0]?.name).toBe("Hero astronaut")
    // A lone NAMED still must keep its results list (else the name collapses away).
    expect(still?.results).toHaveLength(1)
  })

  it("clears the name on a blank value (reverts to the minimal shape)", () => {
    let p = renameStill(seed(), "s1", "https://r2/1.png", "Hero").production
    p = renameStill(p, "s1", "https://r2/1.png", "   ").production // blank → clear
    const still = p.shots[0].still
    expect(still?.results).toBeUndefined() // bare lone result collapses again
    expect(still?.url).toBe("https://r2/1.png")
  })

  it("is immutable + a no-op for an unchanged name; REFUSES an unknown shot/result", () => {
    const before = renameStill(seed(), "s1", "https://r2/1.png", "Hero").production
    const unchanged = renameStill(before, "s1", "https://r2/1.png", "Hero")
    expect(Object.is(before, unchanged.production)).toBe(true)
    expect(unchanged.warnings?.length).toBeGreaterThan(0)

    // PORT NOTE: the reducer no-opped on both; an operation refuses (rule 5).
    expect(() => renameStill(before, "s1", "https://r2/9.png", "X")).toThrow(OpError)
    expect(() => renameStill(before, "nope", "https://r2/1.png", "X")).toThrow(OpError)
  })
})

// ── the receipts ────────────────────────────────────────────────────────────

describe("receipts", () => {
  it("names the op, the result and the shot in the user's words", () => {
    const added = addStill(empty("s1"), "s1", {
      url: "https://r2/1.png",
      provider: "p",
      prompt: "q",
    })
    expect(added.receipt.op).toBe("add_still_result")
    expect(added.receipt.summary).toContain("Scene 1")
    // No ids in the prose (SECTIONS.md's receipt style).
    expect(added.receipt.summary).not.toContain("s1")

    const deleted = removeStill(added.production, "s1", "https://r2/1.png")
    expect(deleted.receipt.op).toBe("remove_still_result")
    expect(deleted.receipt.summary).toContain("in the bin")
  })

  it("uses the shot's own NAME when it has one", () => {
    const production: Production = {
      shots: [{ ...stillOnly("a"), name: "Rooftop" }],
    }
    const renamed = renameStill(production, "a", "https://r2.example/a.png", "Hero")
    expect(renamed.receipt.summary).toContain("Rooftop")
  })
})

// ── the failure shape ───────────────────────────────────────────────────────

describe("refusals", () => {
  it("raises op_target_missing with no opIndex (the batch stamps it)", () => {
    try {
      setActive({ shots: [stillOnly("a")] }, "nope", "u")
      expect.unreachable()
    } catch (error) {
      expect(isOpError(error)).toBe(true)
      if (!isOpError(error)) throw error
      expect(error.code).toBe("op_target_missing")
      expect(error.opIndex).toBeUndefined()
    }
  })

  it("refuses a still-less shot rather than inventing one", () => {
    expect(() => setActive({ shots: [{ id: "a" }] }, "a", "u")).toThrow(OpError)
    expect(() => removeStill({ shots: [{ id: "a" }] }, "a", "u")).toThrow(OpError)
    expect(() => renameStill({ shots: [{ id: "a" }] }, "a", "u", "X")).toThrow(OpError)
  })
})

// Reset the id counter between files' worth of runs (vitest isolates modules,
// but the harness is explicit about it so a receipt id assertion cannot drift).
resetCtx()
