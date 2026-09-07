/**
 * The TRASH section — `restore_trashed`, `purge_trashed`, `clear_trash`.
 *
 * Ported from the studio store's own bin suite (`src/store/trash.test.ts`
 * `describe("restoring")` / `describe("deleting a whole SHOT")` /
 * `describe("permanent deletion")`, and
 * `src/store/production-store.trash-still.test.ts`) with the assertions
 * UNCHANGED: the same slot, the same active take, the same rebuilt node id, the
 * same entry left in the bin when the shot is gone for good.
 *
 * Two things about the port are worth naming.
 *
 * The studio tests reach the bin by DELETING (`removeShotClipResult`,
 * `removeShotStillResult`, `removeShot`), and those reducers belong to the
 * `stills` / `clips` / `shots` sections, not to this one. The `bin*` helpers
 * below mirror them exactly (same entry fields, same `buildStill`/`buildClip`
 * repair, same `appendToTrash`) purely to produce the bin state these three
 * operations read — they are test fixtures, not a second implementation, and
 * the ops under test never see them.
 *
 * And the reducers answer `true`/`false`; an operation answers with a receipt
 * or an `OpError`. So `expect(restoreTrashedItem(id)).toBe(false)` becomes
 * `expect(() => …).toThrow(OpError)` — the call shape, exactly as the section
 * contract allows. Every assertion ABOUT THE DOCUMENT (what the shots hold,
 * what stays in the bin) is verbatim, and a throw leaves the input production
 * untouched, so those assertions hold either way.
 */
import { beforeEach, describe, expect, it } from "vitest"

import type { Shot, ShotClipResult, ShotStillResult } from "../../shot"
import {
  buildClip,
  buildStill,
  clipResults,
  stillResults,
} from "../../shot"
import type { ShotClip } from "../../shot"
import { serializeProduction } from "../../shot-graph"
import type { ShotStill } from "../../shot-still"
import type { TrashedClip, TrashedShot, TrashedStill } from "../../trash"
import { appendToTrash, TRASH_LIMIT } from "../../trash"
import { isOpError, OpError } from "../errors"
import type { Production } from "../production"
import { trashHandlers, trashOpClasses, trashOpSchemas } from "../sections/trash"
import type { OpContext } from "../types"

// ── the injected context: no clock, no randomness ───────────────────────────

const ctx: OpContext = {
  now: "2026-09-06T12:00:00.000Z",
  mintId: () => "never-minted-here",
}

/** Deterministic ids for the seeded bin entries (the store uses `randomUUID`). */
let seq = 0
const nextTrashId = () => `trash-${++seq}`

beforeEach(() => {
  seq = 0
})

// ── fixtures, mirroring the studio suite's own ──────────────────────────────

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
function seedShot(
  shotId: string,
  results: ReadonlyArray<ShotClipResult>,
): Production {
  return {
    shots: [
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
    ],
    selectedShotId: shotId,
    trash: [],
  }
}

// ── the deletion half, mirrored (it belongs to the other sections) ──────────

/** `removeShotClipResult(shotId, index)`, as a pure production → production. */
function binClipResult(
  production: Production,
  shotId: string,
  index: number,
): Production {
  let entry: TrashedClip | undefined
  const shots = production.shots.map((shot) => {
    if (shot.id !== shotId || !shot.clip) return shot
    const results = clipResults(shot.clip)
    if (index < 0 || index >= results.length) return shot
    entry = {
      kind: "clip",
      id: nextTrashId(),
      shotId,
      ...(shot.name ? { shotName: shot.name } : {}),
      index,
      deletedAt: ctx.now,
      clipBase: {
        nodeId: shot.clip.nodeId,
        ...(shot.clip.provider ? { provider: shot.clip.provider } : {}),
        ...(shot.clip.prompt ? { prompt: shot.clip.prompt } : {}),
      },
      result: results[index]!,
    }
    const remaining = [...results.slice(0, index), ...results.slice(index + 1)]
    if (remaining.length === 0) {
      const next = { ...shot }
      delete (next as { clip?: ShotClip }).clip
      return next
    }
    const prevActive = shot.clip.activeIndex ?? 0
    const nextActive =
      prevActive > index ? prevActive - 1 : Math.min(prevActive, remaining.length - 1)
    return { ...shot, clip: buildClip(shot.clip, remaining, nextActive) }
  })
  if (!entry) return production
  return { ...production, shots, trash: [...appendToTrash(production.trash ?? [], entry)] }
}

/** `removeShotStillResult(shotId, index)`, same treatment. */
function binStillResult(
  production: Production,
  shotId: string,
  index: number,
): Production {
  let entry: TrashedStill | undefined
  const shots = production.shots.map((shot) => {
    if (shot.id !== shotId || !shot.still) return shot
    const results = stillResults(shot.still)
    if (index < 0 || index >= results.length) return shot
    entry = {
      kind: "still",
      id: nextTrashId(),
      shotId,
      ...(shot.name ? { shotName: shot.name } : {}),
      index,
      deletedAt: ctx.now,
      stillBase: {
        nodeId: shot.still.nodeId,
        ...(shot.still.provider ? { provider: shot.still.provider } : {}),
        ...(shot.still.prompt ? { prompt: shot.still.prompt } : {}),
      },
      result: results[index]!,
    }
    const remaining = [...results.slice(0, index), ...results.slice(index + 1)]
    if (remaining.length === 0) {
      const next = { ...shot }
      delete (next as { still?: ShotStill }).still
      return next
    }
    const prevActive = shot.still.activeIndex ?? 0
    const nextActive =
      prevActive > index ? prevActive - 1 : Math.min(prevActive, remaining.length - 1)
    return { ...shot, still: buildStill(shot.still, remaining, nextActive) }
  })
  if (!entry) return production
  return { ...production, shots, trash: [...appendToTrash(production.trash ?? [], entry)] }
}

/** `removeShot(id)`, same treatment — the shot as a one-shot mini-graph. */
function binShot(production: Production, id: string): Production {
  const index = production.shots.findIndex((s) => s.id === id)
  if (index < 0) return production
  const doomed = production.shots[index]!
  const entry: TrashedShot = {
    kind: "shot",
    id: nextTrashId(),
    shotId: doomed.id,
    ...(doomed.name ? { shotName: doomed.name } : {}),
    index,
    deletedAt: ctx.now,
    graph: serializeProduction([doomed], doomed.id),
  }
  return {
    ...production,
    shots: production.shots.filter((s) => s.id !== id),
    trash: [...appendToTrash(production.trash ?? [], entry)],
  }
}

// ── the ops under test ──────────────────────────────────────────────────────

const restore = (production: Production, trashId: string) =>
  trashHandlers.restore_trashed(production, { op: "restore_trashed", trashId }, ctx)

const purge = (production: Production, trashId: string) =>
  trashHandlers.purge_trashed(production, { op: "purge_trashed", trashId }, ctx)

const clear = (production: Production) =>
  trashHandlers.clear_trash(production, { op: "clear_trash" }, ctx)

/** The code an `OpError` thrown by `run` carries. */
function refusedCode(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (!isOpError(error)) throw error
    return error.code
  }
  throw new Error("expected the operation to be refused")
}

describe("restore_trashed — a clip result", () => {
  it("puts the clip back in its original slot and makes it active", () => {
    const seeded = seedShot("s1", [result("a.mp4"), result("b.mp4"), result("c.mp4")])
    const binned = binClipResult(seeded, "s1", 1) // drop the middle one

    const entry = binned.trash![0]!
    const { production } = restore(binned, entry.id)

    const clip = production.shots[0]!.clip!
    expect(clip.results!.map((r) => r.url)).toEqual(["a.mp4", "b.mp4", "c.mp4"])
    expect(clip.activeIndex).toBe(1)
    expect(clip.url).toBe("b.mp4")
    // Restored entries leave the bin.
    expect(production.trash).toEqual([])
  })

  it("rebuilds the clip when every result had been deleted", () => {
    const seeded = seedShot("s1", [result("only.mp4")])
    const binned = binClipResult(seeded, "s1", 0)
    expect(binned.shots[0]!.clip).toBeUndefined()

    const { production } = restore(binned, binned.trash![0]!.id)

    const clip = production.shots[0]!.clip!
    expect(clip.nodeId).toBe("vid-s1") // the SAME node, so the graph round-trips
    expect(clip.url).toBe("only.mp4")
  })

  it("refuses — changing nothing — when the shot is gone for good, and keeps the entry", () => {
    const seeded = seedShot("s1", [result("a.mp4"), result("b.mp4")])
    const binned = binClipResult(seeded, "s1", 0)
    const entry = binned.trash![0]!
    const stranded = binShot(binned, "s1")
    // Deleting the shot bins it too, so it could still come back. Purge that
    // entry to reach the genuinely-stranded case.
    const { production: after } = purge(
      stranded,
      stranded.trash!.find((t) => t.kind === "shot")!.id,
    )

    expect(refusedCode(() => restore(after, entry.id))).toBe("op_invalid")
    // Still listed, so the media stays reachable (and purgeable) rather than
    // silently vanishing.
    expect(after.trash).toHaveLength(1)
    expect(after.shots).toEqual([])
  })

  it("is refused for an unknown entry", () => {
    const seeded = seedShot("s1", [result("a.mp4")])
    expect(refusedCode(() => restore(seeded, "nope"))).toBe("op_target_missing")
    expect(() => restore(seeded, "nope")).toThrow(OpError)
  })

  it("leaves the input production untouched", () => {
    const seeded = seedShot("s1", [result("a.mp4"), result("b.mp4")])
    const binned = binClipResult(seeded, "s1", 0)
    const before = structuredClone(binned)

    const { production } = restore(binned, binned.trash![0]!.id)

    expect(production).not.toBe(binned)
    expect(binned).toEqual(before)
  })

  it("names the take and its shot in the receipt", () => {
    const seeded = seedShot("s1", [result("a.mp4"), result("b.mp4")])
    const binned = binClipResult(seeded, "s1", 1)

    const { receipt } = restore(binned, binned.trash![0]!.id)

    expect(receipt.op).toBe("restore_trashed")
    expect(receipt.summary).toBe("Restored clip take 2 of “Rooftop chase”.")
  })
})

describe("restore_trashed — a still result", () => {
  /** The shot the still suite deletes from: two images, active on the second. */
  const STILL_SHOT: Shot = {
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

  const seedStills = (): Production => ({
    shots: [structuredClone(STILL_SHOT)],
    selectedShotId: "s1",
    trash: [],
  })

  it("restores it into its original slot and clears the bin entry", () => {
    const binned = binStillResult(seedStills(), "s1", 0)
    const id = binned.trash![0]!.id

    const { production } = restore(binned, id)

    const { shots, trash } = production
    expect(shots[0]!.still?.results?.map((r) => r.url)).toEqual([
      "https://r2.example/a.png",
      "https://r2.example/b.png",
    ])
    expect(trash).toHaveLength(0)
  })

  it("keeps a deleted image recoverable even when it was the LAST one", () => {
    const seeded: Production = {
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
      trash: [],
    }
    const binned = binStillResult(seeded, "s1", 0)

    expect(binned.shots[0]!.still).toBeUndefined()
    const id = binned.trash![0]!.id
    const { production } = restore(binned, id)
    expect(production.shots[0]!.still?.url).toBe("https://r2.example/only.png")
  })

  it("lands ON the restored image", () => {
    const binned = binStillResult(seedStills(), "s1", 0)

    const { production } = restore(binned, binned.trash![0]!.id)

    expect(production.shots[0]!.still?.activeIndex).toBe(0)
    expect(production.shots[0]!.still?.url).toBe("https://r2.example/a.png")
  })

  it("names the image take in the receipt", () => {
    const binned = binStillResult(seedStills(), "s1", 0)

    const { receipt } = restore(binned, binned.trash![0]!.id)

    expect(receipt.summary).toBe("Restored image take 1 of Scene 1.")
  })
})

describe("restore_trashed — a whole SHOT", () => {
  it("brings back its still, clip history and name", () => {
    const seeded = seedShot("s1", [result("a.mp4"), result("b.mp4")])
    const before = seeded.shots[0]!

    const binned = binShot(seeded, "s1")

    expect(binned.shots).toEqual([])
    expect(binned.trash).toHaveLength(1)
    const entry = binned.trash![0]!
    expect(entry.kind).toBe("shot")
    expect(entry.shotId).toBe("s1")
    expect(entry.shotName).toBe("Rooftop chase")

    const { production } = restore(binned, entry.id)

    const after = production.shots[0]!
    expect(production.shots).toHaveLength(1)
    expect(after.id).toBe("s1")
    expect(after.name).toBe("Rooftop chase")
    expect(after.still!.url).toBe(before.still!.url)
    // The whole clip HISTORY comes back, not just the active take.
    expect(after.clip!.results!.map((r) => r.url)).toEqual(["a.mp4", "b.mp4"])
    expect(after.clip!.results![0]!.prompt).toBe(before.clip!.results![0]!.prompt)
    expect(production.trash).toEqual([])
  })

  it("puts the shot back in its original position", () => {
    const seeded = seedShot("s1", [result("a.mp4")])
    const three: Production = {
      ...seeded,
      shots: [{ id: "s0" }, ...seeded.shots, { id: "s2" }],
    }

    const binned = binShot(three, "s1") // the MIDDLE shot
    expect(binned.shots.map((s) => s.id)).toEqual(["s0", "s2"])

    const { production } = restore(binned, binned.trash![0]!.id)
    expect(production.shots.map((s) => s.id)).toEqual(["s0", "s1", "s2"])
  })

  it("selects the restored shot", () => {
    const seeded = seedShot("s1", [result("a.mp4")])
    const binned = binShot(seeded, "s1")

    const { production } = restore(binned, binned.trash![0]!.id)

    expect(production.shots.map((s) => s.id)).toEqual(["s1"])
    expect(production.selectedShotId).toBe("s1")
  })

  it("won't insert a duplicate when the shot is already back", () => {
    const seeded = seedShot("s1", [result("a.mp4")])
    const binned = binShot(seeded, "s1")
    const id = binned.trash![0]!.id

    const { production } = restore(binned, id)
    // A second restore of the same entry (a double-click, or a replayed batch).
    expect(refusedCode(() => restore(production, id))).toBe("op_target_missing")
    expect(production.shots).toHaveLength(1)
  })

  it("refuses a stale entry whose shot is already on the timeline", () => {
    const seeded = seedShot("s1", [result("a.mp4")])
    const binned = binShot(seeded, "s1")
    // The bin still lists the shot while the shot itself is back — a replayed
    // batch, or a paste of the same shot. Restoring would duplicate it.
    const stale: Production = { ...seeded, trash: binned.trash }

    expect(refusedCode(() => restore(stale, binned.trash![0]!.id))).toBe("op_invalid")
    expect(stale.shots).toHaveLength(1)
    expect(stale.trash).toHaveLength(1)
  })

  it("names the scene in the receipt", () => {
    const seeded = seedShot("s1", [result("a.mp4")])
    const binned = binShot(seeded, "s1")

    const { receipt } = restore(binned, binned.trash![0]!.id)

    expect(receipt.summary).toBe("Restored the scene “Rooftop chase”.")
  })
})

describe("purge_trashed and clear_trash", () => {
  it("purges one entry and empties the whole bin", () => {
    const seeded = seedShot("s1", [result("a.mp4"), result("b.mp4"), result("c.mp4")])
    const once = binClipResult(seeded, "s1", 0)
    const twice = binClipResult(once, "s1", 0)
    expect(twice.trash).toHaveLength(2)

    const { production: purged } = purge(twice, twice.trash![0]!.id)
    expect(purged.trash).toHaveLength(1)

    const { production: cleared } = clear(purged)
    expect(cleared.trash).toEqual([])
  })

  it("purges the named entry, not the newest one", () => {
    const seeded = seedShot("s1", [result("a.mp4"), result("b.mp4"), result("c.mp4")])
    const twice = binClipResult(binClipResult(seeded, "s1", 0), "s1", 0)
    const doomed = twice.trash![1]!

    const { production } = purge(twice, doomed.id)

    expect(production.trash!.map((t) => t.id)).toEqual([twice.trash![0]!.id])
  })

  it("refuses to purge an unknown entry", () => {
    const seeded = seedShot("s1", [result("a.mp4"), result("b.mp4")])
    const binned = binClipResult(seeded, "s1", 0)

    expect(refusedCode(() => purge(binned, "nope"))).toBe("op_target_missing")
    expect(binned.trash).toHaveLength(1)
  })

  it("leaves the shots alone when it destroys an entry", () => {
    const seeded = seedShot("s1", [result("a.mp4"), result("b.mp4")])
    const binned = binClipResult(seeded, "s1", 0)

    const { production } = purge(binned, binned.trash![0]!.id)

    expect(production.shots).toBe(binned.shots)
    expect(production).not.toBe(binned)
  })

  it("counts what it destroyed in the receipt", () => {
    const seeded = seedShot("s1", [result("a.mp4"), result("b.mp4"), result("c.mp4")])
    const twice = binClipResult(binClipResult(seeded, "s1", 0), "s1", 0)

    expect(purge(twice, twice.trash![0]!.id).receipt.summary).toBe(
      "Permanently deleted clip take 1 of “Rooftop chase”.",
    )
    expect(clear(twice).receipt.summary).toBe("Emptied the bin (2 items destroyed).")
    expect(clear(binClipResult(seeded, "s1", 0)).receipt.summary).toBe(
      "Emptied the bin (1 item destroyed).",
    )
  })

  it("warns rather than fails when the bin is already empty", () => {
    const seeded = seedShot("s1", [result("a.mp4")])

    const { production, warnings } = clear(seeded)

    expect(production.trash).toEqual([])
    expect(warnings).toEqual(["The bin was already empty."])
  })

  it("empties a bin filled to the cap", () => {
    const results: ShotStillResult[] = Array.from(
      { length: TRASH_LIMIT + 10 },
      (_, i) => ({ url: `https://r2.example/img-${i}.png`, name: `Take ${i}` }),
    )
    let production: Production = {
      shots: [
        {
          id: "s1",
          still: {
            nodeId: "generate-image-job1",
            url: results[0]!.url,
            provider: "nano-banana",
            prompt: "p",
            activeIndex: 0,
            results,
          },
        },
      ],
      trash: [],
    }
    for (let i = 0; i < TRASH_LIMIT + 5; i++) {
      production = binStillResult(production, "s1", 0)
    }
    expect(production.trash).toHaveLength(TRASH_LIMIT)

    const { production: cleared, receipt } = clear(production)
    expect(cleared.trash).toEqual([])
    expect(receipt.summary).toBe(`Emptied the bin (${TRASH_LIMIT} items destroyed).`)
  })
})

describe("the section's shape", () => {
  it("declares a schema, a handler and a class for the same three ops", () => {
    expect(Object.keys(trashOpSchemas).sort()).toEqual([
      "clear_trash",
      "purge_trashed",
      "restore_trashed",
    ])
    expect(Object.keys(trashHandlers).sort()).toEqual(Object.keys(trashOpSchemas).sort())
    expect(Object.keys(trashOpClasses).sort()).toEqual(Object.keys(trashOpSchemas).sort())
  })

  it("classes the two destroying ops as deletes and the restore as safe", () => {
    expect(trashOpClasses.restore_trashed).toBe("S")
    expect(trashOpClasses.purge_trashed).toBe("D")
    expect(trashOpClasses.clear_trash).toBe("D")
  })

  it("parses its ops and rejects a missing argument", () => {
    expect(
      trashOpSchemas.restore_trashed.parse({ op: "restore_trashed", trashId: "t1" }),
    ).toEqual({ op: "restore_trashed", trashId: "t1" })
    expect(trashOpSchemas.clear_trash.parse({ op: "clear_trash" })).toEqual({
      op: "clear_trash",
    })
    expect(trashOpSchemas.purge_trashed.safeParse({ op: "purge_trashed" }).success).toBe(
      false,
    )
  })
})
