/**
 * Trim, Loop, Combine Videos and Video SFX are charged by the length of the
 * video they are given. On a recording the app's user or a template's cloner
 * replaces, that length is not known when the listing is priced, so the
 * listing prices them per minute of the recording, like Apply EDL and Edit
 * Plan (decided 2026-10-07): never below what a run of a recording that long
 * is charged. A recording whose length is known (one the user cannot replace)
 * is priced at its length, and a render's output at the render's own length,
 * per minute when the render's is (decided 2026-10-07). Video SFX on any
 * recording the user replaces lists its fixed 300-second row (decided
 * 2026-10-07).
 *
 * Guards compare against the SAME estimators the run charges with
 * (`videoUtilityBaseCredits`, the Video SFX row for the clip's length), at
 * `STATIC_CREDIT_COSTS`' base prices.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CreditsService, STATIC_CREDIT_COSTS } from "../credits.js"
import { videoUtilityBaseCredits } from "../../../lib/video-utility-credits.js"
import { VIDEO_SFX_PRICING, videoSfxCreditId, VIDEO_DURATION_AUTO, pricedOutputDurationSec, MODEL_CATALOG, extractVideoDurationFromNode, uiResolutionFill } from "@nodaro/shared"
import { resolveVideoRequestNorm } from "../../../lib/video-request-norm.js"

type N = { id: string; type: string; data?: Record<string, unknown> }
type E = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: Record<string, unknown> }

const upload = (duration?: number): N => ({ id: "rec", type: "upload-video", data: { url: "https://cdn/sample.mp4", ...(duration ? { duration } : {}) } })
const fromRec = (target: string, targetHandle = "video"): E[] => [{ source: "rec", target, targetHandle }]
const listingOf = (nodes: N[], edges: E[], replaced: boolean) =>
  CreditsService.estimateWorkflowBaseListing(nodes, edges, "app", { replaceableMediaNodeIds: new Set(replaced ? ["rec"] : []) })
const at = (l: { preview: number; previewPerMinute: number }, minutes: number) => l.preview + l.previewPerMinute * minutes

const MINUTES = [1, 2, 3, 7, 45, 61, 180]
/** A recording of `m` started minutes: the longest and a short one inside it. */
const lengthsIn = (m: number) => [m * 60, m * 60 - 59]

const ops: Array<[string, N, (sec: number) => number]> = [
  ["trim-video (seconds)", { id: "op", type: "trim-video", data: { trimMode: "seconds", trimStartSeconds: 1 } }, (sec) => videoUtilityBaseCredits("trim-video", { trimMode: "seconds", trimStartSeconds: 1, upstreamDuration: sec })!],
  ["trim-video (smart loop cut)", { id: "op", type: "trim-video", data: { trimMode: "smart-loop-cut" } }, (sec) => videoUtilityBaseCredits("trim-video", { trimMode: "smart-loop-cut", upstreamDuration: sec })!],
  // Its own repeat count is left at the default (2 copies): a `repeatCount` on
  // the node is also read as the node's Repeat xN (a separate, existing rule).
  ["loop-video", { id: "op", type: "loop-video", data: { mode: "repeat" } }, (sec) => videoUtilityBaseCredits("loop-video", { mode: "repeat", upstreamDuration: sec })!],
  [
    "combine-videos",
    { id: "op", type: "combine-videos", data: {} },
    (sec) => videoUtilityBaseCredits("combine-videos", { transition: "cut", transitionDuration: 0.5, trimStartFrames: 1, trimEndFrames: 2, videoUrls: [""], upstreamDurations: [sec] })!,
  ],
]

describe("on a replaced recording: per minute, never below the charge", () => {
  it.each(ops)("%s", (_label, op, charged) => {
    const l = listingOf([upload(8), op], fromRec("op"), true)
    expect(l.previewPerMinute).toBeGreaterThan(0)
    for (const m of MINUTES) for (const sec of lengthsIn(m)) expect(at(l, m), `${m} min (${sec}s)`).toBeGreaterThanOrEqual(charged(sec))
  })

  it("the sample's length is not the user's: an hour-long sample lists like an 8-second one", () => {
    const [, op] = ops[0]!
    expect(listingOf([upload(3600), op], fromRec("op"), true)).toEqual(listingOf([upload(8), op], fromRec("op"), true))
  })

  it("a trim that keeps a fixed window does not follow the recording's length", () => {
    const op: N = { id: "op", type: "trim-video", data: { trimMode: "time", startTime: 0, endTime: 20 } }
    const l = listingOf([upload(), op], fromRec("op"), true)
    expect(l.previewPerMinute).toBe(0)
    expect(l.preview).toBe(videoUtilityBaseCredits("trim-video", { trimMode: "time", startTime: 0, endTime: 20, upstreamDuration: 3600 }))
  })
})

describe("Video SFX on a replaced recording", () => {
  // Decided 2026-10-07: a run refuses a clip over 300 s, so the 300-second row
  // is the most a run of any recording is charged. The listing is that row,
  // fixed, not a figure per minute of the episode.
  const sfx: N = { id: "op", type: "video-sfx", data: {} }
  const maxRow = STATIC_CREDIT_COSTS[videoSfxCreditId(VIDEO_SFX_PRICING.MAX_DURATION_SEC)]!

  it("lists the fixed 300-second row, with no per-minute part", () => {
    const l = listingOf([upload(8), sfx], fromRec("op"), true)
    expect(l.previewPerMinute).toBe(0)
    expect(l.preview).toBe(maxRow)
  })

  it("never below the row a recording that long is charged (a run refuses past 5 minutes)", () => {
    const l = listingOf([upload(8), sfx], fromRec("op"), true)
    for (let sec = 1; sec <= VIDEO_SFX_PRICING.MAX_DURATION_SEC; sec++) {
      const m = Math.ceil(sec / 60)
      expect(at(l, m), `${sec}s`).toBeGreaterThanOrEqual(STATIC_CREDIT_COSTS[videoSfxCreditId(sec)]!)
    }
  })

  it("the sample's length is not the user's: an hour-long sample lists like an 8-second one", () => {
    expect(listingOf([upload(3600), sfx], fromRec("op"), true)).toEqual(listingOf([upload(8), sfx], fromRec("op"), true))
  })

  // Decided 2026-10-07: ANY recording the user replaces, not only the episode.
  // A second recording beside the episode (an intro card) has no unit in the
  // listing, but a run of it is never charged above the 300-second row either.
  it("on a second recording the user replaces beside the episode (an intro card): the 300-second row too", () => {
    const nodes: N[] = [
      { id: "rec", type: "upload-video", data: {} },
      { id: "card", type: "upload-video", data: { duration: 8 } },
      { id: "stt", type: "transcribe", data: { provider: "elevenlabs-stt" } },
      sfx,
    ]
    const edges: E[] = [
      { source: "rec", target: "stt", targetHandle: "audio" },
      { source: "card", target: "op", targetHandle: "video" },
    ]
    const l = CreditsService.estimateWorkflowBaseListing(nodes, edges, "template")
    const withoutOp = CreditsService.estimateWorkflowBaseListing(nodes.slice(0, 3), edges.slice(0, 1), "template")
    expect(l.preview - withoutOp.preview).toBe(maxRow)
    expect(l.previewPerMinute).toBe(withoutOp.previewPerMinute)
  })
})

describe("the docs state the Video SFX listing", () => {
  const DOCS = join(__dirname, "..", "..", "..", "..", "..", "docs")
  const read = (rel: string) => readFileSync(join(DOCS, rel), "utf8").replace(/\s+/g, " ")
  it.each(["nodes/processing-video/apply-edl.md", "app-view-modes.md", "deployment.md", "nodes/ai-video/video-sfx.md"])("%s", (rel) => {
    const text = read(rel)
    expect(text, rel).toMatch(/Video SFX[^.]*300-second/)
    expect(text, rel).not.toMatch(/Video SFX node on (the|that) (episode )?recording[^.;]*per minute/)
  })

  // The fixed 300-second listing covers any recording the user replaces, a
  // second one such as an intro card included (decided 2026-10-07).
  it("video-sfx.md lists any recording the user replaces at the 300-second price", () => {
    const text = read("nodes/ai-video/video-sfx.md")
    expect(text).toMatch(/Video SFX node on any recording the app's or template's user replaces[^.]*300-second/)
    expect(text).not.toMatch(/second recording the user replaces[^.]*8-second bucket/)
    expect(text).toMatch(/rendered video[^.]*render's estimated length/)
  })

  // A generated video lists at its configured duration (decided 2026-10-07).
  it.each(["nodes/processing-video/apply-edl.md", "app-view-modes.md", "deployment.md", "nodes/ai-video/video-sfx.md"])(
    "%s lists a generated video at its configured duration",
    (rel) => {
      const text = read(rel)
      expect(text, rel).toMatch(/generated video[^.]*configured duration/)
      expect(text, rel).not.toMatch(/generated video[^.]*8-second bucket/)
    },
  )
})

describe("on a recording the user cannot replace: fixed at its length", () => {
  it.each(ops)("%s", (_label, op, charged) => {
    const l = listingOf([upload(30 * 60), op], fromRec("op"), false)
    expect(l.previewPerMinute).toBe(0)
    expect(l.preview).toBe(charged(30 * 60))
  })

  it("video-sfx", () => {
    const l = listingOf([upload(100), { id: "op", type: "video-sfx", data: {} }], fromRec("op"), false)
    expect(l).toMatchObject({ preview: STATIC_CREDIT_COSTS[videoSfxCreditId(100)], previewPerMinute: 0 })
  })

  // The length is the video wire's, whatever order the wires are in: with the
  // prompt wired first, the recording still prices the node.
  it("video-sfx with its prompt wired before the video", () => {
    const sfx: N = { id: "op", type: "video-sfx", data: {} }
    const prompt: N = { id: "p", type: "text", data: { text: "rain on a tin roof" } }
    const promptWire: E = { source: "p", target: "op", targetHandle: "prompt" }
    const promptFirst = listingOf([prompt, upload(200), sfx], [promptWire, ...fromRec("op")], false)
    const videoFirst = listingOf([prompt, upload(200), sfx], [...fromRec("op"), promptWire], false)
    expect(promptFirst).toMatchObject({ preview: STATIC_CREDIT_COSTS[videoSfxCreditId(200)], previewPerMinute: 0 })
    expect(promptFirst).toEqual(videoFirst)
  })
})

// The per-minute figure counts the EPISODE — the recording wired into an Edit
// Plan or a Transcribe, or the only one. A second recording the user gives
// (Trailer + Formats' intro card) has no unit in the listing and stays at the
// estimators' fallback length for Trim, Loop and Combine Videos, the one
// documented exception left (decided 2026-10-07). This pin fails when it is
// priced: then drop it from the "never quotes less" sentences.
describe("not the episode: listed at the fallback length", () => {
  const nodes: N[] = [
    { id: "rec", type: "upload-video", data: {} },
    { id: "card", type: "upload-video", data: {} },
    { id: "stt", type: "transcribe", data: { provider: "elevenlabs-stt" } },
    { id: "op", type: "combine-videos", data: { trimStartFrames: 0, trimEndFrames: 0 } },
  ]
  const edges: E[] = [
    { source: "rec", target: "stt", targetHandle: "audio" },
    { source: "card", target: "op", targetHandle: "video" },
    { source: "rec", target: "op", targetHandle: "video" },
  ]

  it("a second recording the user gives beside the episode (an intro card; decided 2026-10-07)", () => {
    const l = CreditsService.estimateWorkflowBaseListing(nodes, edges, "template")
    const withoutOp = CreditsService.estimateWorkflowBaseListing(nodes.slice(0, 3), edges.slice(0, 1), "template")
    // The episode input is per minute; the card stays at the 8-second fallback.
    for (const m of MINUTES) {
      expect(at(l, m) - at(withoutOp, m), `${m} min`).toBeGreaterThanOrEqual(combineCharge([undefined, m * 60]))
    }
    expect(l.preview - withoutOp.preview).toBe(combineCharge([undefined, 0]))
  })
})

const combineCharge = (durations: Array<number | undefined>) =>
  videoUtilityBaseCredits("combine-videos", { transition: "cut", transitionDuration: 0.5, trimStartFrames: 0, trimEndFrames: 0, videoUrls: durations.map(() => ""), upstreamDurations: durations })!

// A render's output is as long as the render's own estimate (decided
// 2026-10-07): per minute of the episode when the render is (a Tighten), fixed
// when it is not (a Trailer at 2 minutes). A step priced by its input's length
// on it lists by the same rule, never below what a run of that length charges.
describe("on a render's output: the render's length, per minute when the render's is", () => {
  const renderGraph = (mode: string): { graph: N[]; wires: E[] } => ({
    graph: [
      upload(),
      { id: "plan", type: "edit-plan", data: { mode, planTier: "standard" } },
      { id: "render", type: "apply-edl", data: { quality: "final" } },
    ],
    wires: [
      { source: "rec", target: "plan", sourceHandle: "video", targetHandle: "sources" },
      { source: "plan", target: "render", sourceHandle: "edl", targetHandle: "edl" },
    ],
  })
  /** The listing with and without the step `op`, wired from the render on `handle`. */
  const withAndWithout = (mode: string, op: N, handle: string) => {
    const { graph, wires } = renderGraph(mode)
    const withOp = listingOf([...graph, op], [...wires, { source: "render", target: "op", sourceHandle: "media", targetHandle: handle }], true)
    const without = listingOf(graph, wires, true)
    return { withOp, without, delta: (m: number) => at(withOp, m) - at(without, m) }
  }

  const onRender: Array<[string, N, string, (sec: number) => number]> = [
    ["combine-videos", { id: "op", type: "combine-videos", data: { trimStartFrames: 0, trimEndFrames: 0 } }, "in", (sec) => combineCharge([sec])],
    [
      "trim-video (seconds)",
      { id: "op", type: "trim-video", data: { trimMode: "seconds", trimStartSeconds: 1 } },
      "in",
      (sec) => videoUtilityBaseCredits("trim-video", { trimMode: "seconds", trimStartSeconds: 1, upstreamDuration: sec })!,
    ],
    ["loop-video", { id: "op", type: "loop-video", data: { mode: "repeat" } }, "in", (sec) => videoUtilityBaseCredits("loop-video", { mode: "repeat", upstreamDuration: sec })!],
  ]

  it.each(onRender)("%s on a Tighten's render: per minute, never below the charge", (_label, op, handle, charged) => {
    const { withOp, without, delta } = withAndWithout("tighten", op, handle)
    expect(withOp.previewPerMinute).toBeGreaterThan(without.previewPerMinute)
    for (const m of MINUTES) for (const sec of lengthsIn(m)) expect(delta(m), `${m} min (${sec}s)`).toBeGreaterThanOrEqual(charged(sec))
  })

  it.each(onRender)("%s on a Trailer's render: fixed at the render's 2 minutes", (_label, op, handle, charged) => {
    const { withOp, without } = withAndWithout("trailer", op, handle)
    expect(withOp.previewPerMinute).toBe(without.previewPerMinute)
    expect(withOp.preview - without.preview).toBe(charged(2 * 60))
  })

  it("video-sfx on a Tighten's render: the fixed 300-second row", () => {
    const { withOp, without } = withAndWithout("tighten", { id: "op", type: "video-sfx", data: {} }, "video")
    expect(withOp.previewPerMinute).toBe(without.previewPerMinute)
    expect(withOp.preview - without.preview).toBe(STATIC_CREDIT_COSTS[videoSfxCreditId(VIDEO_SFX_PRICING.MAX_DURATION_SEC)])
  })

  it("video-sfx on a Trailer's render: the render's 2-minute bucket", () => {
    const { withOp, without } = withAndWithout("trailer", { id: "op", type: "video-sfx", data: {} }, "video")
    expect(withOp.previewPerMinute).toBe(without.previewPerMinute)
    expect(withOp.preview - without.preview).toBe(STATIC_CREDIT_COSTS[videoSfxCreditId(2 * 60)])
  })

  // Trailer + Formats: the intro card (the fallback) and the trailer render
  // (its 2 minutes) into one Combine.
  it("combine-videos on an intro card and a Trailer's render", () => {
    const { graph, wires } = renderGraph("trailer")
    const card: N = { id: "card", type: "upload-video", data: {} }
    const op: N = { id: "op", type: "combine-videos", data: { trimStartFrames: 0, trimEndFrames: 0 } }
    const replaced = { replaceableMediaNodeIds: new Set(["rec", "card"]) }
    const withOp = CreditsService.estimateWorkflowBaseListing(
      [...graph, card, op],
      [...wires, { source: "card", target: "op", targetHandle: "in" }, { source: "render", target: "op", sourceHandle: "media", targetHandle: "in" }],
      "app",
      replaced,
    )
    const without = CreditsService.estimateWorkflowBaseListing([...graph, card], wires, "app", replaced)
    expect(withOp.preview - without.preview).toBe(combineCharge([undefined, 2 * 60]))
    expect(withOp.previewPerMinute).toBe(without.previewPerMinute)
  })
})

// Review round (decided 2026-10-07): a step fed by ANOTHER length-priced
// step's output lists by the length that step passes on, as on a render's.
// Trim keeps its input's length (a fixed window: the window), Loop multiplies
// it by its copy count, Combine Videos sums its inputs, and Video SFX keeps it,
// capped at the 300 seconds a run accepts. Before, the chain stood at the
// estimators' 8-second fallback: on a 5-minute episode, rec -> Trim -> Video
// SFX was charged the 300-second row and listed the 8-second one.
describe("on another step's output: the length that step passes on", () => {
  const trim: N = { id: "trim", type: "trim-video", data: { trimMode: "seconds", trimStartSeconds: 1 } }
  const trimCharge = (sec: number) => videoUtilityBaseCredits("trim-video", { trimMode: "seconds", trimStartSeconds: 1, upstreamDuration: sec })!
  const maxRow = STATIC_CREDIT_COSTS[videoSfxCreditId(VIDEO_SFX_PRICING.MAX_DURATION_SEC)]!
  /** The listing with and without `op`, wired from `from`; `rec` is the replaced episode. */
  const delta = (graph: N[], wires: E[], op: N, from: string, handle: string) => {
    const withOp = listingOf([...graph, op], [...wires, { source: from, target: op.id, targetHandle: handle }], true)
    const without = listingOf(graph, wires, true)
    return { withOp, without, at: (m: number) => at(withOp, m) - at(without, m) }
  }
  const recThenTrim = { graph: [upload(8), trim], wires: [{ source: "rec", target: "trim", targetHandle: "in" }] as E[] }

  it("rec -> Trim -> Video SFX: the fixed 300-second row", () => {
    const d = delta(recThenTrim.graph, recThenTrim.wires, { id: "op", type: "video-sfx", data: {} }, "trim", "video")
    expect(d.withOp.previewPerMinute).toBe(d.without.previewPerMinute)
    expect(d.withOp.preview - d.without.preview).toBe(maxRow)
  })

  it("rec -> Trim -> Combine Videos: per minute, never below the charge", () => {
    const op: N = { id: "op", type: "combine-videos", data: { trimStartFrames: 0, trimEndFrames: 0 } }
    const d = delta(recThenTrim.graph, recThenTrim.wires, op, "trim", "in")
    expect(d.withOp.previewPerMinute).toBeGreaterThan(d.without.previewPerMinute)
    for (const m of MINUTES) for (const sec of lengthsIn(m)) expect(d.at(m), `${m} min (${sec}s)`).toBeGreaterThanOrEqual(combineCharge([sec - 1]))
  })

  it("rec -> Loop -> Trim: per minute, never below the charge on the looped length", () => {
    const loop: N = { id: "loop", type: "loop-video", data: { mode: "repeat" } }
    const d = delta([upload(8), loop], [{ source: "rec", target: "loop", targetHandle: "in" }], { ...trim, id: "op" }, "loop", "in")
    expect(d.withOp.previewPerMinute).toBeGreaterThan(d.without.previewPerMinute)
    for (const m of MINUTES) for (const sec of lengthsIn(m)) expect(d.at(m), `${m} min (${sec}s)`).toBeGreaterThanOrEqual(trimCharge(2 * sec))
  })

  it("rec -> Trim (a fixed 20-second window) -> Video SFX: the 20-second bucket, fixed", () => {
    const window: N = { id: "trim", type: "trim-video", data: { trimMode: "time", startTime: 0, endTime: 20 } }
    const d = delta([upload(8), window], recThenTrim.wires, { id: "op", type: "video-sfx", data: {} }, "trim", "video")
    expect(d.withOp.previewPerMinute).toBe(d.without.previewPerMinute)
    expect(d.withOp.preview - d.without.preview).toBe(STATIC_CREDIT_COSTS[videoSfxCreditId(20)])
  })

  it("rec -> Video SFX -> Trim: at most the 300 seconds a Video SFX run accepts, fixed", () => {
    const sfx: N = { id: "sfx", type: "video-sfx", data: {} }
    const d = delta([upload(8), sfx], [{ source: "rec", target: "sfx", targetHandle: "video" }], { ...trim, id: "op" }, "sfx", "in")
    expect(d.withOp.previewPerMinute).toBe(d.without.previewPerMinute)
    expect(d.withOp.preview - d.without.preview).toBe(trimCharge(VIDEO_SFX_PRICING.MAX_DURATION_SEC))
  })

  it("an intro card -> Trim -> Video SFX: the 300-second row, as on the card itself", () => {
    const nodes: N[] = [
      { id: "rec", type: "upload-video", data: {} },
      { id: "card", type: "upload-video", data: { duration: 8 } },
      { id: "stt", type: "transcribe", data: { provider: "elevenlabs-stt" } },
      trim,
    ]
    const edges: E[] = [
      { source: "rec", target: "stt", targetHandle: "audio" },
      { source: "card", target: "trim", targetHandle: "in" },
    ]
    const l = CreditsService.estimateWorkflowBaseListing([...nodes, { id: "op", type: "video-sfx", data: {} }], [...edges, { source: "trim", target: "op", targetHandle: "video" }], "template")
    const withoutOp = CreditsService.estimateWorkflowBaseListing(nodes, edges, "template")
    expect(l.preview - withoutOp.preview).toBe(maxRow)
    expect(l.previewPerMinute).toBe(withoutOp.previewPerMinute)
  })
})

// A GENERATED video (decided 2026-10-07): Generate Video, Image to Video and
// Text to Video feeding Trim, Loop, Combine Videos or Video SFX list at the
// generation's CONFIGURED duration. The guards below price the step the way
// its RUN reserves it: the run reads the generation's length with
// `extractVideoDurationFromNode` (input-resolver.ts), the raw configured
// duration, and an unset one at the estimators' 8-second fallback. The
// listing is never below that, nor below the length the generation renders
// (`resolveVideoRequestNorm` + `pricedOutputDurationSec`: LTX's seeded tiers,
// the longest clip for AUTO), which a Video SFX run measures (review round,
// decided 2026-10-07).
describe("on a generated video: the generation's configured duration", () => {
  const gen = (type: string, data: Record<string, unknown>): N => ({ id: "gen", type, data: { prompt: "a fox in snow", ...data } })
  const delta = (g: N, op: N, handle: string) => {
    const withOp = listingOf([g, op], [{ source: "gen", target: op.id, targetHandle: handle }], false)
    const without = listingOf([g], [], false)
    return { withOp, without, fixed: withOp.preview - without.preview }
  }
  const combine: N = { id: "op", type: "combine-videos", data: { trimStartFrames: 0, trimEndFrames: 0 } }
  const trimSec: N = { id: "op", type: "trim-video", data: { trimMode: "seconds", trimStartSeconds: 1 } }
  const trimCharge = (sec: number) => videoUtilityBaseCredits("trim-video", { trimMode: "seconds", trimStartSeconds: 1, upstreamDuration: sec })!

  it("Generate Video at 15 seconds -> Combine Videos: the 15-second charge, fixed", () => {
    const d = delta(gen("generate-video", { provider: "kling-3.0", duration: 15 }), combine, "in")
    expect(d.withOp.previewPerMinute).toBe(d.without.previewPerMinute)
    expect(d.fixed).toBe(combineCharge([15]))
  })

  it("Text to Video at 10 seconds -> Trim: the 10-second charge", () => {
    expect(delta(gen("text-to-video", { provider: "kling-3.0", duration: 10 }), trimSec, "in").fixed).toBe(trimCharge(10))
  })

  it("Image to Video at 20 seconds -> Loop: the 20-second charge", () => {
    const loop: N = { id: "op", type: "loop-video", data: { mode: "repeat" } }
    expect(delta(gen("image-to-video", { provider: "wan-3", duration: 20 }), loop, "in").fixed).toBe(
      videoUtilityBaseCredits("loop-video", { mode: "repeat", upstreamDuration: 20 }),
    )
  })

  it("Generate Video at 30 seconds -> Video SFX: the 30-second row", () => {
    const d = delta(gen("generate-video", { provider: "seedance-2-5", duration: 30 }), { id: "op", type: "video-sfx", data: {} }, "video")
    expect(d.fixed).toBe(STATIC_CREDIT_COSTS[videoSfxCreditId(30)])
  })

  it("AUTO duration is the longest clip the model renders", () => {
    const d = delta(gen("generate-video", { provider: "seedance-2-5", duration: VIDEO_DURATION_AUTO }), { id: "op", type: "video-sfx", data: {} }, "video")
    expect(d.fixed).toBe(STATIC_CREDIT_COSTS[videoSfxCreditId(pricedOutputDurationSec("seedance-2-5", VIDEO_DURATION_AUTO))])
  })

  // The run's own reservation for the step after a generation.
  const runCombine = (g: N) => combineCharge([extractVideoDurationFromNode(g.data)])
  const runLoop = (g: N) => videoUtilityBaseCredits("loop-video", { mode: "repeat", upstreamDuration: extractVideoDurationFromNode(g.data) })!
  const loop: N = { id: "op", type: "loop-video", data: { mode: "repeat" } }

  it.each([
    ["generate-video {}", gen("generate-video", {})],
    ["generate-video seedance-2-fast", gen("generate-video", { provider: "seedance-2-fast" })],
    ["generate-video kling-3.0", gen("generate-video", { provider: "kling-3.0" })],
    ["image-to-video (no provider)", gen("image-to-video", {})],
    ["text-to-video (no provider)", gen("text-to-video", {})],
  ] as const)("no duration (%s): never below the run's charge at its 8-second fallback", (_label, g) => {
    expect(delta(g, combine, "in").fixed).toBeGreaterThanOrEqual(runCombine(g))
    expect(delta(g, combine, "in").fixed).toBe(combineCharge([8]))
    expect(delta(g, loop, "in").fixed).toBeGreaterThanOrEqual(runLoop(g))
  })

  it("LTX: the run charges the configured 11 s, though it renders the 10 s tier", () => {
    expect(resolveVideoRequestNorm({ provider: "ltx-2.3-pro", duration: 11 }).duration).toBe(10)
    const g = gen("generate-video", { provider: "ltx-2.3-pro", duration: 11 })
    expect(delta(g, combine, "in").fixed).toBe(combineCharge([11]))
    expect(delta(g, combine, "in").fixed).toBeGreaterThanOrEqual(runCombine(g))
  })

  it("LTX Fast at 4k and 20 s: the run charges the configured 20 s, not the 4k band's 10 s", () => {
    const g = gen("generate-video", { provider: "ltx-2.3-fast", resolution: "4k", duration: 20 })
    expect(delta(g, combine, "in").fixed).toBeGreaterThanOrEqual(runCombine(g))
    expect(delta(g, loop, "in").fixed).toBeGreaterThanOrEqual(runLoop(g))
  })

  it("several providers: the longest of their lengths", () => {
    const d = delta(gen("generate-video", { providers: ["kling-3.0", "seedance-2-5"], duration: VIDEO_DURATION_AUTO }), trimSec, "in")
    expect(d.fixed).toBe(trimCharge(Math.max(pricedOutputDurationSec("kling-3.0", VIDEO_DURATION_AUTO), pricedOutputDurationSec("seedance-2-5", VIDEO_DURATION_AUTO))))
  })

  it("the length carries on: Generate Video at 15 s -> Trim -> Combine Videos", () => {
    const g = gen("generate-video", { provider: "kling-3.0", duration: 15 })
    const trim: N = { id: "trim", type: "trim-video", data: { trimMode: "seconds", trimStartSeconds: 0 } }
    const graph = [g, trim]
    const wires: E[] = [{ source: "gen", target: "trim", targetHandle: "in" }]
    const withOp = listingOf([...graph, combine], [...wires, { source: "trim", target: "op", targetHandle: "in" }], false)
    const without = listingOf(graph, wires, false)
    expect(withOp.preview - without.preview).toBe(combineCharge([15]))
  })

  // Every model a Generate Video node runs, unset and at every duration and
  // resolution it offers: the listed Combine and Loop are never below what
  // the run reserves for them (the length `extractVideoDurationFromNode`
  // reads, else the 8-second fallback) nor below the charge at the length the
  // generation renders.
  const models = Object.values(MODEL_CATALOG).filter((m) => m.kind === "video" && (m.modes.includes("i2v") || m.modes.includes("t2v")))
  it.each(models.map((m) => [m.id, m] as const))("%s: never below the run's charge", (_id, m) => {
    for (const resolution of [undefined, ...((m.resolutions ?? []) as ReadonlyArray<string>)]) {
      for (const duration of [undefined, ...(m.durations ?? [])]) {
        const g = gen("generate-video", { provider: m.id, duration, ...(resolution ? { resolution } : {}) })
        const rendered = pricedOutputDurationSec(m.id, resolveVideoRequestNorm({ provider: m.id, resolution: resolution ?? uiResolutionFill(m.id), duration }).duration ?? duration)
        const at = `${m.id} @ ${resolution ?? "-"} / ${duration}`
        expect(delta(g, combine, "in").fixed, at).toBeGreaterThanOrEqual(Math.max(runCombine(g), combineCharge([rendered])))
        expect(delta(g, loop, "in").fixed, at).toBeGreaterThanOrEqual(runLoop(g))
      }
    }
  })
})
