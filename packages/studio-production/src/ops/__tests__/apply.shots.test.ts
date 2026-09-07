/**
 * The `shots` section — the timeline itself, as operations.
 *
 * Every assertion here is PORTED from the studio store's own suite with the
 * expectation left untouched; only the call shape changes, from
 * `store.<reducer>(args)` to `shotsHandlers.<op>(production, op, ctx)`. The
 * sources are `production-store.test.ts` (`describe("addShot")` L64,
 * `describe("removeShot")` L80, `describe("reorderShot")` L119,
 * `describe("duplicateShot")` L145) and `production-store.import.test.ts`
 * (`describe("pasteShots — N-shot import into the timeline")` L34).
 *
 * Two contract-level generalisations show up in the ported cases, both
 * mandated by `SECTIONS.md` rather than invented here:
 *  - an UNKNOWN id is an `OpError("op_target_missing")` instead of the store's
 *    silent no-op (rule 5) — an operation batch is atomic, so a mis-addressed
 *    op must reject rather than quietly do nothing; and
 *  - `reorderShot(id, "left" | "right")` becomes `move_shot { id, toIndex }`
 *    with `toIndex = index ∓ 1`, clamped, so the store's two "clamps at the
 *    end (same reference)" cases become "the clamp lands on the shot's own
 *    index ⇒ nothing changes".
 *
 * `renameShot` and `set_plan` have no oracle in the studio suite; their cases
 * are written from the reducer's behaviour (`production-store-shots.ts`) and
 * from the spec's per-stage merge rule.
 *
 * TWO SIBLINGS carry the rest of this section's port, split off only because
 * one file would pass the repository's size ceiling:
 *  - `apply.shots.append.test.ts` — `describe("appendShots")`'s FOLDER cases
 *    (`production-store.test.ts` L1543; `insert_shots` is the one primitive
 *    both studio append reducers route through), the copy's node identity, and
 *    the two argument gates. The three appendShots cases that cannot survive
 *    the move are named and reasoned about in that file's header.
 *  - `apply.shots.crosslane.test.ts` — the three describes SECTIONS.md §3 lists
 *    for this section that belong to the stills, clips and trash HANDLERS (no
 *    `shots` operation reaches them), ported against those handlers so the
 *    listing has no silent hole.
 */
import { beforeEach, describe, expect, it } from "vitest"

import { OpError, isOpError } from "../errors"
import type { Production } from "../production"
import type { OpContext } from "../types"
import { serializeProduction } from "../../shot-graph"
import type { Shot } from "../../shot"
import { shotsHandlers, shotsOpClasses, shotsOpSchemas } from "../sections/shots"

// ── fixtures (copied from the studio suite so the assertions read the same) ──

/** A still-only shot fixture (stable ids for assertions). */
const stillOnly = (id: string): Shot => ({
  id,
  still: {
    nodeId: `generate-image-${id}`,
    url: `https://r2.example/${id}.png`,
    provider: "nano-banana",
    prompt: `prompt ${id}`,
  },
})

/** A still+clip shot fixture. */
const stillAndClip = (id: string): Shot => ({
  ...stillOnly(id),
  clip: {
    nodeId: `generate-video-${id}`,
    url: `https://r2.example/${id}.mp4`,
    provider: "grok-i2v",
    prompt: `clip ${id}`,
    duration: 5,
  },
})

/** A production over `shots`, selecting `selectedShotId` — the store's own
 *  `setShots` selection rule (keep it if it survives, else the first shot). */
const prod = (
  shots: ReadonlyArray<Shot>,
  selectedShotId?: string,
  extra?: Partial<Production>,
): Production => ({
  shots: [...shots],
  selectedShotId:
    selectedShotId && shots.some((s) => s.id === selectedShotId)
      ? selectedShotId
      : shots[0]?.id,
  ...extra,
})

let minted: number
const ctx: OpContext = {
  now: "2026-09-06T12:00:00.000Z",
  mintId: () => `minted-${++minted}`,
}

beforeEach(() => {
  minted = 0
})

// ── addShot (production-store.test.ts L64) ──────────────────────────────────

describe("add_shot", () => {
  it("appends an empty shot, selects it, and returns its id", () => {
    const { production } = shotsHandlers.add_shot(
      prod([]),
      { op: "add_shot", id: "new-1" },
      ctx,
    )
    expect(production.shots).toHaveLength(1)
    expect(production.shots[0]!.id).toBe("new-1")
    expect(production.shots[0]!.still).toBeUndefined()
    expect(production.selectedShotId).toBe("new-1")
  })

  it("returns a NEW array (no in-place mutation)", () => {
    const before = prod([stillOnly("a")])
    const { production } = shotsHandlers.add_shot(
      before,
      { op: "add_shot", id: "new-1" },
      ctx,
    )
    expect(Object.is(before.shots, production.shots)).toBe(false)
    expect(before.shots).toHaveLength(1)
  })

  it("inserts after the anchor when `afterShotId` names one", () => {
    const { production } = shotsHandlers.add_shot(
      prod([stillOnly("a"), stillOnly("b")]),
      { op: "add_shot", id: "new-1", afterShotId: "a" },
      ctx,
    )
    expect(production.shots.map((s) => s.id)).toEqual(["a", "new-1", "b"])
  })

  it("carries an authored name and plan onto the new shot", () => {
    const plan = { frame: { prompt: "an alley at dawn", provider: "gpt-image-2" } }
    const { production } = shotsHandlers.add_shot(
      prod([]),
      { op: "add_shot", id: "new-1", name: "Rooftop", plan },
      ctx,
    )
    expect(production.shots[0]!.name).toBe("Rooftop")
    expect(production.shots[0]!.plan).toEqual(plan)
  })

  it("refuses an id the production already uses", () => {
    expect(() =>
      shotsHandlers.add_shot(
        prod([stillOnly("a")]),
        { op: "add_shot", id: "a" },
        ctx,
      ),
    ).toThrow(OpError)
  })

  it("refuses an `afterShotId` that names nothing", () => {
    try {
      shotsHandlers.add_shot(
        prod([stillOnly("a")]),
        { op: "add_shot", id: "new-1", afterShotId: "nope" },
        ctx,
      )
      expect.unreachable()
    } catch (error) {
      if (!isOpError(error)) throw error
      expect(error.code).toBe("op_target_missing")
    }
  })
})

// ── removeShot (production-store.test.ts L80) ───────────────────────────────

describe("remove_shot", () => {
  it("removes the shot and reselects the previous neighbor when the selected is removed", () => {
    const { production } = shotsHandlers.remove_shot(
      prod([stillOnly("a"), stillOnly("b"), stillOnly("c")], "b"),
      { op: "remove_shot", id: "b" },
      ctx,
    )
    expect(production.shots.map((s) => s.id)).toEqual(["a", "c"])
    // prev neighbor ("a") becomes selected.
    expect(production.selectedShotId).toBe("a")
  })

  it("falls back to the next neighbor when removing the FIRST selected shot", () => {
    const { production } = shotsHandlers.remove_shot(
      prod([stillOnly("a"), stillOnly("b")], "a"),
      { op: "remove_shot", id: "a" },
      ctx,
    )
    expect(production.selectedShotId).toBe("b")
  })

  it("clears the selection when the only shot is removed", () => {
    const { production } = shotsHandlers.remove_shot(
      prod([stillOnly("a")], "a"),
      { op: "remove_shot", id: "a" },
      ctx,
    )
    expect(production.shots).toEqual([])
    expect(production.selectedShotId).toBeUndefined()
  })

  it("keeps the selection when removing a DIFFERENT shot", () => {
    const { production } = shotsHandlers.remove_shot(
      prod([stillOnly("a"), stillOnly("b")], "b"),
      { op: "remove_shot", id: "a" },
      ctx,
    )
    expect(production.selectedShotId).toBe("b")
  })

  it("refuses an unknown id (the store's silent no-op becomes op_target_missing)", () => {
    try {
      shotsHandlers.remove_shot(
        prod([stillOnly("a")]),
        { op: "remove_shot", id: "nope" },
        ctx,
      )
      expect.unreachable()
    } catch (error) {
      if (!isOpError(error)) throw error
      expect(error.code).toBe("op_target_missing")
    }
  })

  it("files the whole shot in the bin as a one-shot graph, stamped from ctx", () => {
    const before = prod([stillAndClip("a"), stillOnly("b")], "a")
    const { production } = shotsHandlers.remove_shot(
      before,
      { op: "remove_shot", id: "a" },
      ctx,
    )
    expect(production.trash).toHaveLength(1)
    const entry = production.trash![0]!
    expect(entry.kind).toBe("shot")
    expect(entry.id).toBe("minted-1")
    expect(entry.deletedAt).toBe("2026-09-06T12:00:00.000Z")
    if (entry.kind !== "shot") throw new Error("expected a shot entry")
    expect(entry.shotId).toBe("a")
    expect(entry.index).toBe(0)
    expect(entry.graph).toEqual(serializeProduction([stillAndClip("a")], "a"))
    // The input document is untouched.
    expect(before.trash).toBeUndefined()
    expect(before.shots).toHaveLength(2)
  })

  it("names the shot in the receipt and says where it went", () => {
    const { receipt } = shotsHandlers.remove_shot(
      prod([stillOnly("a"), { ...stillOnly("b"), name: "Rooftop" }]),
      { op: "remove_shot", id: "b" },
      ctx,
    )
    expect(receipt.summary).toBe("Deleted Rooftop (in the bin).")
  })
})

// ── reorderShot → move_shot (production-store.test.ts L119) ─────────────────

describe("move_shot", () => {
  it("moves a shot left and returns a NEW array", () => {
    const before = prod([stillOnly("a"), stillOnly("b"), stillOnly("c")])
    const { production } = shotsHandlers.move_shot(
      before,
      { op: "move_shot", id: "c", toIndex: 1 },
      ctx,
    )
    expect(production.shots.map((s) => s.id)).toEqual(["a", "c", "b"])
    expect(Object.is(before.shots, production.shots)).toBe(false)
  })

  it("clamps at the left end (no-op, same reference)", () => {
    const before = prod([stillOnly("a"), stillOnly("b")])
    const { production } = shotsHandlers.move_shot(
      before,
      { op: "move_shot", id: "a", toIndex: -1 },
      ctx,
    )
    expect(production.shots.map((s) => s.id)).toEqual(["a", "b"])
    expect(Object.is(before.shots, production.shots)).toBe(true)
  })

  it("clamps at the right end (no-op, same reference)", () => {
    const before = prod([stillOnly("a"), stillOnly("b")])
    const { production } = shotsHandlers.move_shot(
      before,
      { op: "move_shot", id: "b", toIndex: 2 },
      ctx,
    )
    expect(production.shots.map((s) => s.id)).toEqual(["a", "b"])
    expect(Object.is(before.shots, production.shots)).toBe(true)
  })

  it("warns rather than fails when the move changes nothing", () => {
    const { warnings } = shotsHandlers.move_shot(
      prod([stillOnly("a"), stillOnly("b")]),
      { op: "move_shot", id: "a", toIndex: 0 },
      ctx,
    )
    expect(warnings).toEqual(["Shot 1 was already at position 1."])
  })

  it("moves a shot right, to the far end", () => {
    const { production } = shotsHandlers.move_shot(
      prod([stillOnly("a"), stillOnly("b"), stillOnly("c")]),
      { op: "move_shot", id: "a", toIndex: 99 },
      ctx,
    )
    expect(production.shots.map((s) => s.id)).toEqual(["b", "c", "a"])
  })

  it("refuses an unknown id", () => {
    expect(() =>
      shotsHandlers.move_shot(
        prod([stillOnly("a")]),
        { op: "move_shot", id: "nope", toIndex: 0 },
        ctx,
      ),
    ).toThrow(OpError)
  })

  it("refuses a non-integer index", () => {
    try {
      shotsHandlers.move_shot(
        prod([stillOnly("a"), stillOnly("b")]),
        { op: "move_shot", id: "a", toIndex: 1.5 },
        ctx,
      )
      expect.unreachable()
    } catch (error) {
      if (!isOpError(error)) throw error
      expect(error.code).toBe("op_invalid")
    }
  })
})

// ── duplicateShot (production-store.test.ts L145) ───────────────────────────

describe("duplicate_shot", () => {
  it("inserts a copy after the source, selects it, and mints fresh shot + node ids", () => {
    const { production } = shotsHandlers.duplicate_shot(
      prod([stillAndClip("a"), stillOnly("z")]),
      { op: "duplicate_shot", id: "a", newId: "copy-1" },
      ctx,
    )
    const ids = production.shots.map((s) => s.id)
    expect(ids).toHaveLength(3)
    expect(ids[0]).toBe("a")
    expect(ids[2]).toBe("z")
    const copy = production.shots[1]!
    // Fresh shot id (timeline identity), distinct from the source.
    expect(copy.id).not.toBe("a")
    expect(production.selectedShotId).toBe(copy.id)
    // Fresh node ids — else the serialized graph would collide on node ids.
    expect(copy.still?.nodeId).not.toBe("generate-image-a")
    expect(copy.clip?.nodeId).not.toBe("generate-video-a")
    // …but the content (url / prompt / provider / duration) carries over.
    expect(copy.still?.url).toBe("https://r2.example/a.png")
    expect(copy.clip?.duration).toBe(5)
  })

  it("carries EVERY authoring field of a fully-loaded shot", () => {
    const source: Shot = {
      ...stillAndClip("a"),
      name: "The chase begins",
      folderId: "f1",
      voice: { url: "https://r2.example/v.mp3", text: "run" },
      startFrame: "https://r2.example/start.png",
      endFrame: "https://r2.example/end.png",
      directingReferenceUrls: ["https://r2.example/ref.png"],
      directingReferenceVideoUrls: ["https://r2.example/ref.mp4"],
      directingReferenceAudioUrls: ["https://r2.example/ref.mp3"],
      beats: [{ id: "b1", seconds: 4, text: "she runs" }],
      scenePrompt: "A rain-soaked rooftop chase.",
      look: { "lighting-time-of-day": "golden-hour" },
      castLook: { natalie: { url: "https://r2.example/look.png" } },
      plan: { frame: { prompt: "an alley" }, motion: { prompt: "she runs" } },
      recipe: { framing: { prompt: "an alley", provider: "gpt-image-2" } },
      pendingClips: [
        {
          jobId: "job-1",
          prompt: "in flight",
          provider: "seedance-2",
          startedAt: 1_756_720_800_000,
        },
      ],
    }
    const { production } = shotsHandlers.duplicate_shot(
      prod([source]),
      { op: "duplicate_shot", id: "a", newId: "copy-1" },
      ctx,
    )
    const copy = production.shots[1]!
    expect(copy.name).toBe("The chase begins")
    expect(copy.voice).toEqual(source.voice)
    expect(copy.startFrame).toBe(source.startFrame)
    expect(copy.endFrame).toBe(source.endFrame)
    expect(copy.directingReferenceUrls).toEqual(source.directingReferenceUrls)
    expect(copy.directingReferenceVideoUrls).toEqual(source.directingReferenceVideoUrls)
    expect(copy.directingReferenceAudioUrls).toEqual(source.directingReferenceAudioUrls)
    expect(copy.beats).toEqual(source.beats)
    expect(copy.scenePrompt).toBe("A rain-soaked rooftop chase.")
    expect(copy.look).toEqual(source.look)
    expect(copy.castLook).toEqual(source.castLook)
    expect(copy.plan).toEqual(source.plan)
    expect(copy.recipe).toEqual(source.recipe)
    // The folder rides too: Duplicate is same-production, so the id cannot
    // dangle, and the copy landing anywhere but beside its source reads as the
    // copy vanishing. Only the in-flight render never inherits — it belongs to
    // the run that started it.
    expect(copy.folderId).toBe("f1")
    expect(copy.pendingClips).toBeUndefined()
  })

  it("re-keys a clip that has no still (a motion-only scene keeps its take)", () => {
    const clipOnly: Shot = {
      id: "a",
      clip: {
        nodeId: "generate-video-a",
        url: "https://r2.example/a.mp4",
        provider: "grok-i2v",
        prompt: "clip a",
      },
    }
    const { production } = shotsHandlers.duplicate_shot(
      prod([clipOnly]),
      { op: "duplicate_shot", id: "a", newId: "copy-1" },
      ctx,
    )
    const copy = production.shots[1]!
    expect(copy.clip?.url).toBe("https://r2.example/a.mp4")
    expect(copy.clip?.nodeId).not.toBe("generate-video-a")
  })

  it("refuses an unknown id", () => {
    expect(() =>
      shotsHandlers.duplicate_shot(
        prod([stillOnly("a")]),
        { op: "duplicate_shot", id: "nope", newId: "copy-1" },
        ctx,
      ),
    ).toThrow(OpError)
  })

  it("refuses a `newId` the production already uses", () => {
    try {
      shotsHandlers.duplicate_shot(
        prod([stillOnly("a"), stillOnly("b")]),
        { op: "duplicate_shot", id: "a", newId: "b" },
        ctx,
      )
      expect.unreachable()
    } catch (error) {
      if (!isOpError(error)) throw error
      expect(error.code).toBe("op_invalid")
    }
  })
})

// ── pasteShots → insert_shots (production-store.import.test.ts L34) ─────────

describe("insert_shots", () => {
  it("inserts every shot of a film graph after the anchor, in order, freshly keyed", () => {
    const graph = serializeProduction(
      [
        { ...stillOnly("x"), name: "One", folderId: "f-1" },
        { ...stillOnly("y"), name: "Two" },
      ],
      "x",
    )

    const { production, receipt } = shotsHandlers.insert_shots(
      prod([stillOnly("a"), stillOnly("b")]),
      { op: "insert_shots", graph, afterShotId: "a" },
      ctx,
    )
    const ids = receipt.ids!

    expect(ids).toHaveLength(2)
    const shots = production.shots
    expect(shots.map((s) => s.name ?? s.id)).toEqual(["a", "One", "Two", "b"])
    // Fresh identity — never the file's ids or node ids.
    expect(ids).not.toContain("x")
    expect(shots[1]!.still?.nodeId).toBe(`generate-image-${ids[0]}`)
    // The dangling folder id is dropped.
    expect(shots[1]!.folderId).toBeUndefined()
    // Selection lands on the LAST pasted shot.
    expect(production.selectedShotId).toBe(ids[1])
  })

  it("appends at the end without an anchor and returns [] for an empty graph", () => {
    const graph = serializeProduction([stillOnly("z")], "z")
    const appended = shotsHandlers.insert_shots(
      prod([stillOnly("a")]),
      { op: "insert_shots", graph },
      ctx,
    )
    const ids = appended.receipt.ids!
    expect(appended.production.shots.map((s) => s.id)).toEqual(["a", ids[0]!])

    const empty = shotsHandlers.insert_shots(
      prod([stillOnly("a")]),
      {
        op: "insert_shots",
        graph: {
          nodes: [],
          edges: [],
          settings: { studio: { version: 3, shots: [], shotOrder: [] } },
        },
      },
      ctx,
    )
    expect(empty.receipt.ids).toEqual([])
  })

  it("drops the pasted shots' in-flight animate markers", () => {
    const graph = serializeProduction(
      [
        {
          ...stillOnly("x"),
          pendingClips: [
            {
              jobId: "job-1",
              prompt: "in flight",
              provider: "seedance-2",
              startedAt: 1_756_720_800_000,
            },
          ],
        },
      ],
      "x",
    )
    const { production } = shotsHandlers.insert_shots(
      prod([stillOnly("a")]),
      { op: "insert_shots", graph },
      ctx,
    )
    expect(production.shots[1]!.pendingClips).toBeUndefined()
  })

  it("refuses an `afterShotId` that names nothing", () => {
    const graph = serializeProduction([stillOnly("x")], "x")
    try {
      shotsHandlers.insert_shots(
        prod([stillOnly("a")]),
        { op: "insert_shots", graph, afterShotId: "nope" },
        ctx,
      )
      expect.unreachable()
    } catch (error) {
      if (!isOpError(error)) throw error
      expect(error.code).toBe("op_target_missing")
    }
  })

  it("leaves the input document untouched", () => {
    const graph = serializeProduction([stillOnly("x")], "x")
    const before = prod([stillOnly("a")])
    shotsHandlers.insert_shots(before, { op: "insert_shots", graph }, ctx)
    expect(before.shots).toHaveLength(1)
  })
})

// ── renameShot (no studio test — written from the reducer's behaviour) ──────

describe("rename_shot", () => {
  it("stores the trimmed name on that shot alone", () => {
    const before = prod([stillOnly("a"), stillOnly("b")])
    const { production } = shotsHandlers.rename_shot(
      before,
      { op: "rename_shot", id: "a", name: "  Rooftop  " },
      ctx,
    )
    expect(production.shots[0]!.name).toBe("Rooftop")
    expect(production.shots[1]!.name).toBeUndefined()
    expect(Object.is(before.shots, production.shots)).toBe(false)
  })

  it("a blank name clears the override (back to the derived label)", () => {
    const { production } = shotsHandlers.rename_shot(
      prod([{ ...stillOnly("a"), name: "Rooftop" }]),
      { op: "rename_shot", id: "a", name: "   " },
      ctx,
    )
    expect("name" in production.shots[0]!).toBe(false)
  })

  it("clearing a shot that has none changes nothing (no re-render churn)", () => {
    const before = prod([stillOnly("a")])
    const { production } = shotsHandlers.rename_shot(
      before,
      { op: "rename_shot", id: "a", name: "" },
      ctx,
    )
    expect(Object.is(before.shots, production.shots)).toBe(true)
  })

  it("refuses an unknown id", () => {
    expect(() =>
      shotsHandlers.rename_shot(
        prod([stillOnly("a")]),
        { op: "rename_shot", id: "nope", name: "Rooftop" },
        ctx,
      ),
    ).toThrow(OpError)
  })

  it("reads the shot by its position when it has no name yet", () => {
    const { receipt } = shotsHandlers.rename_shot(
      prod([stillOnly("a"), stillOnly("b")]),
      { op: "rename_shot", id: "b", name: "Rooftop" },
      ctx,
    )
    expect(receipt.summary).toBe("Renamed Shot 2 to “Rooftop”.")
  })
})

// ── set_plan (no studio reducer — the spec's per-stage merge) ───────────────

describe("set_plan", () => {
  const planned = (): Shot => ({
    id: "p1",
    plan: {
      frame: { prompt: "an alley at dawn", provider: "gpt-image-2" },
      motion: { prompt: "she runs", duration: 10 },
      voice: { text: "Dawn broke." },
    },
  })

  it("replaces one stage and leaves the others alone", () => {
    const { production } = shotsHandlers.set_plan(
      prod([planned()]),
      {
        op: "set_plan",
        shotId: "p1",
        frame: { prompt: "a rooftop at dusk" },
      },
      ctx,
    )
    expect(production.shots[0]!.plan).toEqual({
      frame: { prompt: "a rooftop at dusk" },
      motion: { prompt: "she runs", duration: 10 },
      voice: { text: "Dawn broke." },
    })
  })

  it("a null stage CLEARS it and leaves the rest", () => {
    const { production } = shotsHandlers.set_plan(
      prod([planned()]),
      { op: "set_plan", shotId: "p1", motion: null },
      ctx,
    )
    expect(production.shots[0]!.plan).toEqual({
      frame: { prompt: "an alley at dawn", provider: "gpt-image-2" },
      voice: { text: "Dawn broke." },
    })
  })

  it("clearing the last stage drops the plan key entirely", () => {
    const { production } = shotsHandlers.set_plan(
      prod([{ id: "p1", plan: { frame: { prompt: "an alley" } } }]),
      { op: "set_plan", shotId: "p1", frame: null },
      ctx,
    )
    expect("plan" in production.shots[0]!).toBe(false)
  })

  it("writes a plan onto a shot that had none", () => {
    const { production } = shotsHandlers.set_plan(
      prod([stillOnly("a")]),
      { op: "set_plan", shotId: "a", frame: { prompt: "an alley" } },
      ctx,
    )
    expect(production.shots[0]!.plan).toEqual({ frame: { prompt: "an alley" } })
  })

  it("narrows the stage through the codec's own reader — unknown keys drop", () => {
    const { production } = shotsHandlers.set_plan(
      prod([stillOnly("a")]),
      {
        op: "set_plan",
        shotId: "a",
        frame: { prompt: "an alley", nonsense: 7 } as never,
      },
      ctx,
    )
    expect(production.shots[0]!.plan).toEqual({ frame: { prompt: "an alley" } })
  })

  it("refuses a stage the reader narrows to nothing", () => {
    try {
      shotsHandlers.set_plan(
        prod([stillOnly("a")]),
        { op: "set_plan", shotId: "a", frame: {} },
        ctx,
      )
      expect.unreachable()
    } catch (error) {
      if (!isOpError(error)) throw error
      expect(error.code).toBe("op_invalid")
    }
  })

  it("refuses an op that names no stage at all", () => {
    try {
      shotsHandlers.set_plan(prod([stillOnly("a")]), { op: "set_plan", shotId: "a" }, ctx)
      expect.unreachable()
    } catch (error) {
      if (!isOpError(error)) throw error
      expect(error.code).toBe("op_invalid")
    }
  })

  it("refuses an unknown shot", () => {
    expect(() =>
      shotsHandlers.set_plan(
        prod([stillOnly("a")]),
        { op: "set_plan", shotId: "nope", frame: null },
        ctx,
      ),
    ).toThrow(OpError)
  })
})

// ── the section's own contract ──────────────────────────────────────────────

describe("the shots section", () => {
  it("declares a schema, a handler and a class for the same seven ops", () => {
    const ops = Object.keys(shotsOpSchemas).sort()
    expect(ops).toEqual([
      "add_shot",
      "duplicate_shot",
      "insert_shots",
      "move_shot",
      "remove_shot",
      "rename_shot",
      "set_plan",
    ])
    expect(Object.keys(shotsHandlers).sort()).toEqual(ops)
    expect(Object.keys(shotsOpClasses).sort()).toEqual(ops)
  })

  it("classes the only trash-backed op as a delete", () => {
    expect(shotsOpClasses.remove_shot).toBe("D")
    expect(shotsOpClasses.add_shot).toBe("S")
  })

  it("parses its ops through the declared schemas", () => {
    expect(
      shotsOpSchemas.move_shot.parse({ op: "move_shot", id: "a", toIndex: 2 }),
    ).toEqual({ op: "move_shot", id: "a", toIndex: 2 })
    expect(() => shotsOpSchemas.add_shot.parse({ op: "add_shot" })).toThrow()
  })
})
