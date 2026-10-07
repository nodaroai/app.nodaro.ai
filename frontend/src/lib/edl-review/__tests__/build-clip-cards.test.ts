import { describe, it, expect } from "vitest"
import {
  EDITED_EDL_VERSION,
  editPlanBasis,
  planClipKeyAt,
  renderClipKey,
  renderPlanPath,
  renderReadBasis,
  resolveEditPlanOutput,
  type EditedClipDecision,
  type RenderGraphEdge,
  type RenderPlanHop,
} from "@nodaro/shared"
import { buildClipCards, clipDecisionsOf, clipRenderBases, type ClipCardsInput } from "../build-clip-cards"
import { renderSettingsBasisOf } from "../staleness"

/**
 * The Clip Pack inspector's card model (A4-1; R12–R14, R19, decided
 * 2026-10-06): one card per clip the render's wire picks, matched to its takes
 * by `clipKey`, with no UI.
 */

const SOURCES = [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }]
/** Clip i: 60 s from i × 100 s, one segment (two for `split`, same outer span). */
const clip = (i: number, split = false) => ({
  version: 1,
  clock: "master",
  sources: SOURCES,
  segments: split
    ? [
        { id: `c${i}a`, inMs: i * 100_000, outMs: i * 100_000 + 20_000, video: "cam" },
        { id: `c${i}b`, inMs: i * 100_000 + 30_000, outMs: i * 100_000 + 60_000, video: "cam" },
      ]
    : [{ id: `c${i}`, inMs: i * 100_000, outMs: i * 100_000 + 60_000, video: "cam" }],
  dropped: [],
  meta: { title: `Clip ${i + 1}`, hook: `Hook ${i + 1}` },
})
const PLAN = Array.from({ length: 8 }, (_, i) => clip(i))
const keyOf = (row: number) => planClipKeyAt(PLAN, row)!
const readBasis = (row: number) => renderReadBasis(PLAN[row])!
const SETTINGS_BASIS = "00000000000000aa"

const node = (id: string, type: string) => ({ id, type })
const edge = (source: string, target: string, data?: Record<string, unknown>) =>
  ({ source, target, sourceHandle: "edl", targetHandle: "edl", data: { outputMode: "each", ...data } }) as RenderGraphEdge

function hopsOf(nodes: { id: string; type: string }[], edges: RenderGraphEdge[]): readonly RenderPlanHop[] {
  return renderPlanPath("render", nodes, edges)!.hops
}
const DIRECT = hopsOf([node("plan", "edit-plan"), node("render", "apply-edl")], [edge("plan", "render")])
/** TA16's fixture: a range selector on the render's wire picking clips 2–4. */
const PICK_3 = hopsOf([node("plan", "edit-plan"), node("render", "apply-edl")], [edge("plan", "render", { rangeFrom: "2", rangeTo: "4" })])
const SWITCHED_NODES = [node("plan", "edit-plan"), node("cam", "camera-switch"), node("render", "apply-edl")]
const SWITCHED = hopsOf(SWITCHED_NODES, [edge("plan", "cam"), edge("cam", "render")])
/** A selector AFTER the switch: items 1–3 of the switch's batch, which has no holes. */
const SWITCHED_PICK = hopsOf(SWITCHED_NODES, [edge("plan", "cam"), edge("cam", "render", { rangeFrom: "1", rangeTo: "3" })])

const clipsEdit = (clips: EditedClipDecision[]) => ({ v: EDITED_EDL_VERSION, kind: "clips", basis: editPlanBasis(PLAN), clips })
const allKept = (): EditedClipDecision[] => PLAN.map(() => ({ keep: true }))
const withDecision = (row: number, d: EditedClipDecision): EditedClipDecision[] => allKept().map((k, i) => (i === row ? d : k))

const take = (row: number, quality: "proxy" | "final", extra: Record<string, unknown> = {}) => ({
  url: `https://cdn.test/${quality}-${row}-${Object.keys(extra).join("")}.mp4`,
  jobId: `job-${quality}-${row}`,
  thumbnailUrl: `https://cdn.test/thumb-${row}.jpg`,
  quality,
  clipKey: keyOf(row),
  planBasis: readBasis(row),
  renderBasis: SETTINGS_BASIS,
  ...extra,
})

const allBases = new Map(PLAN.map((_, row) => [keyOf(row), SETTINGS_BASIS]))

function build(over: Partial<ClipCardsInput> = {}) {
  return buildClipCards({ plan: PLAN, editedEdl: undefined, renderData: {}, hops: DIRECT, renderBases: allBases, ...over })!
}

describe("which clips get a card (R12 a)", () => {
  it("every planned clip when the wire picks them all, in plan order", () => {
    const result = build()
    expect(result.cards.map((c) => c.row)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(result.notSent).toBe(0)
    const first = result.cards[0]!
    expect(first).toMatchObject({
      clipKey: keyOf(0),
      title: "Clip 1",
      plannedHook: "Hook 1",
      hook: "Hook 1",
      hookEdited: false,
      keep: true,
      durationMs: 60_000,
      sourceSpan: { inMs: 0, outMs: 60_000 },
      state: "no-preview",
    })
  })

  it("only the rows a selector on the render's wire picks; the rest are counted, not shown (TA16)", () => {
    const result = build({ hops: PICK_3, editedEdl: clipsEdit(withDecision(2, { keep: false })) })
    expect(result.cards.map((c) => c.row)).toEqual([1, 2, 3])
    expect(result.notSent).toBe(5)
    // A dropped clip the selector picks keeps its card, so it can be kept again.
    expect(result.cards.map((c) => c.keep)).toEqual([true, false, true])
    expect(result.keptCount).toBe(2)
    expect(result.keptDurationMs).toBe(120_000)
  })

  it("through Camera Switch, every clip the switch hands on", () => {
    expect(build({ hops: SWITCHED }).cards.map((c) => c.row)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it("each card's key is the key the render iteration stamps (direct, a selector, Camera Switch)", () => {
    for (const hops of [DIRECT, PICK_3, SWITCHED]) {
      const resolved = resolveEditPlanOutput(PLAN, undefined).listResults!
      for (const card of build({ hops }).cards) {
        expect(card.clipKey).toBe(planClipKeyAt(PLAN, card.row))
        expect(renderClipKey(resolved, card.renderRow, hops)).toBe(card.clipKey)
      }
    }
  })

  it("behind Camera Switch with a dropped clip, each card's key is the key the render iteration stamps", () => {
    // The switch runs once per KEPT clip, so the render's rows close up over the
    // drop (renderPlanValue's keptClips on every hop before the last).
    const edit = clipsEdit(withDecision(1, { keep: false }))
    const resolved = resolveEditPlanOutput(PLAN, edit).listResults!
    for (const hops of [SWITCHED, SWITCHED_PICK]) {
      for (const card of build({ hops, editedEdl: edit }).cards) {
        if (card.renderRow === undefined) expect(card.keep).toBe(false)
        else expect(renderClipKey(resolved, card.renderRow, hops)).toBe(card.clipKey)
      }
    }
  })

  it("behind Camera Switch, a selector after it picks from the kept clips; the dropped clip keeps a card with no render row", () => {
    const result = build({ hops: SWITCHED_PICK, editedEdl: clipsEdit(withDecision(1, { keep: false })) })
    expect(result.cards.map((c) => c.row)).toEqual([0, 1, 2, 3])
    expect(result.cards.map((c) => c.renderRow)).toEqual([0, undefined, 1, 2])
    expect(result.keptCount).toBe(3)
    expect(result.notSent).toBe(4)
  })

  it("behind Camera Switch with no selector, every card after the drop has the switch's row", () => {
    const result = build({ hops: SWITCHED, editedEdl: clipsEdit(withDecision(1, { keep: false })) })
    expect(result.cards.map((c) => c.row)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(result.cards.map((c) => c.renderRow)).toEqual([0, undefined, 1, 2, 3, 4, 5, 6])
    expect(result.notSent).toBe(0)
  })

  it("a dropped clip on a direct wire keeps its render row (the render reads a hole there)", () => {
    const edit = clipsEdit(withDecision(2, { keep: false }))
    const resolved = resolveEditPlanOutput(PLAN, edit).listResults!
    const card = build({ editedEdl: edit }).cards[2]!
    expect(card.renderRow).toBe(2)
    expect(renderClipKey(resolved, card.renderRow, DIRECT)).toBeUndefined()
  })

  it("is null for a plan that is not a clip set", () => {
    expect(buildClipCards({ plan: PLAN[0], editedEdl: undefined, renderData: {}, hops: DIRECT })).toBeNull()
  })
})

describe("the person's decisions", () => {
  it("an edited hook shows over the plan's, and the plan's stays at hand", () => {
    const card = build({ editedEdl: clipsEdit(withDecision(0, { keep: true, hook: "Nobody tells you this" })) }).cards[0]!
    expect(card).toMatchObject({ hook: "Nobody tells you this", plannedHook: "Hook 1", hookEdited: true })
  })

  it("an explicit empty hook is an edit, not the plan's hook", () => {
    const card = build({ editedEdl: clipsEdit(withDecision(0, { keep: true, hook: "" })) }).cards[0]!
    expect(card).toMatchObject({ hook: "", hookEdited: true })
  })

  it("pending decisions win over the stored edit (the not-yet-written hook)", () => {
    const stored = clipsEdit(withDecision(0, { keep: true, hook: "old" }))
    const card = build({ editedEdl: stored, decisions: withDecision(0, { keep: true, hook: "new" }) }).cards[0]!
    expect(card.hook).toBe("new")
  })

  it("a stale or invalid edit is ignored: every clip is kept as planned", () => {
    expect(clipDecisionsOf(PLAN, { ...clipsEdit(withDecision(0, { keep: false })), basis: "0000000000000000" })).toEqual(allKept())
    expect(clipDecisionsOf(PLAN, { ...clipsEdit([{ keep: false }]) })).toEqual(allKept())
    expect(clipDecisionsOf(PLAN, undefined)).toEqual(allKept())
    expect(clipDecisionsOf(PLAN[0], undefined)).toBeNull()
  })
})

describe("takes matched by clipKey", () => {
  it("the newest Preview and the newest Final of the clip", () => {
    const older = take(0, "proxy", { jobId: "old" })
    const newer = take(0, "proxy", { jobId: "new" })
    const card = build({ renderData: { generatedResults: [newer, take(0, "final"), older, take(1, "proxy")] } }).cards[0]!
    expect(card.preview).toMatchObject({ url: newer.url, jobId: "new", thumbnailUrl: newer.thumbnailUrl, quality: "proxy" })
    expect(card.final).toMatchObject({ jobId: "job-final-0", quality: "final" })
    expect(card.state).toBe("final-ready")
  })

  it("a kept clip's preview with no final shows the preview", () => {
    const card = build({ renderData: { generatedResults: [take(1, "proxy")] } }).cards[1]!
    expect(card.state).toBe("preview")
    expect(card.previewStale).toBe(false)
  })

  it("an audio render's preview is audio only", () => {
    const card = build({ renderData: { output: "audio", generatedResults: [take(1, "proxy")] } }).cards[1]!
    expect(card.state).toBe("audio-only")
    expect(card.preview?.medium).toBe("audio")
  })

  it("a dropped clip's final is a final not in this set", () => {
    const card = build({
      editedEdl: clipsEdit(withDecision(3, { keep: false })),
      renderData: { generatedResults: [take(3, "final")] },
    }).cards[3]!
    expect(card.state).toBe("final-not-in-set")
  })

  it("finals that match no card are orphans, newest per clip: a clip the plan no longer has, or one the wire no longer sends", () => {
    const gone = { ...take(0, "final"), clipKey: "999-1000", jobId: "gone-new" }
    const goneOld = { ...gone, jobId: "gone-old", url: "https://cdn.test/gone-old.mp4" }
    const unsent = take(6, "final")
    const shown = take(2, "final")
    const result = build({ hops: PICK_3, renderData: { generatedResults: [gone, unsent, shown, goneOld, { url: "https://cdn.test/unkeyed.mp4", quality: "final" }] } })
    expect(result.orphanFinals.map((f) => f.jobId)).toEqual(["gone-new", "job-final-6"])
  })
})

describe("unchanged since the last final (R13 a, R19 a)", () => {
  it("the same clip, plan value and render settings", () => {
    const result = build({ renderData: { generatedResults: [take(0, "final"), take(1, "final")] } })
    expect(result.cards[0]!.unchanged).toBe(true)
    expect(result.unchangedKept).toBe(2)
  })

  it("an edited hook leaves the final unchanged: renderers never read meta (R2 a)", () => {
    const result = build({
      editedEdl: clipsEdit(withDecision(0, { keep: true, hook: "rewritten" })),
      renderData: { generatedResults: [take(0, "final")] },
    })
    expect(result.cards[0]!.unchanged).toBe(true)
  })

  it("a re-plan that keeps the span but changes the cut is changed (not R13 b)", () => {
    const replanned = PLAN.map((c, i) => (i === 0 ? clip(0, true) : c))
    expect(planClipKeyAt(replanned, 0)).toBe(keyOf(0))
    const card = buildClipCards({ plan: replanned, editedEdl: undefined, renderData: { generatedResults: [take(0, "final")] }, hops: DIRECT, renderBases: allBases })!.cards[0]!
    expect(card.unchanged).toBe(false)
  })

  it("other render settings, or a final without its stamps, count as changed (fails open)", () => {
    expect(build({ renderData: { generatedResults: [take(0, "final", { renderBasis: "00000000000000bb" })] } }).cards[0]!.unchanged).toBe(false)
    expect(build({ renderData: { generatedResults: [take(0, "final", { planBasis: undefined })] } }).cards[0]!.unchanged).toBe(false)
    expect(build({ renderData: { generatedResults: [take(0, "final", { renderBasis: undefined })] } }).cards[0]!.unchanged).toBe(false)
    expect(build({ renderBases: new Map(), renderData: { generatedResults: [take(0, "final")] } }).cards[0]!.unchanged).toBe(false)
  })

  it("only kept clips count toward the footer's unchanged number", () => {
    const result = build({
      editedEdl: clipsEdit(withDecision(0, { keep: false })),
      renderData: { generatedResults: [take(0, "final"), take(1, "final")] },
    })
    expect(result.unchangedKept).toBe(1)
  })
})

describe("previewStale: the card's preview predates this plan", () => {
  it("a re-plan that keeps a clip's span but changes its cut marks the old preview", () => {
    const replanned = PLAN.map((c, i) => (i === 0 ? clip(0, true) : c))
    const card = buildClipCards({ plan: replanned, editedEdl: undefined, renderData: { generatedResults: [take(0, "proxy")] }, hops: DIRECT, renderBases: allBases })!.cards[0]!
    expect(card.preview).toBeDefined()
    expect(card.previewStale).toBe(true)
    expect(card.state).toBe("preview-stale")
  })

  it("an unstamped preview, or one made with other render settings, is stale", () => {
    expect(build({ renderData: { generatedResults: [take(0, "proxy", { planBasis: undefined })] } }).cards[0]!.previewStale).toBe(true)
    expect(build({ renderData: { generatedResults: [take(0, "proxy", { renderBasis: "00000000000000bb" })] } }).cards[0]!.previewStale).toBe(true)
    expect(build({ renderData: { generatedResults: [take(0, "proxy", { renderBasis: undefined })] } }).cards[0]!.previewStale).toBe(true)
  })

  it("no preview is never stale; settings unknown now judge the plan value alone", () => {
    expect(build().cards[0]!.previewStale).toBe(false)
    expect(build({ renderBases: new Map(), renderData: { generatedResults: [take(0, "proxy")] } }).cards[0]!.previewStale).toBe(false)
  })
})

// A Preview batch has ONE ROW PER RUN of the render (one per clip the run
// sent), never one per plan clip: a clip dropped at run time has no row. Both
// engines stamp every row with its clip's key, a failed row included (decided
// 2026-10-06), on the render's `__listResultStamps`; a card reads "Preview
// failed" when a row of the latest Preview batch names its clip and is empty.
describe("failed rows in the latest preview batch, matched by clipKey", () => {
  /** A Preview batch that ran on plan rows `ranOn`, where the rows in `failed`
   *  produced nothing. `stamps`: "keyed" (every row names its clip, as both
   *  engines stamp now), "legacy" (only landed rows carry a key, holes `{}`: a
   *  server run before this lane), or "none" (no stamps on the node). */
  const batchOn = (ranOn: readonly number[], failed: readonly number[], stamps: "keyed" | "legacy" | "none" = "keyed") => {
    const takes = ranOn.map((row) => (failed.includes(row) ? null : take(row, "proxy")))
    return {
      __listResults: takes.map((t) => t?.url ?? ""),
      generatedResults: takes.filter((t) => t !== null),
      ...(stamps === "none"
        ? {}
        : {
            __listResultStamps: ranOn.map((row, k) =>
              takes[k] ? { quality: "proxy", clipKey: keyOf(row) } : stamps === "keyed" ? { clipKey: keyOf(row) } : {},
            ),
          }),
    }
  }
  const ALL = PLAN.map((_, row) => row)
  const statesOf = (result: ReturnType<typeof build>) => Object.fromEntries(result.cards.map((c) => [c.row, c.state]))

  it("#1941: a direct wire, clip 2 of 4 dropped, the run on row 3 failed: the card of row 3 reads Preview failed (rows count from 0)", () => {
    const plan4 = PLAN.slice(0, 4)
    const editedEdl = {
      v: EDITED_EDL_VERSION,
      kind: "clips",
      basis: editPlanBasis(plan4),
      clips: plan4.map((_, row) => ({ keep: row !== 1 })),
    }
    // The fixture's case (apply-edl-clip-key.json): the render ran on rows [0, 2, 3].
    const result = buildClipCards({ plan: plan4, editedEdl, renderData: batchOn([0, 2, 3], [3]), hops: DIRECT, renderBases: allBases })!
    expect(statesOf(result)).toEqual({ 0: "preview", 1: "no-preview", 2: "preview", 3: "preview-failed" })
  })

  it("on the real engine batch, a failed run marks its own clip, not the one a dropped clip shifted onto it", () => {
    const ranOn = [0, 2, 3, 4, 5, 6, 7]
    const result = build({ renderData: batchOn(ranOn, [3]), editedEdl: clipsEdit(withDecision(1, { keep: false })) })
    expect(result.cards[2]!.state).toBe("preview")
    expect(result.cards[3]!.state).toBe("preview-failed")
    expect(result.cards[1]!.state).toBe("no-preview")
  })

  it("a range selector: only the rows it picked ran, and the failed one names its clip", () => {
    // PICK_3 picks rows 1–3; row 2 was dropped at run time, so the render ran on rows 1 and 3.
    const result = build({ hops: PICK_3, renderData: batchOn([1, 3], [3]), editedEdl: clipsEdit(withDecision(2, { keep: false })) })
    expect(statesOf(result)).toEqual({ 1: "preview", 2: "no-preview", 3: "preview-failed" })
  })

  it("behind Camera Switch the rows are the switch's, and the key still names the clip", () => {
    const ranOn = [0, 2, 3, 4, 5, 6, 7]
    const result = build({ hops: SWITCHED, renderData: batchOn(ranOn, [4]), editedEdl: clipsEdit(withDecision(1, { keep: false })) })
    expect(result.cards[4]!.state).toBe("preview-failed")
    expect(result.cards[3]!.state).toBe("preview")
    expect(result.cards[1]!.state).toBe("no-preview")
    const picked = build({ hops: SWITCHED_PICK, renderData: batchOn([0, 2, 3], [2]), editedEdl: clipsEdit(withDecision(1, { keep: false })) })
    expect(statesOf(picked)).toEqual({ 0: "preview", 1: "no-preview", 2: "preview-failed", 3: "preview" })
  })

  it("a clip no row names reads no preview yet", () => {
    const result = build({ renderData: batchOn([0, 1], [1]) })
    expect(result.cards[1]!.state).toBe("preview-failed")
    expect(result.cards.slice(2).map((c) => c.state)).toEqual(Array(6).fill("no-preview"))
  })

  it("a failed row names its clip even once that clip is dropped since: the row was sent and failed", () => {
    const result = build({ renderData: batchOn(ALL, [2]), editedEdl: clipsEdit(withDecision(2, { keep: false })) })
    expect(result.cards[2]!.state).toBe("preview-failed")
  })

  it("a clip whose take landed in the same batch is not failed, though another row naming it is empty", () => {
    // A row past the clips starts over from the first, so two rows can name one clip.
    const renderData = batchOn(ALL, [])
    const withRepeat = {
      ...renderData,
      __listResults: [...renderData.__listResults, ""],
      __listResultStamps: [...renderData.__listResultStamps!, { clipKey: keyOf(0) }],
    }
    expect(build({ renderData: withRepeat }).cards[0]!.state).toBe("preview")
  })

  it("only a Preview batch says a preview failed", () => {
    const finals = {
      __listResults: ["", take(1, "final").url],
      generatedResults: [take(1, "final")],
      __listResultStamps: [{ clipKey: keyOf(0) }, { quality: "final", clipKey: keyOf(1) }],
    }
    expect(build({ renderData: finals }).cards[0]!.state).toBe("no-preview")
  })

  // A Stop (or the fail-fast after another row failed) leaves rows that never
  // ran: each still names its clip, and is marked `cancelled` — never a failure.
  it("a row that never ran reads no preview yet, though it names its clip", () => {
    const renderData = batchOn(ALL, [3, 4, 5, 6, 7])
    const stopped = {
      ...renderData,
      __listResultStamps: renderData.__listResultStamps!.map((stamp, row) => (row >= 3 ? { ...stamp, cancelled: true } : stamp)),
    }
    expect(statesOf(build({ renderData: stopped }))).toEqual({
      0: "preview", 1: "preview", 2: "preview", 3: "no-preview", 4: "no-preview", 5: "no-preview", 6: "no-preview", 7: "no-preview",
    })
    // Beside a row that really failed, only that one reads failed.
    const oneFailed = { ...stopped, __listResultStamps: stopped.__listResultStamps.map((stamp, row) => (row === 3 ? { clipKey: keyOf(3) } : stamp)) }
    expect(build({ renderData: oneFailed }).cards.filter((c) => c.state === "preview-failed").map((c) => c.row)).toEqual([3])
  })

  // No row landed, so no take says the batch's quality: the rows say what they
  // were sent at (the browser lane writes such a batch; the server's throws).
  it("a batch where every row failed says Preview failed when its rows were sent at proxy", () => {
    const sentAt = (quality: "proxy" | "final", extra: Record<string, unknown> = {}) => ({
      __listResults: [""],
      generatedResults: [],
      __listResultStamps: [{ quality, clipKey: keyOf(2), ...extra }],
    })
    expect(build({ renderData: sentAt("proxy") }).cards[2]!.state).toBe("preview-failed")
    expect(build({ renderData: sentAt("final") }).cards[2]!.state).toBe("no-preview")
    expect(build({ renderData: sentAt("proxy", { cancelled: true }) }).cards[2]!.state).toBe("no-preview")
    // A keyed row with no quality says nothing about the batch.
    expect(build({ renderData: { __listResults: [""], __listResultStamps: [{ clipKey: keyOf(2) }] } }).cards[2]!.state).toBe("no-preview")
  })

  describe("a batch made before every row was keyed", () => {
    /** The browser lane's per-item inputs: the EDL each row was sent (`""` at a hole of the plan). */
    const inputsOn = (ranOn: readonly number[], plan: readonly unknown[] = PLAN) => ranOn.map((row) => JSON.stringify(plan[row]))

    it("names a hole's clip from the input the run sent it, on a direct wire", () => {
      for (const stamps of ["legacy", "none"] as const) {
        const result = build({ renderData: { ...batchOn(ALL, [2], stamps), __listInputs: inputsOn(ALL) } })
        expect(result.cards[2]!.state, stamps).toBe("preview-failed")
        expect(result.cards[3]!.state, stamps).toBe("preview")
      }
    })

    it("never by position: with no inputs (a server batch), a hole reads no preview yet", () => {
      for (const stamps of ["legacy", "none"] as const) {
        const result = build({ renderData: batchOn(ALL, [2], stamps) })
        expect(result.cards[2]!.state, stamps).toBe("no-preview")
      }
    })

    it("with a clip dropped at that run, the hole is the clip it was sent, not the one a drop shifted there", () => {
      const ranOn = [0, 2, 3, 4, 5, 6, 7]
      for (const stamps of ["legacy", "none"] as const) {
        const result = build({ renderData: { ...batchOn(ranOn, [3], stamps), __listInputs: inputsOn(ranOn) }, editedEdl: clipsEdit(withDecision(1, { keep: false })) })
        expect(result.cards.filter((c) => c.state === "preview-failed").map((c) => c.row), stamps).toEqual([3])
        const blind = build({ renderData: batchOn(ranOn, [3], stamps), editedEdl: clipsEdit(withDecision(1, { keep: false })) })
        expect(blind.cards.map((c) => c.state), stamps).not.toContain("preview-failed")
      }
    })

    // The review round of #1947: plan [A, B, C, D], B dropped at run time, so the
    // batch is [A, C, ""] (D failed). The person then re-plans to [A, C, X]: the
    // landed rows still sit at their cards' positions, but X was never sent.
    it("a re-plan that keeps the landed spans: the hole is the clip it was sent (D), never X", () => {
      const [A, , C, D] = PLAN
      const X = clip(6)
      const replanned = [A, C, X]
      const takeOf = (c: unknown) => ({ ...take(0, "proxy"), url: `https://cdn.test/${planClipKeyAt([c], 0)}.mp4`, clipKey: planClipKeyAt([c], 0), planBasis: renderReadBasis(c) })
      const landed = [takeOf(A), takeOf(C)]
      const renderData = {
        __listResults: [landed[0]!.url, landed[1]!.url, ""],
        generatedResults: landed,
        __listResultStamps: [{ quality: "proxy", clipKey: landed[0]!.clipKey }, { quality: "proxy", clipKey: landed[1]!.clipKey }, {}],
      }
      const bases = new Map(replanned.map((c) => [planClipKeyAt([c], 0)!, SETTINGS_BASIS]))
      const states = (data: Record<string, unknown>) =>
        buildClipCards({ plan: replanned, editedEdl: undefined, renderData: data, hops: DIRECT, renderBases: bases })!.cards.map((c) => c.state)
      // Without the inputs the run sent, the hole names no clip.
      expect(states(renderData)).toEqual(["preview", "preview", "no-preview"])
      // With them, it names D — which no card has — so X is not failed.
      expect(states({ ...renderData, __listInputs: [A, C, D].map((c) => JSON.stringify(c)) })).toEqual(["preview", "preview", "no-preview"])
    })

    it("inputs from another batch (a landed take is not its row's input) are not read", () => {
      const renderData = { ...batchOn(ALL, [2], "legacy"), __listInputs: inputsOn([1, 0, 2, 3, 4, 5, 6, 7]) }
      expect(build({ renderData }).cards[2]!.state).toBe("no-preview")
    })

    it("behind Camera Switch, never from the inputs (the switch moves a clip's edges)", () => {
      expect(build({ hops: SWITCHED, renderData: { ...batchOn(ALL, [2], "legacy"), __listInputs: inputsOn(ALL) } }).cards[2]!.state).toBe("no-preview")
    })
  })
})

describe("a live run (R9 a)", () => {
  it("cards in the set that have not landed are rendering; the run's progress is on the result", () => {
    const result = build({
      editedEdl: clipsEdit(withDecision(2, { keep: false })),
      renderData: { generatedResults: [take(0, "final")] },
      live: { quality: "final", landed: new Set([keyOf(0)]), done: 1, total: 7 },
    })
    expect(result.cards[0]!.state).toBe("final-ready")
    expect(result.cards[1]!.state).toBe("final-rendering")
    expect(result.cards[2]!.state).toBe("no-preview")
    expect(result.progress).toEqual({ done: 1, total: 7 })
  })

  it("an Update preview shows its clips as preview-rendering", () => {
    expect(build({ live: { quality: "proxy", landed: new Set(), done: 0, total: 8 } }).cards[0]!.state).toBe("preview-rendering")
  })
})

describe("clipRenderBases: the settings basis each clip's render would stamp now", () => {
  const settings = { output: "video" as const, crossfadeMs: 0 }
  it("keys every render row by the clip it cuts", () => {
    const resolved = resolveEditPlanOutput(PLAN, undefined).listResults!
    const renders = resolved.map((edl, row) => ({ row, edl, sources: [] as string[] }))
    const bases = clipRenderBases(renders, settings, resolved, DIRECT)
    expect(bases.size).toBe(8)
    expect(bases.get(keyOf(3))).toBe(renderSettingsBasisOf(renders[3], settings))
  })

  it("a dropped row (a hole) has no basis", () => {
    const resolved = resolveEditPlanOutput(PLAN, clipsEdit(withDecision(3, { keep: false }))).listResults!
    const renders = resolved.map((edl, row) => ({ row, edl, sources: [] as string[] }))
    const bases = clipRenderBases(renders, settings, resolved, DIRECT)
    expect(bases.has(keyOf(3))).toBe(false)
    expect(bases.size).toBe(7)
  })
})
