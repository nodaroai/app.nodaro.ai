import { beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => {
  class InsufficientCreditsError extends Error {
    readonly code = "insufficient_credits"
    readonly appCreditsAllowance = 0
  }
  return {
    InsufficientCreditsError,
    planner: { steps: ["pauses", "captions", "music"], musicStyle: "calm piano", picture: { instruction: "", what: "" }, look: "warm", clips: 2, reply: "On it.", cannot: [] } as Record<string, unknown>,
    plannerFails: false,
    plannerNoCredits: false,
    transcribeNoCredits: false,
    transcribeJobFails: false,
    musicJobFails: false,
    feeFails: false,
    trailerPlanned: true,
    words: [] as Array<{ text: string; startMs: number; endMs: number; speaker?: string }>,
    order: [] as string[],
  }
})

// A six-second take: a pause before, between and after its words.
const WORDS = [
  { text: "Hello", startMs: 1000, endMs: 1400, speaker: "A" },
  { text: "world.", startMs: 1500, endMs: 1900, speaker: "A" },
  { text: "Again", startMs: 3500, endMs: 4000, speaker: "A" },
]

vi.mock("@/lib/api", () => ({
  InsufficientCreditsError: api.InsufficientCreditsError,
  cancelJob: vi.fn(async () => ({ success: true, cancelled: 1 })),
  getCurrentUserId: vi.fn(async () => "8b1f6a2e-1c2d-4e5f-8a9b-0c1d2e3f4a5b"),
  transcribeApi: vi.fn(async () => {
    api.order.push("transcribe")
    if (api.transcribeNoCredits) throw new api.InsufficientCreditsError("no credits")
    return { jobId: "job-transcribe" }
  }),
  sunoGenerateApi: vi.fn(async () => {
    api.order.push("music")
    return { jobId: "job-music" }
  }),
  llmStructuredApi: vi.fn(async (params: { schemaName?: string }) => {
    if (params.schemaName === "edit_plan") {
      api.order.push("plan")
      if (api.plannerNoCredits) throw new api.InsufficientCreditsError("no credits")
      if (api.plannerFails) throw new Error("planner down")
      return { jobId: "job-plan", output: api.planner }
    }
    api.order.push("choose")
    return { jobId: "job-choose", output: { musicStyle: "", broll: [{ sentence: 0, prompt: "a city at dawn", label: "City" }, { sentence: 1, prompt: "a calendar", label: "Plans" }], zoom: [{ sentence: 0 }], trailer: [{ from: 0, to: 1 }] } }
  }),
  editPlan: vi.fn(async (params: { mode: string }) => {
    api.order.push(`edit-plan:${params.mode}`)
    return { jobId: `job-plan-${params.mode}` }
  }),
  generateImage: vi.fn(async () => {
    api.order.push("image")
    return { jobId: "job-image" }
  }),
  trimVideoApi: vi.fn(async () => {
    api.order.push("trim")
    return { jobId: "job-trim" }
  }),
  videoToVideo: vi.fn(async () => {
    api.order.push("picture")
    return { jobId: "job-picture" }
  }),
  speakerFrames: vi.fn(async () => {
    api.order.push("tracking")
    return { jobId: "job-frames" }
  }),
  cameraSwitch: vi.fn(async () => ({ jobId: "job-cameras" })),
  chargeUseCaseFee: vi.fn(async (p: { type: string }) => {
    api.order.push(`fee:${p.type}`)
    if (api.feeFails) throw new Error("no credits for the fee")
    return { jobId: "job-fee" }
  }),
  getJobStatusLean: vi.fn(async (id: string) => {
    if (id === "job-transcribe") {
      if (api.transcribeJobFails) return { status: "failed", error_message: "The transcription failed.", error_detail: "Audio file contains no audible speech" }
      return { status: "completed", output_data: { json: { version: 1, language: "eng", words: api.words } } }
    }
    if (id === "job-music") return api.musicJobFails ? { status: "failed", error_message: "The music could not be made.", error_detail: "Suno refused the prompt" } : { status: "completed", output_data: { audioUrl: "https://cdn.example.com/track.mp3" } }
    if (id === "job-image") return { status: "completed", output_data: { imageUrl: "https://cdn.example.com/shot.png" } }
    if (id === "job-trim") return { status: "completed", output_data: { videoUrl: "https://cdn.example.com/trim.mp4" } }
    if (id === "job-picture") return { status: "completed", output_data: { videoUrl: "https://cdn.example.com/picture.mp4" } }
    if (id === "job-frames") return { status: "completed", output_data: { json: { url: "https://cdn.example.com/tracks.json" } } }
    if (id === "job-cameras") return { status: "completed", output_data: { json: { segments: [{ inMs: 0, outMs: 3000, video: "media-1" }, { inMs: 3000, outMs: 6000, video: "media-2" }] } } }
    if (id === "job-plan-tighten") return { status: "completed", output_data: { version: 1, clock: "master", sources: [], segments: [], dropped: [{ inMs: 2000, outMs: 3000, reason: "false-start" }, { inMs: 4200, outMs: 4600, reason: "silence" }] } }
    if (id === "job-plan-clips") return { status: "completed", output_data: { version: 1, clips: [{ segments: [{ inMs: 1000, outMs: 4000 }] }, { segments: [{ inMs: 3500, outMs: 4000 }] }] } }
    if (id === "job-plan-trailer") return { status: "completed", output_data: { version: 1, clock: "master", sources: [], segments: [{ inMs: 1000, outMs: 2000 }] } }
    if (id === "job-plan-chapters") return { status: "completed", output_data: { version: 1, chapters: [{ startMs: 1000, title: "Hello" }, { startMs: 3500, title: "Again" }] } }
    return { status: "completed", output_data: {} }
  }),
}))

vi.mock("@/lib/edit-plan-modes", () => ({ isEditPlanModeSupported: () => api.trailerPlanned }))

import { cameraSwitch, cancelJob, chargeUseCaseFee, editPlan, generateImage, llmStructuredApi, speakerFrames, sunoGenerateApi, transcribeApi, trimVideoApi, videoToVideo } from "@/lib/api"
import type { EditorLink, OpsResult, PresenceCursor } from "../editor-link"
import { EDIT_STEPS } from "../edit-plan"
import { RunDeclined, RunFailed, RunStopped, musicFileOf, openedVideoMedia, runAiEdit, undoAiEdit, type RunEvent } from "../run-ai-edit"
import { readTimelineView } from "../edit-plan"
import { SKIP_PACE } from "../run/show"

const VIDEO_URL = "https://cdn.example.com/uploads/take.mp4"
const ALL = ["edit-ops", "timeline-read", "playback", "presence", "edit-ops-2", "presence-targets", "compare", "captions-word-highlight"]

type Item = Record<string, unknown> & { id: string; type: string; trackId: string; from: number; durationInFrames: number }

interface FakeLink extends EditorLink {
  /** Each edit request, with the tab that was open when it came. */
  readonly applied: Array<{ label: string; ops: ReadonlyArray<Record<string, unknown>>; history?: boolean; tab: string }>
  readonly imported: string[]
  readonly presences: Array<readonly PresenceCursor[]>
  readonly compares: string[]
  state: { durationInFrames: number; width: number; height: number; items: Item[]; media: Array<Record<string, unknown>>; markers: Array<{ id: string; frame: number; label?: string; color?: string }>; sequences: string[]; open: string }
}

/** A small editor: it keeps a timeline and answers the ops the agents send, the way the real one shapes its replies. */
function fakeLink(opts: { refuseCuts?: number; cameras?: boolean; stuckInTabs?: boolean } = {}): FakeLink {
  let refuse = opts.refuseCuts ?? 0
  let n = 0
  const state: FakeLink["state"] = {
    durationInFrames: 180,
    width: 1920,
    height: 1080,
    items: [
      { id: "v1", type: "video", trackId: "t1", from: 0, durationInFrames: 180, mediaId: "media-1", sourceStart: 0, sourceEnd: 180, sourceFps: 30, transform: { x: 0, y: 0, width: 1920, height: 1080 } },
      ...(opts.cameras ? [{ id: "v2", type: "video", trackId: "t0", from: 0, durationInFrames: 180, mediaId: "media-2", sourceStart: 0, sourceEnd: 180, sourceFps: 30 } as Item, { id: "a2", type: "audio", trackId: "ta", from: 0, durationInFrames: 180, mediaId: "media-2" } as Item] : []),
    ],
    media: [{ id: "media-1", fileName: "take.mp4", duration: 6, width: 1920, height: 1080 }, ...(opts.cameras ? [{ id: "media-2", fileName: "wide.mp4", duration: 6 }] : [])],
    markers: [],
    sequences: [],
    open: "main",
  }
  const report = () => ({
    fps: 30,
    durationInFrames: state.durationInFrames,
    width: state.width,
    height: state.height,
    currentFrame: 0,
    items: state.items,
    media: state.media,
    markers: state.markers,
    sequences: state.sequences.map((id) => ({ id, name: id, durationInFrames: 60, active: state.open === id })),
    tracks: [{ id: "t0", order: -1 }, { id: "t1", order: 0 }, { id: "ta", kind: "audio", order: 1 }],
  })
  const applied: FakeLink["applied"] = []
  const imported: string[] = []
  const presences: FakeLink["presences"] = []
  const compares: string[] = []
  const apply = (op: Record<string, unknown>): unknown => {
    n += 1
    switch (op.op) {
      case "removeSourceRanges": {
        if (refuse > 0) {
          refuse -= 1
          throw new Error("None of the ranges could be cut from the clips on the timeline")
        }
        const ranges = op.ranges as Array<{ start: number; end: number }>
        state.durationInFrames -= Math.round(ranges.reduce((s, r) => s + (r.end - r.start), 0) * 30)
        return { removedRangeCount: ranges.length }
      }
      case "addTranscriptCaptions":
        state.items = [...state.items, { id: `cap-${n}`, type: "subtitle", trackId: "tc", from: 0, durationInFrames: 90, label: "Captions" }]
        return { insertedItemCount: 1 }
      case "removeItems":
        state.items = state.items.filter((i) => !(op.ids as string[]).includes(i.id))
        return {}
      case "placeMedia": {
        const ref = String(op.ref)
        const type = ref.startsWith("ai-music") ? "audio" : ref.startsWith("ai-broll") ? "image" : "video"
        const id = `${type}-${n}`
        state.media = [...state.media, { id: `m-${n}`, fileName: `${ref}.x` }]
        state.items = [...state.items, { id, type, trackId: `t-${type}`, from: Number(op.from), durationInFrames: Number(op.durationInFrames), mediaId: `m-${n}`, label: `${ref}.x`, transform: { x: 0, y: 0, width: 1920, height: 1080 } }]
        return { id, trackId: `t-${type}`, from: op.from, durationInFrames: op.durationInFrames }
      }
      case "setCanvas":
        state.width = Number(op.width)
        state.height = Number(op.height)
        return { width: state.width, height: state.height }
      case "applyLook":
        return { effects: [{ itemId: "v1", effectId: `fx-${n}` }] }
      case "createSequence":
        state.sequences = [...state.sequences, `seq-${n}`]
        return { sequenceId: `seq-${n}`, durationInFrames: 60 }
      case "addMarkers":
        state.markers = [...state.markers, ...(op.markers as Array<{ frame: number; label?: string; color?: string }>).map((m, i) => ({ id: `mk-${n}-${i}`, ...m }))]
        return { ids: [] }
      case "removeMarkers":
        state.markers = state.markers.filter((m) => !(op.ids as string[]).includes(m.id))
        return { removed: 0 }
      default:
        return {}
    }
  }
  return {
    applied,
    imported,
    presences,
    compares,
    state,
    getTimeline: async () => report(),
    applyOps: async (label, ops, options): Promise<OpsResult> => {
      applied.push({ label, ops, history: options?.history, tab: state.open })
      try {
        const results = ops.map(apply)
        return { ok: true, recorded: options?.history !== false, timeline: report(), results }
      } catch (error) {
        return { ok: false, error: { message: (error as Error).message, index: 0 } }
      }
    },
    undoEdit: async () => ({ undone: false }),
    importFile: (ref) => imported.push(ref),
    playback: () => {},
    compare: (mode) => compares.push(mode),
    openSequence: (id) => {
      // An editor that never goes back: what the run must not edit on top of.
      if (opts.stuckInTabs && id === "main") return
      state.open = id
    },
    presence: (cursors) => presences.push(cursors),
    dispose: () => {},
  }
}

const NAMES = { lead: "Assistant", cutter: "Cutter", captions: "Captions", sound: "Sound", broll: "B-roll", picture: "Picture", color: "Color", framer: "Framer", director: "Director" }
const LABELS = Object.fromEntries(EDIT_STEPS.map((s) => [s, `label:${s}`])) as Record<(typeof EDIT_STEPS)[number], string>
const PHRASES = [
  { step: "pauses" as const, text: "cut the pauses" },
  { step: "captions" as const, text: "add captions" },
  { step: "music" as const, text: "add upbeat music" },
  { step: "color" as const, text: "warm up the color" },
  { step: "phone" as const, text: "make a phone version" },
  { step: "chapters" as const, text: "make chapters" },
  { step: "clips" as const, text: "make 2 short clips" },
  { step: "mistakes" as const, text: "remove mistakes and repeats" },
  { step: "broll" as const, text: "add b-roll" },
  { step: "zoom" as const, text: "zoom in on the key lines" },
  { step: "picture" as const, text: "change the background to a beach" },
  { step: "trailer" as const, text: "make a trailer" },
  { step: "cameras" as const, text: "switch between the cameras" },
]

function run(link: EditorLink, events: RunEvent[] = [], signal = new AbortController().signal, extra: Partial<Parameters<typeof runAiEdit>[0]> = {}) {
  return runAiEdit({
    request: "cut the pauses, captions and calm music please",
    videoUrl: VIDEO_URL,
    link,
    signal,
    capabilities: ALL,
    names: NAMES,
    stepLabels: LABELS,
    say: (key, vars) => `${key}${vars ? JSON.stringify(vars) : ""}`,
    phrases: PHRASES,
    onEvent: (e) => events.push(e),
    pace: () => SKIP_PACE,
    ...extra,
  })
}

const opsOf = (link: FakeLink, name: string): Array<Record<string, unknown> & { readonly label: string }> =>
  link.applied.flatMap((a) => a.ops.filter((o) => o.op === name).map((o) => ({ ...o, label: a.label })))
const stepEvents = (events: RunEvent[], step: string) => events.filter((e): e is Extract<RunEvent, { type: "step" }> => e.type === "step" && e.step === step)

beforeEach(() => {
  vi.clearAllMocks()
  api.planner = { steps: ["pauses", "captions", "music"], musicStyle: "calm piano", picture: { instruction: "", what: "" }, look: "warm", clips: 2, reply: "On it.", cannot: [] }
  api.plannerFails = false
  api.plannerNoCredits = false
  api.transcribeNoCredits = false
  api.transcribeJobFails = false
  api.musicJobFails = false
  api.feeFails = false
  api.trailerPlanned = true
  api.words = WORDS
  api.order = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("tracks.json")
        ? new Response(JSON.stringify({ sources: [{ tracks: [{ speaker: "A", boxes: [{ ms: 0, x: 0.6, y: 0.2, w: 0.2, h: 0.3 }, { ms: 500, x: 0.6, y: 0.2, w: 0.2, h: 0.3 }] }] }] }), { status: 200 })
        : new Response(new ArrayBuffer(16), { status: 200, headers: { "content-type": url.endsWith(".png") ? "image/png" : "audio/mpeg" } }),
    ),
  )
})

describe("runAiEdit: reading the request", () => {
  it("starts a request made only of the cards' words at once, with no model reading it", async () => {
    const events: RunEvent[] = []
    await run(fakeLink(), events, undefined, { request: "Cut the pauses, add captions" })
    expect(llmStructuredApi).not.toHaveBeenCalledWith(expect.objectContaining({ schemaName: "edit_plan" }))
    expect(api.order[0]).toBe("transcribe")
    expect(events.find((e) => e.type === "plan")).toMatchObject({ plan: { steps: ["pauses", "captions"] } })
  })

  it("reads a request in the person's own words with the planner, on its quick setting", async () => {
    await run(fakeLink())
    expect(llmStructuredApi).toHaveBeenCalledWith(expect.objectContaining({ schemaName: "edit_plan", reasoningEffort: "low" }))
    expect(api.order.slice(0, 2)).toEqual(["plan", "transcribe"])
  })

  it("ends a request it cannot do before anything paid starts", async () => {
    api.planner = { ...api.planner, steps: [], reply: "Not yet.", cannot: ["fly the camera"] }
    const outcome = run(fakeLink(), [], undefined, { request: "fly the camera over the city" })
    await expect(outcome).rejects.toBeInstanceOf(RunDeclined)
    await expect(outcome).rejects.toMatchObject({ reason: "cannot", plan: { cannot: ["fly the camera"] } })
    expect(transcribeApi).not.toHaveBeenCalled()
  })

  it("never falls back to an edit nobody asked for when the planner does not answer", async () => {
    api.plannerFails = true
    await expect(run(fakeLink(), [], undefined, { request: "edit it for me" })).rejects.toMatchObject({ key: "freecutAi.unreadable" })
    expect(transcribeApi).not.toHaveBeenCalled()
  })

  it("starts nothing paid when there are no credits to read the request", async () => {
    api.plannerNoCredits = true
    await expect(run(fakeLink())).rejects.toMatchObject({ key: "freecutAi.noCredits" })
    expect(transcribeApi).not.toHaveBeenCalled()
  })

  it("asks first when the plan costs more than the price shown, and starts nothing paid on a no", async () => {
    const confirmPartial = vi.fn(async () => false)
    await expect(run(fakeLink(), [], undefined, { quoted: ["pauses", "captions"], confirmPartial })).rejects.toBeInstanceOf(RunDeclined)
    expect(confirmPartial).toHaveBeenCalledWith(expect.anything(), { listen: false, steps: ["music"] })
    expect(transcribeApi).not.toHaveBeenCalled()
    expect(sunoGenerateApi).not.toHaveBeenCalled()
  })

  it("says plainly what this editor cannot do yet, and runs the rest", async () => {
    const events: RunEvent[] = []
    await run(fakeLink(), events, undefined, { capabilities: ["edit-ops", "timeline-read", "playback", "presence"] })
    const plan = events.find((e) => e.type === "plan") as Extract<RunEvent, { type: "plan" }>
    expect(plan.plan.steps).toEqual(["pauses", "captions"])
    expect(plan.plan.cannot.join(" ")).toContain("freecutAi.needsEditorUpdate")
    expect(sunoGenerateApi).not.toHaveBeenCalled()
  })

  it("does not offer switching cameras with one camera", async () => {
    api.planner = { ...api.planner, steps: ["cameras", "pauses"] }
    const events: RunEvent[] = []
    await run(fakeLink(), events)
    const plan = events.find((e) => e.type === "plan") as Extract<RunEvent, { type: "plan" }>
    expect(plan.plan.steps).toEqual(["pauses"])
    expect(plan.plan.cannot).toContain("freecutAi.camerasNone")
    expect(cameraSwitch).not.toHaveBeenCalled()
  })
})

describe("runAiEdit: the Cutter and Captions", () => {
  it("cuts the pauses one by one, under the Cutter's label, and lays the captions in one edit", async () => {
    const link = fakeLink()
    const events: RunEvent[] = []
    const summary = await run(link, events, undefined, { request: "cut the pauses, add captions" })
    const cuts = opsOf(link, "removeSourceRanges")
    expect(cuts.length).toBeGreaterThanOrEqual(3)
    expect(cuts.every((c) => (c.ranges as unknown[]).length === 1 && c.label === "label:pauses")).toBe(true)
    expect(opsOf(link, "addTranscriptCaptions")).toHaveLength(1)
    expect(summary.pausesCut).toBe(cuts.length)
    expect(stepEvents(events, "pauses").at(-1)).toMatchObject({ state: "done" })
    expect(stepEvents(events, "captions").at(-1)).toMatchObject({ state: "done" })
  })

  it("reports a cut the editor refused with the editor's own words, and goes on with the rest", async () => {
    const link = fakeLink({ refuseCuts: 99 })
    const events: RunEvent[] = []
    await run(link, events, undefined, { request: "cut the pauses, add captions" })
    expect(stepEvents(events, "pauses").at(-1)).toMatchObject({ state: "failed", key: "freecutAi.editorRefused", detail: "None of the ranges could be cut from the clips on the timeline" })
    // Never the old "the editor changed" for a refusal; captions still landed.
    expect(events.some((e) => e.type === "step" && e.key === "freecutAi.editorChanged")).toBe(false)
    expect(opsOf(link, "addTranscriptCaptions").length).toBeGreaterThan(0)
  })

  it("takes away captions made in parts when they block a cut, cuts, and lays them again", async () => {
    const link = fakeLink({ refuseCuts: 1 })
    link.state.items = [...link.state.items, { id: "old-cap", type: "subtitle", trackId: "tc", from: 0, durationInFrames: 30, label: "Captions" }]
    await run(link, [], undefined, { request: "cut the pauses", heard: { words: WORDS.map((w) => ({ text: w.text, start: w.startMs / 1000, end: w.endMs / 1000 })), language: "en" } })
    expect(opsOf(link, "removeItems")[0]).toMatchObject({ ids: ["old-cap"] })
    expect(opsOf(link, "addTranscriptCaptions")).toHaveLength(1)
  })

  it("cuts the mistakes the edit plan found, as a second pass after the pauses", async () => {
    const link = fakeLink()
    const events: RunEvent[] = []
    const summary = await run(link, events, undefined, { request: "cut the pauses, remove mistakes and repeats" })
    expect(editPlan).toHaveBeenCalledWith(expect.objectContaining({ mode: "tighten", planTier: "economy" }))
    const mistakeCuts = opsOf(link, "removeSourceRanges").filter((c) => c.label === "label:mistakes")
    // The false start is cut; the planner's silence is the Cutter's own (pauses), not cut twice.
    expect(mistakeCuts.flatMap((c) => c.ranges as Array<{ start: number }>).map((r) => r.start)).toEqual([2])
    expect(summary.mistakesCut).toBe(1)
  })

  it("listens once per video: what an earlier run heard is not paid for again", async () => {
    await run(fakeLink(), [], undefined, { request: "add captions", heard: { words: [{ text: "Hi", start: 1, end: 1.4 }], language: "en" } })
    expect(transcribeApi).not.toHaveBeenCalled()
  })

  it("stops on a failed transcription with the provider's words, and pays for nothing else", async () => {
    api.transcribeJobFails = true
    await expect(run(fakeLink(), [], undefined, { request: "add captions, add upbeat music" })).rejects.toMatchObject({ key: "freecutAi.listenFailed", detail: "Audio file contains no audible speech" })
    expect(sunoGenerateApi).not.toHaveBeenCalled()
  })
})

describe("runAiEdit: the other agents", () => {
  it("lays the music on its own track that cuts leave alone, ducked under the voice", async () => {
    const link = fakeLink()
    const summary = await run(link, [], undefined, { request: "cut the pauses, add upbeat music" })
    const placed = opsOf(link, "placeMedia").find((o) => String(o.ref).startsWith("ai-music"))
    expect(placed).toMatchObject({ syncLock: false, volumeDb: -16 })
    expect(placed).not.toHaveProperty("newTrack")
    const ducking = opsOf(link, "addKeyframe").filter((k) => k.property === "volume")
    expect(ducking.length).toBeGreaterThan(2)
    expect(summary.music).toBe(true)
  })

  it("fits music an earlier run laid to the new length after a cut", async () => {
    const link = fakeLink()
    link.state.media = [...link.state.media, { id: "m-old", fileName: "ai-music.mp3" }]
    link.state.items = [...link.state.items, { id: "old-music", type: "audio", trackId: "tm", from: 0, durationInFrames: 180, mediaId: "m-old" }]
    await run(link, [], undefined, { request: "cut the pauses" })
    expect(opsOf(link, "fitItem")[0]).toMatchObject({ id: "old-music" })
  })

  it("finishes the rest of the edit when the music cannot be made, and says why on its card", async () => {
    api.musicJobFails = true
    const link = fakeLink()
    const events: RunEvent[] = []
    await run(link, events, undefined, { request: "cut the pauses, add upbeat music" })
    expect(stepEvents(events, "music").at(-1)).toMatchObject({ state: "failed", detail: "Suno refused the prompt" })
    expect(stepEvents(events, "pauses").at(-1)).toMatchObject({ state: "done" })
  })

  it("makes b-roll in Nodaro for the moments the creative pass picked, and lays each with a move", async () => {
    const link = fakeLink()
    const summary = await run(link, [], undefined, { request: "add b-roll" })
    expect(generateImage).toHaveBeenCalledTimes(2)
    const shots = opsOf(link, "placeMedia").filter((o) => String(o.ref).startsWith("ai-broll"))
    expect(shots).toHaveLength(2)
    // Where the editor lays a picture by itself: above the video, under the captions.
    for (const shot of shots) expect(shot.trackId ?? shot.newTrack).toBeUndefined()
    expect(opsOf(link, "addKeyframe").some((k) => k.property === "width" || k.property === "x")).toBe(true)
    expect(summary.broll).toBe(2)
  })

  it("changes the picture on one shot, says which seconds first, and lays it over that shot", async () => {
    api.planner = { ...api.planner, steps: ["picture"], picture: { instruction: "Replace the background with a beach", what: "the background" } }
    const link = fakeLink()
    const events: RunEvent[] = []
    await run(link, events, undefined, { request: "put me on a beach" })
    expect(trimVideoApi).toHaveBeenCalled()
    expect(videoToVideo).toHaveBeenCalledWith("https://cdn.example.com/trim.mp4", "Replace the background with a beach", "wan-videoedit", expect.any(String), expect.objectContaining({ audioSetting: "origin" }))
    expect(stepEvents(events, "picture")[1]).toMatchObject({ key: "freecutAi.pictureSelecting" })
    const placed = opsOf(link, "placeMedia").find((o) => String(o.ref).startsWith("ai-picture"))!
    expect(placed).toMatchObject({ fit: "cover" })
    expect(placed.newTrack ?? placed.volumeDb).toBeUndefined()
  })

  it("warms the color with the editor's own look", async () => {
    const link = fakeLink()
    const events: RunEvent[] = []
    await run(link, events, undefined, { request: "warm up the color" })
    expect(opsOf(link, "applyLook")[0]).toMatchObject({ look: "warm" })
    expect(events.find((e) => e.type === "color")).toMatchObject({ effects: [{ itemId: "v1" }] })
  })

  it("turns the edit into the phone version from the face tracks, and keeps the framing for Wide | Phone", async () => {
    const link = fakeLink()
    const events: RunEvent[] = []
    await run(link, events, undefined, { request: "make a phone version, add captions" })
    expect(speakerFrames).toHaveBeenCalled()
    expect(opsOf(link, "setCanvas")[0]).toMatchObject({ width: 1080, height: 1920 })
    expect(events.find((e) => e.type === "framing")).toBeTruthy()
    // The captions are laid again in the new frame.
    expect(opsOf(link, "addTranscriptCaptions").length).toBeGreaterThanOrEqual(2)
  })

  it("switches between the cameras to whoever speaks", async () => {
    api.planner = { ...api.planner, steps: ["cameras"] }
    const link = fakeLink({ cameras: true })
    const summary = await run(link, [], undefined, { request: "switch between the cameras", urlOfName: (name) => (name === "wide.mp4" ? "https://cdn.example.com/wide.mp4" : undefined) })
    expect(cameraSwitch).toHaveBeenCalled()
    expect(opsOf(link, "addKeyframe").filter((k) => k.property === "opacity").length).toBeGreaterThan(0)
    expect(summary.switches).toBeGreaterThan(0)
  })
})

describe("runAiEdit: made from the video", () => {
  it("marks the chapters on the ruler and charges the node's fee once made", async () => {
    const link = fakeLink()
    const events: RunEvent[] = []
    const summary = await run(link, events, undefined, { request: "make chapters" })
    expect(opsOf(link, "addMarkers")[0]).toMatchObject({ markers: [{ label: "Hello" }, { label: "Again" }] })
    expect(chargeUseCaseFee).toHaveBeenCalledWith({ type: "episode-chapters" })
    expect(events.find((e) => e.type === "made")).toMatchObject({ result: { kind: "chapters" } })
    expect(summary.chapters).toBe(2)
  })

  it("makes each clip in its own tab, out of the undo history, and charges the fee once", async () => {
    const link = fakeLink()
    const summary = await run(link, [], undefined, { request: "make 2 short clips" })
    const tabs = link.applied.filter((a) => a.ops.some((o) => o.op === "createSequence"))
    expect(tabs).toHaveLength(2)
    expect(tabs.every((a) => a.history === false)).toBe(true)
    expect(chargeUseCaseFee).toHaveBeenCalledTimes(1)
    expect(summary.clips).toBe(2)
  })

  it("captions each clip inside its own tab, even when the show is skipped, then opens the main edit again", async () => {
    const link = fakeLink()
    await run(link, [], undefined, { request: "make 2 short clips" })
    const inTabs = link.applied.filter((a) => a.tab !== "main" && a.ops.some((o) => o.op === "addTranscriptCaptions"))
    expect(inTabs.map((a) => a.tab)).toEqual(link.state.sequences)
    expect(link.state.open).toBe("main")
    // Nothing of the main edit is laid while a clip's tab is open.
    expect(link.applied.filter((a) => a.tab !== "main").every((a) => a.ops.every((o) => o.op === "addTranscriptCaptions"))).toBe(true)
  })

  it("stops the run when the editor will not open the main edit again", async () => {
    await expect(run(fakeLink({ stuckInTabs: true }), [], undefined, { request: "make 2 short clips" })).rejects.toMatchObject({ key: "freecutAi.tabStuck" })
  }, 20_000)

  it("asked again, its chapter marks take the place of the earlier ones", async () => {
    const link = fakeLink()
    link.state.markers = [{ id: "mine", frame: 10, label: "Old", color: "#F08C3A" }, { id: "theirs", frame: 20, label: "By hand", color: "#22aaff" }]
    await run(link, [], undefined, { request: "make chapters" })
    expect(opsOf(link, "removeMarkers")[0]).toMatchObject({ ids: ["mine"] })
    expect(link.state.markers.map((m) => m.label)).toEqual(["By hand", "Hello", "Again"])
  })

  it("says so when the fee could not be charged, instead of hiding it", async () => {
    api.feeFails = true
    const events: RunEvent[] = []
    await run(fakeLink(), events, undefined, { request: "make chapters" })
    expect(events.some((e) => e.type === "feed" && e.key === "freecutAi.feeFailed")).toBe(true)
  })

  it("picks a trailer's moments itself when the server cannot plan one", async () => {
    api.trailerPlanned = false
    const link = fakeLink()
    await run(link, [], undefined, { request: "make a trailer" })
    expect(editPlan).not.toHaveBeenCalledWith(expect.objectContaining({ mode: "trailer" }))
    expect(llmStructuredApi).toHaveBeenCalledWith(expect.objectContaining({ schemaName: "edit_choices" }))
    expect(link.applied.some((a) => a.ops.some((o) => o.op === "createSequence"))).toBe(true)
  })
})

describe("runAiEdit: ending", () => {
  it("ends with the original and the edit side by side", async () => {
    const link = fakeLink()
    const events: RunEvent[] = []
    // Shown at any pace below a skip, the finale plays (32× keeps the test quick).
    await run(link, events, undefined, { request: "cut the pauses", pace: () => 32 })
    expect(link.compares).toEqual(["split"])
    expect(events.find((e) => e.type === "compare")).toMatchObject({ mode: "split" })
  })

  it("skipped to the end, lands the edit without the finale", async () => {
    const link = fakeLink()
    await run(link, [], undefined, { request: "cut the pauses" })
    expect(link.compares).toEqual([])
  })

  it("cancels the paid work it started when the person stops", async () => {
    const controller = new AbortController()
    const link = fakeLink()
    const outcome = run(link, [], controller.signal, {
      request: "cut the pauses, add upbeat music",
      onEvent: (e) => {
        if (e.type === "heard") controller.abort()
      },
    })
    await expect(outcome).rejects.toBeInstanceOf(RunStopped)
    expect(cancelJob).toHaveBeenCalled()
  })

  it("refuses an editor with no video on it", async () => {
    const link = fakeLink()
    link.state.items = []
    await expect(run(link)).rejects.toBeInstanceOf(RunFailed)
  })

  it("reports every undo entry it made, with the step it stands for", async () => {
    const link = fakeLink()
    const events: RunEvent[] = []
    await run(link, events, undefined, { request: "cut the pauses, add captions" })
    const recorded = events.filter((e): e is Extract<RunEvent, { type: "recorded" }> => e.type === "recorded")
    expect(recorded.length).toBe(link.applied.filter((a) => a.history !== false).length)
    expect(new Set(recorded.map((r) => r.step))).toEqual(new Set(["pauses", "captions"]))
  })
})

describe("musicFileOf", () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(12).fill(0)]).buffer

  it("names the music as its bytes are, whatever its address says", () => {
    expect(musicFileOf(bytes(0x49, 0x44, 0x33), "https://x/a.wav", "audio/wav")).toEqual({ name: "ai-music.mp3", type: "audio/mpeg" })
  })
})

describe("openedVideoMedia", () => {
  const view = readTimelineView({
    fps: 30,
    durationInFrames: 10,
    items: [
      { id: "a", type: "video", trackId: "t", from: 0, durationInFrames: 5, mediaId: "m1" },
      { id: "b", type: "video", trackId: "t", from: 5, durationInFrames: 5, mediaId: "m2" },
    ],
  })!

  it("finds the video the host named among several", () => {
    expect(openedVideoMedia(view, [{ id: "m1", fileName: "one.mp4" }, { id: "m2", fileName: "two.mp4" }], "x", "two.mp4")?.id).toBe("m2")
  })

  it("takes the first video of the edit when there are several cameras and nothing names one", () => {
    expect(openedVideoMedia(view, [], "https://x/none.mp4", undefined, true)?.id).toBe("m1")
  })
})

describe("undoAiEdit", () => {
  it("undoes exactly the run's entries, newest first, and stops at an edit made by hand", async () => {
    const undone: string[] = []
    const link = { ...fakeLink(), undoEdit: async (label: string) => (label === "b" ? (undone.push(label), { undone: true }) : { undone: false }) }
    expect(await undoAiEdit(link, ["a", "b"])).toBe(1)
    expect(undone).toEqual(["b"])
  })
})
