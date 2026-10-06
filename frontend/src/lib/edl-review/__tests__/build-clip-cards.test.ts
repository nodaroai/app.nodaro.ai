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

describe("holes in the latest preview batch", () => {
  const batch = (rows: Array<number | null>) => {
    const takes = rows.map((row) => (row === null ? null : take(row, "proxy")))
    return {
      __listResults: takes.map((t) => t?.url ?? ""),
      generatedResults: takes.filter((t) => t !== null),
    }
  }
  const BATCH = batch([0, 1, null, null, 4, 5, 6, 7])

  it("a sent row that failed (a plain row stamp) is preview-failed", () => {
    const stamps = PLAN.map(() => ({}))
    const result = build({ renderData: BATCH, rowStamps: stamps })
    expect(result.cards[2]!.state).toBe("preview-failed")
    expect(result.cards[0]!.state).toBe("preview")
  })

  it("a dropped clip's hole shows no preview yet, never failed (both engines stamp every hole `{}`)", () => {
    // No engine marks a skipped row, so a hole is failed only for a clip kept now.
    const stamps = PLAN.map(() => ({}))
    const result = build({ renderData: BATCH, rowStamps: stamps, editedEdl: clipsEdit(withDecision(3, { keep: false })) })
    expect(result.cards[3]!.state).toBe("no-preview")
    expect(result.cards[2]!.state).toBe("preview-failed")
  })

  it("with no row stamps at all, every hole shows no preview yet", () => {
    const result = build({ renderData: BATCH })
    expect(result.cards[2]!.state).toBe("no-preview")
    expect(result.cards[3]!.state).toBe("no-preview")
  })

  it("only a Preview batch says a preview failed", () => {
    const finals = { __listResults: ["", take(1, "final").url], generatedResults: [take(1, "final")] }
    expect(build({ renderData: finals, rowStamps: [{}, {}] }).cards[0]!.state).toBe("no-preview")
  })

  it("behind Camera Switch the batch's rows are the switch's, so a hole says nothing", () => {
    expect(build({ hops: SWITCHED, renderData: BATCH, rowStamps: PLAN.map(() => ({})) }).cards[2]!.state).toBe("no-preview")
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
