/**
 * The `clips` section — `remove_clip_result` and the bin it fills.
 *
 * One of three siblings carrying the ported clip suite; the harness, and the
 * doc comment that explains the port, live in
 * `./helpers/clips-fixtures.ts`. The assertions here are untouched.
 */

import { describe, expect, it } from "vitest"
import { buildClip } from "../../shot"
import type { ShotClipResult } from "../../shot"
import type { Production } from "../production"

import {
  add,
  expectRefused,
  NOW,
  prod,
  removeResult,
  stillOnly,
} from "./helpers/clips-fixtures"

describe("remove_clip_result (removeShotClipResult)", () => {
  /** Seed a shot with `n` clip results (active = the last/newest). */
  const seedN = (n: number): Production => {
    let p = prod([stillOnly("a")])
    for (let i = 1; i <= n; i++) {
      p = add(p, "a", { url: `https://r2/${i}.mp4` })
    }
    return p
  }

  it("removes a NON-active result and shifts the active index left", () => {
    let p = seedN(3) // results 1,2,3 — active = 2 (the 3rd)
    p = removeResult(p, "a", "https://r2/1.mp4") // drop the FIRST (non-active) result
    const clip = p.shots[0].clip
    expect(clip?.results?.map((r) => r.url)).toEqual([
      "https://r2/2.mp4",
      "https://r2/3.mp4",
    ])
    // The active clip followed its result (index 2 → 1), url unchanged.
    expect(clip?.activeIndex).toBe(1)
    expect(clip?.url).toBe("https://r2/3.mp4")
  })

  it("removing the ACTIVE result clamps onto a neighbor", () => {
    let p = seedN(3) // active = 2 (the 3rd/newest)
    p = removeResult(p, "a", "https://r2/3.mp4") // drop the active (last) result
    const clip = p.shots[0].clip
    expect(clip?.results?.map((r) => r.url)).toEqual([
      "https://r2/1.mp4",
      "https://r2/2.mp4",
    ])
    expect(clip?.activeIndex).toBe(1) // clamped to the new last
    expect(clip?.url).toBe("https://r2/2.mp4")
  })

  it("collapses to the minimal single shape when one result remains", () => {
    let p = seedN(2) // results 1,2 — active = 1
    p = removeResult(p, "a", "https://r2/2.mp4")
    const clip = p.shots[0].clip
    expect(clip?.url).toBe("https://r2/1.mp4")
    expect(clip?.results).toBeUndefined() // back to the lone-result legacy shape
    expect(clip?.activeIndex).toBeUndefined()
  })

  it("clears the clip (keeping the still) when the ONLY result is removed", () => {
    let p = prod([stillOnly("a")])
    p = add(p, "a", { url: "https://r2/1.mp4" })
    p = removeResult(p, "a", "https://r2/1.mp4")
    const shot = p.shots[0]
    expect(shot.clip).toBeUndefined()
    expect("clip" in shot).toBe(false)
    expect(shot.still?.url).toBe("https://r2.example/a.png") // the still survives
  })

  it("returns a NEW array (copy-on-write) and REFUSES an unknown shot / key", () => {
    // CONVERTED: the reducer no-ops on an unknown shot and a bad index; the
    // operation refuses both (rule 5). The copy-on-write half is unchanged.
    const before = seedN(2)
    const after = removeResult(before, "a", "https://r2/1.mp4")
    expect(Object.is(before.shots, after.shots)).toBe(false)
    // The prior snapshot was not mutated in place.
    expect(before.shots[0].clip?.results?.map((r) => r.url)).toEqual([
      "https://r2/1.mp4",
      "https://r2/2.mp4",
    ])

    expectRefused(() => removeResult(after, "nope", "https://r2/2.mp4"), "op_target_missing")
    expectRefused(() => removeResult(after, "a", "https://r2/9.mp4"), "op_target_missing")
  })
})

// ── the bin (ported from `src/store/trash.test.ts`) ─────────────────────────

/** A clip result with the full restore context a clip-select depends on. */
function result(url: string, over: Partial<ShotClipResult> = {}): ShotClipResult {
  return {
    url,
    jobId: `job-${url}`,
    prompt: `prompt for ${url}`,
    provider: "seedance-2",
    duration: 5,
    startFrameUrl: `https://cdn/${url}-start.png`,
    ...over,
  }
}

/** One shot carrying `n` clip results, active on the last. */
function seedShot(shotId: string, results: ReadonlyArray<ShotClipResult>): Production {
  return prod([
    {
      id: shotId,
      name: "Rooftop chase",
      still: {
        nodeId: `img-${shotId}`,
        url: "https://cdn/still.png",
        provider: "gpt-image-2",
        prompt: "a still",
      },
      clip: buildClip(
        { nodeId: `vid-${shotId}`, provider: "seedance-2", prompt: "clip prompt" },
        results,
        results.length - 1,
      ),
    },
  ])
}

/** The bin entry at `i`, narrowed to a CLIP entry (the union also holds shots). */
function clipEntry(production: Production, i: number) {
  const entry = production.trash?.[i]
  if (!entry || entry.kind !== "clip") {
    throw new Error(`expected a clip entry at ${i}, got ${entry?.kind ?? "nothing"}`)
  }
  return entry
}

describe("deleting a clip fills the bin", () => {
  it("keeps the shot behavior AND preserves the result losslessly", () => {
    const a = result("a.mp4")
    const b = result("b.mp4")
    let p = seedShot("s1", [a, b])

    p = removeResult(p, "s1", "job-a.mp4")

    // The shot lost exactly that clip (existing behavior, unchanged).
    const clip = p.shots[0]!.clip!
    expect(clip.results?.map((r) => r.url) ?? [clip.url]).toEqual(["b.mp4"])
    // …and the bin holds it with every restore field intact.
    expect(p.trash).toHaveLength(1)
    const entry = clipEntry(p, 0)
    expect(entry.result).toEqual(a)
    expect(entry.shotId).toBe("s1")
    expect(entry.shotName).toBe("Rooftop chase")
    expect(entry.index).toBe(0)
    expect(entry.clipBase.nodeId).toBe("vid-s1")
    expect(entry.deletedAt).toBeTruthy()
  })

  it("records the clip node id when the LAST result is deleted (the clip is gone)", () => {
    let p = seedShot("s1", [result("only.mp4")])

    p = removeResult(p, "s1", "job-only.mp4")

    // The shot keeps its still, loses the clip entirely — and the bin still knows
    // which node to rebuild on restore.
    expect(p.shots[0]!.clip).toBeUndefined()
    expect(p.shots[0]!.still).toBeDefined()
    expect(clipEntry(p, 0).clipBase.nodeId).toBe("vid-s1")
  })

  it("adds nothing to the bin for a refused deletion", () => {
    // CONVERTED from "adds nothing to the bin for a no-op deletion": both calls
    // now REFUSE (rule 5), and the document — bin included — is untouched.
    const p = seedShot("s1", [result("a.mp4")])
    expectRefused(() => removeResult(p, "s1", "job-nope.mp4"), "op_target_missing")
    expectRefused(() => removeResult(p, "nope", "job-a.mp4"), "op_target_missing")
    expect(p.trash ?? []).toEqual([])
  })

  it("stamps the entry from ctx — never a clock or a random id", () => {
    // Not a port: the package's own rule (no `Date.now()`, no `crypto`). The
    // entry's id and timestamp are exactly what the caller injected.
    const p = removeResult(seedShot("s1", [result("a.mp4")]), "s1", "job-a.mp4")
    const entry = clipEntry(p, 0)
    expect(entry.id).toBe("trash-1")
    expect(entry.deletedAt).toBe(NOW)
  })
})
