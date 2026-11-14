import { beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => {
  class InsufficientCreditsError extends Error {
    readonly code = "insufficient_credits"
    readonly appCreditsAllowance = 0
  }
  return {
    InsufficientCreditsError,
    plannerText: '{"steps":["pauses","captions","music"],"musicStyle":"calm piano","reply":"On it."}',
    plannerFails: false,
    musicFails: false,
    transcribeNoCredits: false,
    transcribeJobFails: false,
    transcribeDelayMs: 0,
    plannerNoCredits: false,
    statusErrors: 0,
    status401: false,
    musicJobFails: false,
    language: "eng",
    words: [] as Array<{ text: string; startMs: number; endMs: number }>,
    order: [] as string[],
  }
})

// Three words in a six-second take: a pause before, between and after them.
const WORDS = [
  { text: "Hello", startMs: 1000, endMs: 1400 },
  { text: "world.", startMs: 1500, endMs: 1900 },
  { text: "Again", startMs: 3500, endMs: 4000 },
]

vi.mock("@/lib/api", () => ({
  InsufficientCreditsError: api.InsufficientCreditsError,
  cancelJob: vi.fn(async () => ({ success: true, cancelled: 1 })),
  getCurrentUserId: vi.fn(async () => "8b1f6a2e-1c2d-4e5f-8a9b-0c1d2e3f4a5b"),
  transcribeApi: vi.fn(async () => {
    api.order.push("transcribe")
    if (api.transcribeDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, api.transcribeDelayMs))
    if (api.transcribeNoCredits) throw new api.InsufficientCreditsError("no credits")
    return { jobId: "job-transcribe" }
  }),
  sunoGenerateApi: vi.fn(async () => {
    api.order.push("music")
    if (api.musicFails) throw new Error("provider down")
    return { jobId: "job-music" }
  }),
  getJobStatusLean: vi.fn(async (id: string) => {
    if (id === "job-transcribe" && api.status401) throw Object.assign(new Error("Unauthorized"), { status: 401 })
    if (id === "job-transcribe" && api.statusErrors > 0) {
      api.statusErrors -= 1
      throw Object.assign(new Error("Service Unavailable"), { status: 503 })
    }
    if (id === "job-music" && api.musicJobFails) {
      return { status: "failed", error_message: "The music could not be made.", error_detail: "Suno refused the prompt" }
    }
    if (id === "job-transcribe" && api.transcribeJobFails) {
      return { status: "failed", error_message: "The transcription failed.", error_detail: "Audio file contains no audible speech" }
    }
    return id === "job-transcribe"
      ? { status: "completed", output_data: { json: { version: 1, language: api.language, words: api.words } } }
      : { status: "completed", output_data: { audioUrl: "https://cdn.example.com/track.mp3" } }
  }),
  generateAIWriterStream: vi.fn(async () => {
    if (api.plannerNoCredits) throw new api.InsufficientCreditsError("no credits")
    if (api.plannerFails) throw new Error("planner down")
    return { jobId: "job-plan", generatedText: api.plannerText }
  }),
}))

import { cancelJob, sunoGenerateApi, transcribeApi } from "@/lib/api"
import type { EditorLink, OpsResult, PresenceCursor } from "../editor-link"
import { RunFailed, RunStopped, musicFileOf, openedVideoMedia, runAiEdit, undoAiEdit, type RunEvent } from "../run-ai-edit"
import { readTimelineView } from "../edit-plan"

const VIDEO_URL = "https://cdn.example.com/uploads/take.mp4"

const TIMELINE = {
  fps: 30,
  durationInFrames: 180,
  items: [{ id: "v1", type: "video", trackId: "t1", from: 0, durationInFrames: 180, mediaId: "media-1", sourceStart: 0, sourceEnd: 180, sourceFps: 30 }],
  media: [{ id: "media-1", fileName: "take.mp4", duration: 6 }],
}

interface FakeLink extends EditorLink {
  readonly applied: Array<{ label: string; ops: ReadonlyArray<Record<string, unknown>> }>
  readonly imported: string[]
  readonly presences: Array<readonly PresenceCursor[]>
}

function fakeLink(timeline: unknown = TIMELINE): FakeLink {
  const applied: FakeLink["applied"] = []
  const imported: string[] = []
  const presences: FakeLink["presences"] = []
  return {
    applied,
    imported,
    presences,
    getTimeline: async () => timeline,
    applyOps: async (label, ops): Promise<OpsResult> => {
      applied.push({ label, ops })
      return { ok: true, recorded: true, timeline, results: [{ id: `item-${applied.length}` }] }
    },
    undoEdit: async () => ({ undone: false }),
    importFile: (ref) => imported.push(ref),
    playback: () => {},
    presence: (cursors) => presences.push(cursors),
    dispose: () => {},
  }
}

const NAMES = { lead: "Assistant", cutter: "Cutter", captions: "Captions", sound: "Sound" }
const LABELS = { fillers: "Remove filler words", pauses: "Cut the pauses", captions: "Add captions", music: "Add music" }

function run(link: EditorLink, events: RunEvent[] = [], signal = new AbortController().signal) {
  return runAiEdit({
    request: "cut the pauses, captions and calm music",
    videoUrl: VIDEO_URL,
    link,
    signal,
    names: NAMES,
    stepLabels: LABELS,
    onEvent: (e) => events.push(e),
    pace: () => 1000,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.plannerText = '{"steps":["pauses","captions","music"],"musicStyle":"calm piano","reply":"On it."}'
  api.plannerFails = false
  api.musicFails = false
  api.transcribeNoCredits = false
  api.transcribeJobFails = false
  api.transcribeDelayMs = 0
  api.plannerNoCredits = false
  api.statusErrors = 0
  api.status401 = false
  api.musicJobFails = false
  api.language = "eng"
  api.words = WORDS
  api.order = []
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(16), { status: 200 })))
})

describe("runAiEdit", () => {
  it("listens, plans, then cuts the pauses, captions and lays music, recording each undo entry", async () => {
    const link = fakeLink()
    const events: RunEvent[] = []

    const summary = await run(link, events)

    expect(transcribeApi).toHaveBeenCalledWith(VIDEO_URL, "elevenlabs-stt", undefined, expect.any(String), false, false, true)
    expect(events.find((e) => e.type === "plan")).toMatchObject({ plan: { steps: ["pauses", "captions", "music"], musicStyle: "calm piano" } })
    const cuts = link.applied.filter((a) => a.ops[0]!.op === "removeSourceRanges")
    expect(cuts.flatMap((c) => c.ops[0]!.ranges as unknown[])).toHaveLength(3)
    expect(link.applied.some((a) => a.ops[0]!.op === "addTranscriptCaptions")).toBe(true)
    const music = link.applied.find((a) => a.ops[0]!.op === "placeAudio")
    expect(music?.ops[0]).toMatchObject({ ref: link.imported[0], from: 0, durationInFrames: 180, newTrack: true })
    expect(summary).toMatchObject({ pausesCut: 3, music: true, fromSeconds: 6 })
    // Every step the editor recorded is reported, in order, for Undo all.
    const recorded = events.filter((e) => e.type === "recorded").map((e) => (e as { label: string }).label)
    expect(recorded).toHaveLength(link.applied.length)
    expect(recorded.at(-1)).toBe("Add music")
    expect(link.presences.at(-1)).toEqual([])
  })

  it("asks for music only once the video has been heard", async () => {
    await run(fakeLink())
    expect(api.order).toEqual(["transcribe", "music"])
  })

  it("reads the request itself when the planner does not answer", async () => {
    api.plannerFails = true
    const summary = await run(fakeLink())
    expect(summary).toMatchObject({ pausesCut: 3, music: true })
  })

  it("does only what the plan asks", async () => {
    api.plannerText = '{"steps":["captions"],"musicStyle":null,"reply":"Captions coming."}'
    const link = fakeLink()

    const summary = await run(link)

    expect(link.applied.every((a) => a.ops[0]!.op === "addTranscriptCaptions")).toBe(true)
    expect(sunoGenerateApi).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ pausesCut: 0, music: false })
  })

  it("keeps a long video's show short: at most twelve cut steps however many pauses", async () => {
    api.words = Array.from({ length: 60 }, (_, i) => ({ text: `w${i}`, startMs: i * 2000, endMs: i * 2000 + 400 }))
    const timeline = { ...TIMELINE, durationInFrames: 3600, items: [{ ...TIMELINE.items[0]!, durationInFrames: 3600, sourceEnd: 3600 }], media: [{ id: "media-1", fileName: "take.mp4", duration: 120 }] }
    const link = fakeLink(timeline)

    await run(link)

    expect(link.applied.filter((a) => a.ops[0]!.op === "removeSourceRanges").length).toBeLessThanOrEqual(12)
    expect(link.applied.filter((a) => a.ops[0]!.op === "addTranscriptCaptions").length).toBeLessThanOrEqual(10)
  })

  it("waits out a status read that fails while the API restarts, then goes on", async () => {
    api.statusErrors = 1
    const summary = await run(fakeLink())
    expect(summary).toMatchObject({ pausesCut: 3, music: true })
  })

  it("ends a run whose job it can no longer follow (signed out), and cancels that job", async () => {
    api.status401 = true
    await expect(run(fakeLink())).rejects.toMatchObject({ key: "freecutAi.signedOut" })
    expect(cancelJob).toHaveBeenCalledWith("job-transcribe")
  })

  it("cancels a job whose id arrives after the run has ended", async () => {
    api.transcribeDelayMs = 60
    api.plannerNoCredits = true
    await expect(run(fakeLink())).rejects.toMatchObject({ key: "freecutAi.noCredits" })
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(cancelJob).toHaveBeenCalledWith("job-transcribe")
  })

  it("shows a failed music job's provider words, and the rest of the edit is done", async () => {
    api.musicJobFails = true
    const events: RunEvent[] = []

    const summary = await run(fakeLink(), events)

    expect(summary).toMatchObject({ music: false, pausesCut: 3 })
    expect(events).toContainEqual(expect.objectContaining({ type: "agent", agent: "sound", state: "failed", key: "freecutAi.musicFailed", detail: "Suno refused the prompt" }))
  })

  it("keeps a Portuguese 'um': it is the article there, not a filler", async () => {
    api.language = "por"
    api.plannerText = '{"steps":["fillers"],"musicStyle":null,"reply":"Tirando os vícios de linguagem."}'
    api.words = [
      { text: "Um", startMs: 1000, endMs: 1200 },
      { text: " dia", startMs: 1250, endMs: 1500 },
      { text: " comprei", startMs: 1550, endMs: 1900 },
      { text: " um", startMs: 1950, endMs: 2100 },
      { text: " carro.", startMs: 2150, endMs: 2600 },
    ]
    const link = fakeLink()

    const summary = await run(link)

    expect(summary.fillersCut).toBe(0)
    expect(link.applied.filter((a) => a.ops[0]!.op === "removeSourceRanges")).toEqual([])
  })

  it("names a removed filler word without the transcript's punctuation", async () => {
    api.plannerText = '{"steps":["fillers"],"musicStyle":null,"reply":"Taking out the um."}'
    api.words = [
      { text: "Then,", startMs: 1000, endMs: 1300 },
      { text: " um,", startMs: 1500, endMs: 1650 },
      { text: " on", startMs: 1800, endMs: 1900 },
    ]
    const events: RunEvent[] = []

    const summary = await run(fakeLink(), events)

    expect(summary.fillersCut).toBe(1)
    expect(events).toContainEqual(expect.objectContaining({ type: "feed", key: "freecutAi.cutFiller", vars: { word: "um" } }))
  })

  it("finishes the rest of the edit when the music cannot be made", async () => {
    api.musicFails = true
    const events: RunEvent[] = []

    const summary = await run(fakeLink(), events)

    expect(summary).toMatchObject({ music: false, pausesCut: 3 })
    expect(events).toContainEqual(expect.objectContaining({ type: "agent", agent: "sound", state: "failed", key: "freecutAi.musicFailed" }))
  })

  it("says there are not enough credits instead of a failed transcription", async () => {
    api.transcribeNoCredits = true
    await expect(run(fakeLink())).rejects.toMatchObject({ key: "freecutAi.noCredits" })
  })

  it("stops on a failed transcription with the provider's words, and pays for no music", async () => {
    api.transcribeJobFails = true
    const link = fakeLink()

    await expect(run(link)).rejects.toMatchObject({ key: "freecutAi.listenFailed", detail: "Audio file contains no audible speech" })
    expect(sunoGenerateApi).not.toHaveBeenCalled()
    expect(link.applied).toEqual([])
    // The failed job is over: nothing is left to cancel.
    expect(cancelJob).not.toHaveBeenCalled()
  })

  it("cancels the transcription it started when the person stops", async () => {
    const controller = new AbortController()
    const events: RunEvent[] = []
    const link = fakeLink()
    const stopAtPlan = { ...link, presence: () => {} }
    const running = runAiEdit({
      request: "captions",
      videoUrl: VIDEO_URL,
      link: stopAtPlan,
      signal: controller.signal,
      names: NAMES,
      stepLabels: LABELS,
      onEvent: (e) => {
        events.push(e)
        if (e.type === "plan") controller.abort()
      },
      pace: () => 1000,
    })

    await expect(running).rejects.toBeInstanceOf(RunStopped)
    expect(cancelJob).toHaveBeenCalledWith("job-transcribe")
  })

  it("refuses a video longer than the limit before anything is paid for", async () => {
    const long = { ...TIMELINE, media: [{ id: "media-1", fileName: "take.mp4", duration: 25 * 60 }] }
    await expect(run(fakeLink(long))).rejects.toMatchObject({ key: "freecutAi.tooLong" })
    expect(transcribeApi).not.toHaveBeenCalled()
  })

  it("refuses an editor with no video on it", async () => {
    await expect(run(fakeLink({ fps: 30, durationInFrames: 0, items: [], media: [] }))).rejects.toBeInstanceOf(RunFailed)
  })
})

describe("musicFileOf", () => {
  const bytes = (...head: Array<number | string>) =>
    new Uint8Array(head.flatMap((part) => (typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : [part]))).buffer
  const unknown = new ArrayBuffer(16)

  it("names the music as its bytes are, whatever its address says", () => {
    // As a Suno track was served on 2026-11-13: ".wav" and audio/wav, but an ID3-tagged MP3.
    expect(musicFileOf(bytes("ID3", 4, 0, 0), "https://cdn.nodaro.ai/audios/8caa956f.wav", "audio/wav")).toEqual({ name: "ai-music.mp3", type: "audio/mpeg" })
    expect(musicFileOf(bytes("RIFF", 0, 0, 0, 0, "WAVE"), "https://cdn.example.com/track.mp3", "audio/mpeg")).toEqual({ name: "ai-music.wav", type: "audio/wav" })
    expect(musicFileOf(bytes(0xff, 0xfb, 0x90), "https://cdn.example.com/track", null)).toEqual({ name: "ai-music.mp3", type: "audio/mpeg" })
    expect(musicFileOf(bytes(0xff, 0xf1, 0x50), "https://cdn.example.com/track", null)).toEqual({ name: "ai-music.aac", type: "audio/aac" })
    expect(musicFileOf(bytes(0, 0, 0, 0x20, "ftypM4A "), "https://cdn.example.com/track", null)).toEqual({ name: "ai-music.m4a", type: "audio/mp4" })
  })

  it("falls back to the address, then the response's type, when the bytes say nothing", () => {
    expect(musicFileOf(unknown, "https://cdn.example.com/track.ogg", null)).toEqual({ name: "ai-music.ogg", type: "audio/ogg" })
    expect(musicFileOf(unknown, "https://cdn.example.com/track", "audio/x-wav")).toEqual({ name: "ai-music.wav", type: "audio/wav" })
    expect(musicFileOf(unknown, "https://cdn.example.com/track", "audio/flac; charset=binary")).toEqual({ name: "ai-music.flac", type: "audio/flac" })
    expect(musicFileOf(unknown, "https://cdn.example.com/track", null)).toEqual({ name: "ai-music.mp3", type: "audio/mpeg" })
    expect(musicFileOf(new ArrayBuffer(0), "https://cdn.example.com/track", null)).toEqual({ name: "ai-music.mp3", type: "audio/mpeg" })
  })
})

describe("openedVideoMedia", () => {
  const two = readTimelineView({
    fps: 30,
    durationInFrames: 300,
    items: [
      { id: "a", type: "video", trackId: "t", from: 0, durationInFrames: 150, mediaId: "m-intro" },
      { id: "b", type: "video", trackId: "t", from: 150, durationInFrames: 150, mediaId: "m-take" },
    ],
  })!
  const media = [
    { id: "m-intro", fileName: "intro.mp4" },
    { id: "m-take", fileName: "take.mp4" },
  ]

  it("picks the video named like the opened file when there are several", () => {
    expect(openedVideoMedia(two, media, VIDEO_URL)?.id).toBe("m-take")
  })

  it("refuses when the opened video cannot be told apart", () => {
    expect(() => openedVideoMedia(two, media, "https://cdn.example.com/other.mp4")).toThrow(RunFailed)
  })
})

describe("undoAiEdit", () => {
  it("undoes exactly the run's entries, newest first, and stops at an edit made by hand", async () => {
    // The run made four entries; then the person moved a clip by hand.
    const stack = ["Cut the pauses", "Cut the pauses", "Add captions", "Add music", "by hand"]
    const link: EditorLink = {
      ...fakeLink(),
      undoEdit: async (label) => {
        if (stack.at(-1) !== label) return { undone: false }
        stack.pop()
        return { undone: true }
      },
    }
    const recorded = ["Cut the pauses", "Cut the pauses", "Add captions", "Add music"]

    expect(await undoAiEdit(link, recorded)).toBe(0)
    stack.pop() // the person undoes their own edit
    expect(await undoAiEdit(link, recorded)).toBe(4)
    expect(stack).toEqual([])
  })
})
