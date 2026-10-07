// Speaker View's budget covers the turn split (C2.4, decided 2026-10-07): the
// handler splits the edit at the transcript's turns AFTER dispatch, so the
// budget the dispatch site declares on the edit as given must cover the render
// of the split edit — at the slots the edit as given allows.
import { readFileSync } from "node:fs"
import { describe, it, expect } from "vitest"
import type { Edl, EdlSegment, EdlSource } from "@nodaro/shared"
import { declaredJobBudgetMs } from "../../../lib/job-budget.js"
import { edlTimelineRenderBudgetMs } from "../apply-edl-budget.js"
import { SPEAKER_VIEW_MAX_SLOTS, SPEAKER_VIEW_MIN_SHOT_MS, speakerViewJobBudgetMs, speakerViewWorstCaseSlots } from "../speaker-view-budget.js"

type Turn = [string | null, number, number]
interface FixtureCase {
  readonly name: string
  readonly edl: Edl
  readonly turns: Turn[] | null
  readonly transcriptAsString: boolean
  readonly split: Edl | "unchanged"
}
const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/speaker-view-turn-split.json", import.meta.url), "utf8")) as { minShotMs: number; cases: FixtureCase[] }

/** The fixture's words: one every 500 ms across each turn, 450 ms long. */
function talk(turns: readonly Turn[]) {
  const words: Array<{ text: string; startMs: number; endMs: number; speaker?: string }> = []
  for (const [speaker, a, b] of turns) {
    for (let t = a; t < b; t += 500) words.push({ text: "w", startMs: t, endMs: Math.min(t + 450, b), ...(speaker ? { speaker } : {}) })
  }
  return { version: 1, words }
}
const transcriptOf = (c: FixtureCase): unknown => (c.turns === null ? undefined : c.transcriptAsString ? JSON.stringify(talk(c.turns)) : talk(c.turns))

/** The budget of a render of `edl`, laid out at `slots` per segment. */
const renderBudget = (edl: Edl, slots: number) => edlTimelineRenderBudgetMs(edl, { output: "video", assumeSlots: slots })

describe("the plugin's own turn splits (fixture from plugin #747) fit the budget declared on the edit as given", () => {
  for (const c of FIXTURE.cases) {
    it(c.name, () => {
      const given = c.edl
      const slots = speakerViewWorstCaseSlots(given)
      const budget = speakerViewJobBudgetMs({ edl: given, transcript: transcriptOf(c) })!
      expect(budget).toBeGreaterThan(0)
      const rendered = c.split === "unchanged" ? given : c.split
      expect(budget).toBeGreaterThanOrEqual(renderBudget(rendered, slots))
      // never below the edit as given, which is the split with no cut
      expect(budget).toBeGreaterThanOrEqual(renderBudget(given, slots))
    })
  }

  it("a transcript with many turns just over the minimum shot raises the budget past the edit as given", () => {
    const dense = FIXTURE.cases.find((c) => c.name.startsWith("one 30-minute take"))!
    const split = dense.split as Edl
    expect(split.segments.length).toBeGreaterThan(600) // the case is what it says
    const slots = speakerViewWorstCaseSlots(dense.edl)
    expect(renderBudget(split, slots)).toBeGreaterThan(renderBudget(dense.edl, slots)) // the split costs more
    expect(speakerViewJobBudgetMs({ edl: dense.edl, transcript: transcriptOf(dense) })!).toBeGreaterThanOrEqual(renderBudget(split, slots))
  })

  // The minimum shot (2.5 s) is the one rule of the plugin the bound is built
  // on, so it is pinned by what the plugin DOES, not only by a constant: the
  // fixture carries the plugin's own export, and its splits are checked for
  // cuts closer together than the app believes the plugin allows.
  describe("the 2.5 s minimum shot is pinned by the plugin's own output", () => {
    /** Gaps between consecutive cut points of one split: the starts of the pieces
     *  after a segment's first (`id.1`, `id.2`, ...), never the edit's own segment
     *  boundaries, which the plugin does not choose. */
    const cutGaps = (split: Edl): number[] => {
      const cuts = split.segments.filter((s) => /\.[1-9]\d*(~\d+)?$/.test(s.id)).map((s) => s.inMs).sort((a, b) => a - b)
      return cuts.slice(1).map((c, i) => c - cuts[i]!)
    }
    const splitOf = (c: FixtureCase): Edl => c.split as Edl

    it("the app's constant is the plugin's export", () => {
      expect(SPEAKER_VIEW_MIN_SHOT_MS).toBe(FIXTURE.minShotMs)
    })

    it("no split the plugin made has two cuts closer than the minimum shot", () => {
      for (const c of FIXTURE.cases.filter((x) => x.split !== "unchanged")) {
        for (const gap of cutGaps(splitOf(c))) expect(gap, c.name).toBeGreaterThanOrEqual(SPEAKER_VIEW_MIN_SHOT_MS)
      }
    })

    it("the densest cuts the plugin makes are a hair over the minimum, so the constant is not slack", () => {
      const dense = FIXTURE.cases.find((c) => c.name.startsWith("minimum shot: a 10-minute take, turns alternating every 2.501 s"))!
      const split = splitOf(dense)
      expect(split.segments.length).toBeGreaterThan(200)
      const gaps = cutGaps(split)
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(SPEAKER_VIEW_MIN_SHOT_MS)
      expect(Math.min(...gaps)).toBeLessThan(SPEAKER_VIEW_MIN_SHOT_MS + 100)
    })

    it("turns whose words end under the minimum shot hold: the plugin names the segment and cuts nothing", () => {
      const held = FIXTURE.cases.find((c) => c.name.startsWith("minimum shot: a 10-minute take, turns alternating every 2.5 s "))!
      expect(splitOf(held).segments).toHaveLength(1)
    })
  })

  it("an edit the split leaves as it is keeps exactly the budget of the edit as given", () => {
    for (const c of FIXTURE.cases.filter((x) => x.split === "unchanged")) {
      expect(speakerViewJobBudgetMs({ edl: c.edl, transcript: transcriptOf(c) }), c.name).toBe(renderBudget(c.edl, speakerViewWorstCaseSlots(c.edl)))
    }
  })
})

describe("the turn-split bound reads the payload the way every reader sees it", () => {
  const MIC: EdlSource = { id: "mic", url: "https://f.test/mic.wav", kind: "audio", role: "master-audio" }
  const WIDE: EdlSource = { id: "wide", url: "https://f.test/wide.mp4", kind: "video" }
  const take = (ms: number): Edl => ({ version: 1, clock: "master", sources: [MIC, WIDE], segments: [{ id: "s0", inMs: 0, outMs: ms, video: "wide" }] } as unknown as Edl)
  const labelled = talk([["Host", 0, 10_000], ["Guest", 10_000, 20_000]])

  it("sizes on the slots of the edit AS GIVEN: the split's transcript labels never narrow an unnamed edit's six", () => {
    const edl = take(10 * 60_000)
    expect(speakerViewWorstCaseSlots(edl)).toBe(SPEAKER_VIEW_MAX_SLOTS)
    const budget = speakerViewJobBudgetMs({ edl, transcript: labelled })!
    expect(budget).toBeGreaterThanOrEqual(renderBudget(edl, SPEAKER_VIEW_MAX_SLOTS))
  })

  it("a transcript sent as its JSON string reads like the object", () => {
    const edl = take(10 * 60_000)
    expect(speakerViewJobBudgetMs({ edl, transcript: JSON.stringify(labelled) })).toBe(speakerViewJobBudgetMs({ edl, transcript: labelled }))
  })

  it("a jobs row whose transcript was slimmed to its word count reads the bound, never the edit as given", () => {
    const edl = take(10 * 60_000)
    const row = { edl, transcriptWordCount: 3_000, type: "speaker-view", node_id: "n1" }
    expect(speakerViewJobBudgetMs(row)).toBe(speakerViewJobBudgetMs({ edl, transcript: labelled }))
    expect(speakerViewJobBudgetMs(row)!).toBeGreaterThan(renderBudget(edl, SPEAKER_VIEW_MAX_SLOTS))
  })

  it("an unreadable or unlabelled transcript splits nothing (the plugin returns the edit as it is)", () => {
    const edl = take(10 * 60_000)
    const given = renderBudget(edl, SPEAKER_VIEW_MAX_SLOTS)
    for (const transcript of [undefined, null, "", "not json", { words: [] }, talk([[null, 0, 60_000]]), [labelled]]) {
      expect(speakerViewJobBudgetMs({ edl, transcript }), JSON.stringify(transcript)?.slice(0, 40)).toBe(given)
    }
  })
})

// ── The bound against ANY split the rules allow ────────────────────────────
// The plugin's rules, as far as the bound relies on them: only segments that
// name no speaker are cut; every cut is a point of ONE shot timeline on the
// master clock, consecutive points at least the minimum shot apart; each piece
// keeps the segment's sources; the first keeps its transition and switch, the
// others carry none; a crossfade too long for a shortened neighbour is cut to
// 0.9 × the shorter (never removed). Which cuts land (slivers joined, short
// turns held) can only remove cuts, so a random SUBSET of a random admissible
// timeline covers every split the plugin can make.

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomEdit(r: () => number): Edl {
  const cams = 1 + Math.floor(r() * 3)
  const sources: EdlSource[] = [
    { id: "mic", url: "https://f.test/mic.wav", kind: "audio", role: "master-audio" },
    ...Array.from({ length: cams }, (_, i) => ({ id: `cam${i}`, url: `https://f.test/${i}.mp4`, kind: "video" as const, ...(r() < 0.3 ? { offsetMs: Math.floor(r() * 5_000) } : {}) })),
  ]
  const n = 1 + Math.floor(r() * 40)
  let t = Math.floor(r() * 10_000)
  const segments: EdlSegment[] = []
  for (let i = 0; i < n; i++) {
    const dur = r() < 0.3 ? 100 + Math.floor(r() * 3_000) : 1_000 + Math.floor(r() * 240_000)
    if (r() < 0.1) t = Math.max(0, t - Math.floor(r() * 60_000)) // an edit may go back in time
    const crossfade = i > 0 && r() < 0.35 ? { transition: { type: "crossfade" as const, durationMs: 50 + Math.floor(r() * 1_500) } } : {}
    segments.push({
      id: `g${i}`, inMs: t, outMs: t + dur, video: `cam${Math.floor(r() * cams)}`,
      ...(r() < 0.15 ? { speaker: r() < 0.5 ? "Host" : "Guest" } : {}),
      ...(r() < 0.1 ? { audio: `cam${Math.floor(r() * cams)}` } : {}),
      ...crossfade,
    } as EdlSegment)
    t += dur + (r() < 0.6 ? Math.floor(r() * 20_000) : 0)
  }
  return { version: 1, clock: "master", sources, segments } as unknown as Edl
}

/** A split the rules allow: a shot timeline with points ≥ the minimum shot
 *  apart (`dense`: exactly that), a random subset of them landing. */
function randomSplit(edl: Edl, r: () => number, dense: boolean): Edl {
  const lo = Math.min(...edl.segments.map((s) => s.inMs))
  const hi = Math.max(...edl.segments.map((s) => s.outMs))
  const cuts: number[] = []
  for (let c = lo + Math.floor(r() * SPEAKER_VIEW_MIN_SHOT_MS); c < hi; c += SPEAKER_VIEW_MIN_SHOT_MS + (dense ? 0 : Math.floor(r() * 8_000))) {
    if (dense || r() < 0.8) cuts.push(c)
  }
  const segments = edl.segments.flatMap((seg): EdlSegment[] => {
    if (typeof seg.speaker === "string" && seg.speaker) return [seg]
    const at = cuts.filter((c) => c > seg.inMs && c < seg.outMs)
    const bounds = [seg.inMs, ...at, seg.outMs]
    return bounds.slice(1).map((end, k) => {
      const piece = { ...seg, id: `${seg.id}.${k}`, inMs: bounds[k]!, outMs: end, speaker: k % 2 ? "Guest" : "Host" } as EdlSegment
      if (k === 0) return piece
      const { transition: _t, layout, ...rest } = piece
      if (!layout) return rest as EdlSegment
      const { transition: _s, ...still } = layout
      return { ...rest, layout: still } as EdlSegment
    })
  })
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]!
    const tr = seg.transition
    if (tr?.type !== "crossfade" || typeof tr.durationMs !== "number") continue
    const limit = Math.floor(0.9 * Math.min(seg.outMs - seg.inMs, segments[i - 1]!.outMs - segments[i - 1]!.inMs))
    if (tr.durationMs > limit) segments[i] = { ...seg, transition: { ...tr, durationMs: Math.max(1, limit) } }
  }
  return { ...edl, segments }
}

describe("the bound holds for every split the rules allow (property, seeded)", () => {
  const transcript = talk([["Host", 0, 10_000], ["Guest", 10_000, 20_000]])

  it("random edits, random admissible cut sets — crossfades, offsets, own sound, edits going back in time", () => {
    const r = rng(20261007)
    for (let i = 0; i < 400; i++) {
      const edl = randomEdit(r)
      const slots = speakerViewWorstCaseSlots(edl)
      const budget = speakerViewJobBudgetMs({ edl, transcript })!
      const split = randomSplit(edl, r, i % 3 === 0)
      expect(budget, `case ${i}`).toBeGreaterThanOrEqual(renderBudget(split, slots))
    }
  })

  it("crossfade runs too short to cut (the planner's wide slices), with and without long stretches between them", () => {
    const r = rng(1009)
    for (let i = 0; i < 150; i++) {
      const sources = [{ id: "mic", url: "https://f.test/m.wav", kind: "audio", role: "master-audio" }, { id: "w", url: "https://f.test/w.mp4", kind: "video" }, { id: "v", url: "https://f.test/v.mp4", kind: "video" }]
      const segments: EdlSegment[] = []
      let t = 0
      const n = 10 + Math.floor(r() * 120)
      for (let j = 0; j < n; j++) {
        const long = r() < 0.15
        const dur = long ? 5_000 + Math.floor(r() * 60_000) : 200 + Math.floor(r() * 600)
        segments.push({
          id: `c${j}`, inMs: t, outMs: t + dur, video: r() < 0.5 ? "w" : "v",
          ...(j > 0 && r() < 0.9 ? { transition: { type: "crossfade" as const, durationMs: 300 + Math.floor(r() * 1_200) } } : {}),
          ...(r() < 0.1 ? { speaker: "Host" } : {}),
        } as EdlSegment)
        t += dur + (r() < 0.5 ? 1_000 : 0)
      }
      const edl = { version: 1, clock: "master", sources, segments } as unknown as Edl
      const split = randomSplit(edl, r, i % 2 === 0)
      expect(speakerViewJobBudgetMs({ edl, transcript })!, `case ${i}`).toBeGreaterThanOrEqual(renderBudget(split, speakerViewWorstCaseSlots(edl)))
    }
  })

  it("the densest split the minimum shot allows, on long takes", () => {
    const r = rng(7)
    for (const minutes of [1, 15, 60, 179]) {
      const edl = { version: 1, clock: "master", sources: [{ id: "mic", url: "https://f.test/m.wav", kind: "audio", role: "master-audio" }, { id: "w", url: "https://f.test/w.mp4", kind: "video" }], segments: [{ id: "s", inMs: 0, outMs: minutes * 60_000, video: "w" }] } as unknown as Edl
      const split = randomSplit(edl, r, true)
      expect(speakerViewJobBudgetMs({ edl, transcript })!, `${minutes} min`).toBeGreaterThanOrEqual(renderBudget(split, speakerViewWorstCaseSlots(edl)))
    }
  })
})

describe("the plugin's own queue payload declares a budget", () => {
  // Copied from the plugin's `SPEAKER_VIEW_JOB_PAYLOAD_EXAMPLE` (`contract.ts`),
  // which its own test pins to what the route really queues.
  const SPEAKER_VIEW_JOB_PAYLOAD_EXAMPLE = {
    jobId: "00000000-0000-4000-8000-0000000000a1",
    usageLogId: "00000000-0000-4000-8000-0000000000b2",
    edl: {
      version: 1,
      clock: "master",
      sources: [
        { id: "mic", url: "https://media.example/mic.wav", kind: "audio", role: "master-audio" },
        { id: "camA", url: "https://media.example/cam-a.mp4", kind: "video", speakers: ["Host"] },
        { id: "camB", url: "https://media.example/cam-b.mp4", kind: "video", offsetMs: 4_000, speakers: ["Guest"] },
      ],
      segments: [
        { id: "s0", inMs: 0, outMs: 30_000, video: "camA", speaker: "Host" },
        { id: "s1", inMs: 30_000, outMs: 75_000, video: "camB", speaker: "Guest", transition: { type: "cut" } },
      ],
      meta: { targetAspect: "9:16" },
    },
    transcript: { version: 1, words: [{ text: "Welcome", startMs: 200, endMs: 640, speaker: "Host" }] },
    quality: "proxy",
    targetAspect: "9:16",
    layout: "single",
    switch: { type: "cut" },
    speakerRegions: [{ source: "camA", speaker: "Host", region: { x: 0.2, y: 0, w: 0.5, h: 1 } }],
    clipKey: "0-75000",
    reservedCreditId: "speaker-view:proxy",
    workflowId: "00000000-0000-4000-8000-0000000000c3",
    nodeId: "speaker-view-1",
  }

  it("is defined, and — every segment named — is the budget of the edit as given", () => {
    const budget = declaredJobBudgetMs("speaker-view", SPEAKER_VIEW_JOB_PAYLOAD_EXAMPLE)
    expect(budget).toBeGreaterThan(0)
    const edl = SPEAKER_VIEW_JOB_PAYLOAD_EXAMPLE.edl as unknown as Edl
    expect(budget).toBe(renderBudget(edl, speakerViewWorstCaseSlots(edl)))
  })
})
