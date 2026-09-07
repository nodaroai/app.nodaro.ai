/**
 * The `shots` section — the APPEND's folders, the copy's node identity, and the
 * two argument gates.
 *
 * A sibling of `apply.shots.test.ts` (which carries the ported reducer suite)
 * only because one file would pass the repository's size ceiling; the port rule
 * is the same one its header states, and every assertion below that has a
 * studio oracle keeps that oracle's expectation untouched.
 *
 * `insert_shots` is the ONE append primitive: the clipboard paste, "Import
 * scene…" and the Director's / reconcile's append all route through it (plan
 * L94, L287), and R18 says Phase 1 replaces the append's MECHANISM, not its
 * semantics. So the folder rule is `appendShots`' own
 * (`production-store-shots.ts` L52-100, `describe("appendShots")` at
 * `production-store.test.ts` L1543), ported here with the assertions untouched:
 * a folder travels as a NAME, one already here IS the incoming folder, and a
 * shot lands on whichever survived. The `pasteShots` cases in the sibling file
 * stay green under the same handler because their graphs declare NO folders —
 * "drops a folderId the import never declared" is the same clause said from the
 * other side.
 *
 * BLOCKED, and reported rather than quietly adjusted (SECTIONS.md rule 1) —
 * three of that studio describe's cases cannot survive the move, none of them
 * about folders:
 *   · "appends imported scenes at the end and leaves the selection alone" —
 *     §6 maps `insert_shots` onto `pasteShots`, which lands the cursor on the
 *     LAST arriving shot ("inserts every shot of a film graph…", the sibling
 *     file). One op cannot hold both selection rules; the ops vocabulary
 *     already has `select_shot` for a caller that wants the old cursor kept.
 *   · "enrolls the APPENDED shots' chips when asked, and only those (D7)" —
 *     `enrollCast` is not an argument of `insert_shots` in §6. The SCOPING half
 *     of that assertion does survive and is pinned by the paste cases: the
 *     merge is handed `pastedList`, never the shots already here.
 *   · "survives an animate that completed while the import dialog was open" —
 *     the assertion is about a stale STORE snapshot; a pure handler is always
 *     applied to the document it was given, so there is no snapshot to go
 *     stale and nothing left to assert.
 */
import { beforeEach, describe, expect, it } from "vitest"

import { isOpError } from "../errors"
import type { Production } from "../production"
import type { OpContext } from "../types"
import { parseProduction, serializeProduction } from "../../shot-graph"
import { readPlan, type ScenePlan } from "../../scene-plan"
import type { Shot } from "../../shot"
import { SET_PLAN_STAGES, shotsHandlers } from "../sections/shots"

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

// ── appendShots' FOLDER merge (production-store.test.ts L1543) ─────────────

describe("insert_shots — the arriving folders", () => {
  /** A one-shot graph filed under `folderId`, declaring `folders`. */
  const filed = (
    folderId: string | undefined,
    folders: ReadonlyArray<{ id: string; name: string }>,
  ) =>
    serializeProduction(
      [folderId ? { ...stillOnly("i1"), folderId } : stillOnly("i1")],
      "i1",
      undefined,
      undefined,
      folders,
    )

  it("reuses an existing folder by NAME and remaps the appended shots onto it", () => {
    const { production } = shotsHandlers.insert_shots(
      prod([stillOnly("a")], "a", { folders: [{ id: "here", name: "Act 1" }] }),
      {
        op: "insert_shots",
        graph: filed("imported-act-1", [{ id: "imported-act-1", name: "Act 1" }]),
      },
      ctx,
    )
    expect(production.folders).toEqual([{ id: "here", name: "Act 1" }])
    expect(production.shots[1]!.folderId).toBe("here")
  })

  it("creates a folder the production doesn't have, with a FRESH id", () => {
    const { production } = shotsHandlers.insert_shots(
      prod([stillOnly("a")]),
      {
        op: "insert_shots",
        graph: filed("imported-act-2", [{ id: "imported-act-2", name: "Act 2" }]),
      },
      ctx,
    )
    expect(production.folders).toHaveLength(1)
    expect(production.folders![0]!.name).toBe("Act 2")
    expect(production.folders![0]!.id).not.toBe("imported-act-2")
    expect(production.shots[1]!.folderId).toBe(production.folders![0]!.id)
  })

  it("drops a folderId the import never declared rather than dangling", () => {
    const { production } = shotsHandlers.insert_shots(
      prod([stillOnly("a")]),
      { op: "insert_shots", graph: filed("ghost", []) },
      ctx,
    )
    expect(production.shots[1]!.folderId).toBeUndefined()
  })

  it("returns a NEW array (no in-place mutation)", () => {
    const before = prod([stillOnly("a")], "a", {
      folders: [{ id: "here", name: "Act 1" }],
    })
    const { production } = shotsHandlers.insert_shots(
      before,
      {
        op: "insert_shots",
        graph: filed("imported-act-1", [{ id: "imported-act-1", name: "Act 1" }]),
      },
      ctx,
    )
    expect(Object.is(before.shots, production.shots)).toBe(false)
    expect(Object.is(before.folders, production.folders)).toBe(false)
    expect(before.shots).toHaveLength(1)
    expect(before.folders).toEqual([{ id: "here", name: "Act 1" }])
  })

  it("keeps a folder-less production folder-less (no empty list, no empty cast)", () => {
    const { production } = shotsHandlers.insert_shots(
      prod([stillOnly("a")]),
      { op: "insert_shots", graph: filed(undefined, []) },
      ctx,
    )
    expect(production.folders).toBeUndefined()
    // The cast is the same question one field over: a production with no cast
    // must not gain an empty one, because `parseProduction` never hands one
    // back and the in-memory shape would then differ from the reloaded one.
    expect("cast" in production).toBe(false)
  })
})

// ── the serialized graph's node ids stay unique ─────────────────────────────

describe("duplicate_shot — node identity", () => {
  /** The shot ids the copy's node ids are derived from must be the ONLY
   *  variable: one injective function of a unique shot id, so no pair of
   *  caller-chosen ids can make two shots share a canvas node. */
  const nodeIds = (production: Production): string[] =>
    production.shots.flatMap((s) =>
      [s.still?.nodeId, s.clip?.nodeId].filter((n): n is string => !!n),
    )

  it("derives the copy's node ids from the new shot id alone", () => {
    const { production } = shotsHandlers.duplicate_shot(
      prod([stillAndClip("a")]),
      { op: "duplicate_shot", id: "a", newId: "q" },
      ctx,
    )
    const copy = production.shots[1]!
    expect(copy.still!.nodeId).toBe("generate-image-q")
    expect(copy.clip!.nodeId).toBe("generate-video-q")
  })

  it("cannot collide with a node id the production already carries", () => {
    // The hazard the store never had: it minted the copy's id itself
    // (`crypto.randomUUID()`), while the op takes `newId` from the caller. A
    // shot already keyed `dup-q` plus a copy minted as `q` produced the SAME
    // `generate-image-dup-q` under the old prefix, and a reload collapsed the
    // two onto one node — the older shot came back wearing the copy's still.
    const existing: Shot = {
      id: "dup-q",
      still: {
        nodeId: "generate-image-dup-q",
        url: "https://r2.example/dupq.png",
        provider: "nano-banana",
        prompt: "dup q",
      },
    }
    const { production } = shotsHandlers.duplicate_shot(
      prod([existing, stillAndClip("a")], "dup-q"),
      { op: "duplicate_shot", id: "a", newId: "q" },
      ctx,
    )
    expect(new Set(nodeIds(production)).size).toBe(nodeIds(production).length)

    // …and the round trip proves it: `parseProduction` keys results by node id.
    const wire = serializeProduction(production.shots, production.selectedShotId)
    expect(new Set(wire.nodes.map((n) => n.id)).size).toBe(wire.nodes.length)
    const reloaded = parseProduction({
      id: "wf",
      name: "wf",
      nodes: wire.nodes,
      edges: wire.edges,
      settings: wire.settings,
    })
    expect(reloaded.shots.map((s) => s.still?.url)).toEqual(
      production.shots.map((s) => s.still?.url),
    )
  })

  it("refuses a `newId` whose node ids are already taken by another shot", () => {
    // A canvas-edited production can carry any node id at all, so uniqueness of
    // the SHOT id is not enough on its own: the derived node ids are checked
    // too, and a clash is the caller's mistake rather than a silent overwrite.
    const squatter: Shot = {
      id: "other",
      still: {
        nodeId: "generate-image-q",
        url: "https://r2.example/other.png",
        provider: "nano-banana",
        prompt: "other",
      },
    }
    try {
      shotsHandlers.duplicate_shot(
        prod([squatter, stillAndClip("a")], "other"),
        { op: "duplicate_shot", id: "a", newId: "q" },
        ctx,
      )
      expect.unreachable()
    } catch (error) {
      if (!isOpError(error)) throw error
      expect(error.code).toBe("op_invalid")
    }
  })
})

// ── the plan argument refuses what `set_plan` refuses ───────────────────────

describe("add_shot — an unreadable plan", () => {
  it("refuses a plan the codec's reader narrows to nothing, exactly as set_plan does", () => {
    try {
      shotsHandlers.add_shot(
        prod([]),
        { op: "add_shot", id: "n", plan: { frame: {} } as ScenePlan },
        ctx,
      )
      expect.unreachable()
    } catch (error) {
      if (!isOpError(error)) throw error
      expect(error.code).toBe("op_invalid")
    }
  })

  it("still takes a plan the reader CAN read", () => {
    const { production } = shotsHandlers.add_shot(
      prod([]),
      { op: "add_shot", id: "n", plan: { frame: { prompt: "an alley" } } },
      ctx,
    )
    expect(production.shots[0]!.plan).toEqual({ frame: { prompt: "an alley" } })
  })
})

// ── the by-name stage enumerators agree ─────────────────────────────────────

describe("set_plan — the stage list", () => {
  it("names every stage the codec's own reader can read", () => {
    // `set_plan` enumerates the stages BY NAME, which makes it one more of the
    // enumerators CLAUDE.md says must be grepped together (`readPlan`,
    // `planWithoutMedia`, `isEmptyPlan`, `copyPlan`, `untokenizeRecipeProse`).
    // This is that grep, as a test: a fourth stage added to `ScenePlan` and to
    // `readPlan` fails HERE until `set_plan` learns to write it.
    const read = readPlan({
      frame: { prompt: "f" },
      motion: { prompt: "m" },
      voice: { text: "v" },
    })
    expect(Object.keys(read ?? {}).sort()).toEqual(SET_PLAN_STAGES.slice().sort())
  })
})

