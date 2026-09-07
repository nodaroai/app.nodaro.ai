/**
 * The `stills` section — `remove_still_result` and the bin it fills.
 *
 * One of three siblings carrying the ported still suite; the harness, and the
 * doc comment that explains the port, live in
 * `./helpers/stills-fixtures.ts`. The assertions here are untouched.
 */

import { describe, expect, it } from "vitest"
import type { Shot } from "../../shot"
import { TRASH_LIMIT } from "../../trash"
import { OpError } from "../errors"
import type { Production } from "../production"

import { addStill, empty, keyAt, removeStill, resetCtx } from "./helpers/stills-fixtures"

// ── removeShotStillResult (production-store.test.ts L621) ───────────────────

describe("remove_still_result", () => {
  /** Seed a shot with `n` results (active = the last/newest). */
  const seedN = (n: number): Production => {
    let p = empty("s1")
    for (let i = 1; i <= n; i++) {
      p = addStill(p, "s1", {
        url: `https://r2/${i}.png`,
        provider: "p",
        prompt: "q",
      }).production
    }
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

  it("removes a NON-active result, shifts the active index left, and KEEPS the clip", () => {
    const seeded = withClip(seedN(3)) // results 1,2,3 — active = 2 (the 3rd)
    const p = removeStill(seeded, "s1", keyAt(seeded, 0, 0)).production // drop the FIRST (non-active) result
    const still = p.shots[0].still
    expect(still?.results?.map((r) => r.url)).toEqual([
      "https://r2/2.png",
      "https://r2/3.png",
    ])
    // The active frame followed its result (index 2 → 1), url unchanged.
    expect(still?.activeIndex).toBe(1)
    expect(still?.url).toBe("https://r2/3.png")
    expect(p.shots[0].clip?.url).toBe("https://r2/c.mp4") // non-active removal keeps it
  })

  it("removing the ACTIVE result clamps onto a neighbor and KEEPS the clip", () => {
    const seeded = withClip(seedN(3)) // active = 2 (the 3rd/newest)
    const p = removeStill(seeded, "s1", keyAt(seeded, 0, 2)).production // drop the active (last) result
    const still = p.shots[0].still
    expect(still?.results?.map((r) => r.url)).toEqual([
      "https://r2/1.png",
      "https://r2/2.png",
    ])
    expect(still?.activeIndex).toBe(1) // clamped to the new last
    expect(still?.url).toBe("https://r2/2.png")
    // Videos are independent artifacts: each clip result remembers its own
    // source frames, so deleting an image never deletes the clip history.
    expect(p.shots[0].clip?.url).toBe("https://r2/c.mp4")
  })

  it("collapses to the minimal single shape when one result remains", () => {
    const seeded = seedN(2) // results 1,2 — active = 1
    const p = removeStill(seeded, "s1", keyAt(seeded, 0, 1)).production
    const still = p.shots[0].still
    expect(still?.url).toBe("https://r2/1.png")
    expect(still?.results).toBeUndefined() // back to the lone-result legacy shape
    expect(still?.activeIndex).toBeUndefined()
  })

  it("clears the still but KEEPS the clip when the ONLY result is removed", () => {
    const seeded = withClip(
      addStill(empty("s1"), "s1", {
        url: "https://r2/1.png",
        provider: "p",
        prompt: "q",
      }).production,
    )
    const p = removeStill(seeded, "s1", "https://r2/1.png").production
    const shot = p.shots[0]
    expect(shot.still).toBeUndefined()
    expect("still" in shot).toBe(false)
    // The clip survives still-less (same shape as a references-mode clip) —
    // deleting images never deletes videos.
    expect(shot.clip?.url).toBe("https://r2/c.mp4")
  })

  it("returns a NEW production (copy-on-write) and REFUSES an unknown shot / result", () => {
    const before = seedN(2)
    const after = removeStill(before, "s1", keyAt(before, 0, 0)).production
    expect(Object.is(before, after)).toBe(false)
    // The prior snapshot was not mutated in place.
    expect(before.shots[0].still?.results?.map((r) => r.url)).toEqual([
      "https://r2/1.png",
      "https://r2/2.png",
    ])

    // PORT NOTE: both were silent no-ops on the reducer; an operation refuses.
    expect(() => removeStill(after, "nope", "https://r2/1.png")).toThrow(OpError)
    expect(() => removeStill(after, "s1", "https://r2/9.png")).toThrow(OpError)
  })
})

// ── the bin (production-store.trash-still.test.ts) ──────────────────────────

describe("deleting an image is recoverable", () => {
  const SHOT: Shot = {
    id: "s1",
    still: {
      nodeId: "generate-image-job1",
      url: "https://r2.example/b.png",
      provider: "nano-banana",
      prompt: "p",
      activeIndex: 1,
      results: [
        { url: "https://r2.example/a.png", name: "First" },
        { url: "https://r2.example/b.png", name: "Second" },
      ],
    },
  }

  it("moves the deleted image to the trash instead of dropping it", () => {
    const p = removeStill({ shots: [structuredClone(SHOT)] }, "s1", "https://r2.example/a.png")
      .production

    const { shots, trash = [] } = p
    expect(shots[0].still?.results).toHaveLength(1)
    expect(trash).toHaveLength(1)
    expect(trash[0].kind).toBe("still")
    const entry = trash[0]
    expect(entry && "result" in entry ? entry.result.url : undefined).toBe(
      "https://r2.example/a.png",
    )
  })

  it("keeps a deleted image recoverable even when it was the LAST one", () => {
    // (The restore half of the studio test belongs to the `trash` section.)
    const p = removeStill(
      {
        shots: [
          {
            id: "s1",
            still: {
              nodeId: "generate-image-job1",
              url: "https://r2.example/only.png",
              provider: "nano-banana",
              prompt: "p",
            },
          },
        ],
      },
      "s1",
      "https://r2.example/only.png",
    ).production

    expect(p.shots[0].still).toBeUndefined()
    expect(p.trash?.[0]).toBeDefined()
    const entry = p.trash![0]!
    expect(entry.kind).toBe("still")
    expect("result" in entry ? entry.result.url : undefined).toBe(
      "https://r2.example/only.png",
    )
    // The still's node identity rides along so a restore can rebuild it.
    expect("stillBase" in entry ? entry.stillBase.nodeId : undefined).toBe(
      "generate-image-job1",
    )
  })

  it("stamps the entry from the CONTEXT — never a clock or a random id", () => {
    const p = removeStill({ shots: [structuredClone(SHOT)] }, "s1", "https://r2.example/a.png")
      .production
    const entry = p.trash![0]!
    expect(entry.deletedAt).toBe("2026-09-06T12:00:00.000Z")
    expect(entry.id).toMatch(/^mint-\d+$/)
    expect(entry.index).toBe(0) // restore aims for the slot it held
  })

  it("caps the bin so the trash can't grow the save payload forever", () => {
    // A shot with far more results than the bin keeps.
    const results = Array.from({ length: TRASH_LIMIT + 10 }, (_, i) => ({
      url: `https://r2.example/img-${i}.png`,
      name: `Take ${i}`,
    }))
    let p: Production = {
      shots: [
        {
          ...structuredClone(SHOT),
          still: { ...SHOT.still!, activeIndex: 0, results },
        },
      ],
    }

    // Delete them one at a time, oldest deletion first.
    for (let i = 0; i < TRASH_LIMIT + 5; i++) {
      p = removeStill(p, "s1", keyAt(p, 0, 0)).production
    }

    const trash = p.trash ?? []
    expect(trash).toHaveLength(TRASH_LIMIT)
    // The OLDEST deletions were pruned; the newest survive.
    expect(trash.every((t) => t.kind === "still")).toBe(true)
    expect((trash.at(-1) as { result: { name?: string } }).result.name).toBe(
      `Take ${TRASH_LIMIT + 4}`,
    )
  })
})

// Reset the id counter between files' worth of runs (vitest isolates modules,
// but the harness is explicit about it so a receipt id assertion cannot drift).
resetCtx()
