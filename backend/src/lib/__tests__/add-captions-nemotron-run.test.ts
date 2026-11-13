import { beforeEach, describe, expect, it, vi } from "vitest"
import { addCaptionsNemotronMinutesId, ADD_CAPTIONS_KINETIC_CREDIT_ID, NEMOTRON_TRANSCRIBE_ID } from "@nodaro/shared/credits"

const shared = vi.hoisted(() => ({ commitJobCredits: vi.fn(), commitJobCreditsAtActualPrice: vi.fn() }))
vi.mock("../../workers/shared.js", () => ({
  commitJobCredits: shared.commitJobCredits,
  commitJobCreditsAtActualPrice: shared.commitJobCreditsAtActualPrice,
}))

/** The run's outside world: the audio extraction, the scratch store, and KIE behind `transcribe()`. */
const io = vi.hoisted(() => ({
  steps: [] as string[],
  noAudio: false,
  transcribeFails: false,
  transcribe: vi.fn(),
}))
vi.mock("../../providers/video/extract-audio-track.js", () => {
  class NoAudioTrackError extends Error {}
  return {
    NoAudioTrackError,
    extractAudioTrack: async (videoUrl: string) => {
      io.steps.push(`extract ${videoUrl}`)
      if (io.noAudio) throw new NoAudioTrackError("no audio")
      return { audioPath: "/tmp/w/audio.mp3", workDir: "/tmp/w" }
    },
  }
})
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  cleanupWorkDir: async (dir: string) => {
    io.steps.push(`cleanup ${dir}`)
  },
}))
vi.mock("../job-scratch.js", () => ({
  uploadJobScratchFile: async (path: string, name: string, ext: string, type: string, jobId: string) => {
    io.steps.push(`upload ${path} ${name}.${ext} ${type} ${jobId}`)
    return "https://media.example/tmp/provider-input/job/captions-audio-1.mp3"
  },
  discardJobScratchFile: async (url: string, jobId: string) => {
    io.steps.push(`discard ${url} ${jobId}`)
  },
}))
vi.mock("../../providers/audio/transcribe.js", () => ({
  transcribe: async (...args: unknown[]) => {
    io.steps.push("transcribe")
    io.transcribe(...args)
    if (io.transcribeFails) throw new Error("KIE refused the file")
    return {
      text: "hello there",
      language: "unknown",
      words: [{ text: "hello", startMs: 0, endMs: 500, timestampMs: null, confidence: null }],
      billedDurationSec: 610,
      billedKieCredits: 3.05,
      cost: 0.01525,
    }
  },
}))

import {
  addCaptionsRenderChargeId,
  addCaptionsRenderChargeOf,
  captionsChargeAfterTranscription,
  commitAddCaptionsRender,
  transcribeCaptionVideoOnNemotron,
  type AddCaptionsRenderCharge,
} from "../add-captions-nemotron-run.js"

const HELD_10 = addCaptionsNemotronMinutesId(10)
const AUDIO = "https://media.example/tmp/provider-input/job/captions-audio-1.mp3"

let error: ReturnType<typeof vi.spyOn>
let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  io.steps = []
  io.noAudio = false
  io.transcribeFails = false
  error = vi.spyOn(console, "error").mockImplementation(() => {})
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})

function commits(): number {
  return shared.commitJobCredits.mock.calls.length + shared.commitJobCreditsAtActualPrice.mock.calls.length
}

describe("transcribeCaptionVideoOnNemotron: KIE gets the video's AUDIO TRACK, never the video", () => {
  it("extracts and stores the audio, sends that with word timings and no translation, then deletes it", async () => {
    const run = await transcribeCaptionVideoOnNemotron({ jobId: "job", videoUrl: "https://cdn.example/clip.mp4", measuredSec: 605 })
    expect(io.transcribe).toHaveBeenCalledTimes(1)
    const [url, engine, language, opts] = io.transcribe.mock.calls[0]!
    expect(url).toBe(AUDIO)
    expect(engine).toBe(NEMOTRON_TRANSCRIBE_ID)
    expect(language).toBeUndefined()
    expect(opts).toEqual({ wordTimestamps: true, durationSec: 605 })
    expect(opts).not.toHaveProperty("targetLanguage")
    expect(io.steps).toEqual([
      "extract https://cdn.example/clip.mp4",
      "upload /tmp/w/audio.mp3 captions-audio.mp3 audio/mpeg job",
      "cleanup /tmp/w",
      "transcribe",
      `discard ${AUDIO} job`,
    ])
    expect(run).toEqual({
      words: [{ text: "hello", startMs: 0, endMs: 500, timestampMs: null, confidence: null }],
      ranLocally: true,
      kieSec: 610,
      kieCredits: 3.05,
      providerCost: 0.01525,
    })
  })

  it("deletes the stored audio when the transcription fails too", async () => {
    io.transcribeFails = true
    await expect(transcribeCaptionVideoOnNemotron({ jobId: "job", videoUrl: "https://cdn.example/clip.mp4" })).rejects.toThrow("KIE refused")
    expect(io.steps.at(-1)).toBe(`discard ${AUDIO} job`)
  })

  it("relayed (a keyless install): the cloud gets the stored audio, KIE is never called here, the file still deleted", async () => {
    const relay = vi.fn(async () => ({ words: [] }))
    const run = await transcribeCaptionVideoOnNemotron({ jobId: "job", videoUrl: "https://cdn.example/clip.mp4", relay })
    expect(relay).toHaveBeenCalledWith(AUDIO)
    expect(io.transcribe).not.toHaveBeenCalled()
    expect(run).toEqual({ words: [], ranLocally: false })
    expect(io.steps.at(-1)).toBe(`discard ${AUDIO} job`)
  })

  it("a video with no audio track: nothing stored, nothing sent, null (as a transcription with no words)", async () => {
    io.noAudio = true
    expect(await transcribeCaptionVideoOnNemotron({ jobId: "job", videoUrl: "https://cdn.example/silent.mp4" })).toBeNull()
    expect(io.steps).toEqual(["extract https://cdn.example/silent.mp4"])
  })
})

describe("captionsChargeAfterTranscription: what the video worker hands the render", () => {
  const ranHere = { ranLocally: true, kieSec: 610, kieCredits: 3.05, providerCost: 0.01525 }

  it("a per-minute hold whose Nemotron transcription ran here: KIE's figures", () => {
    expect(captionsChargeAfterTranscription("job", HELD_10, ranHere, 605)).toEqual({
      kind: "nemotron",
      heldId: HELD_10,
      measuredSec: 605,
      kieSec: 610,
      kieCredits: 3.05,
      providerCost: 0.01525,
    })
  })

  it("a per-minute hold with no Nemotron run here (relayed, no audio, nothing to transcribe): the plain render", () => {
    const plain = { kind: "at", heldId: HELD_10, creditId: ADD_CAPTIONS_KINETIC_CREDIT_ID }
    expect(captionsChargeAfterTranscription("job", HELD_10, { ranLocally: false }, 605)).toEqual(plain)
    expect(captionsChargeAfterTranscription("job", HELD_10, undefined, 605)).toEqual(plain)
  })

  it("a plain hold on which Nemotron ran here anyway (the key appeared after the hold): the render alone, logged", () => {
    expect(captionsChargeAfterTranscription("job", undefined, ranHere, undefined)).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    expect(captionsChargeAfterTranscription("job", undefined, undefined, undefined)).toBeUndefined()
  })
})

describe("the render worker's settle (one commit)", () => {
  it("the render job's data carries the charge, validated on the way back", () => {
    const charge: AddCaptionsRenderCharge = { kind: "nemotron", heldId: HELD_10, measuredSec: 605, kieSec: 610 }
    expect(addCaptionsRenderChargeOf({ jobId: "job", captionsCharge: charge })).toEqual(charge)
    expect(addCaptionsRenderChargeOf({ captionsCharge: { kind: "at", heldId: HELD_10, creditId: ADD_CAPTIONS_KINETIC_CREDIT_ID } })).toEqual({
      kind: "at",
      heldId: HELD_10,
      creditId: ADD_CAPTIONS_KINETIC_CREDIT_ID,
    })
    expect(addCaptionsRenderChargeOf({ jobId: "job" })).toBeUndefined()
    expect(addCaptionsRenderChargeOf({ captionsCharge: { kind: "nemotron" } })).toBeUndefined()
    expect(addCaptionsRenderChargeOf({ captionsCharge: { kind: "nemotron", heldId: HELD_10, kieSec: "610" } })).toEqual({ kind: "nemotron", heldId: HELD_10 })
  })

  it("KIE's minutes are the held minutes: the hold committed as it is", async () => {
    const charge: AddCaptionsRenderCharge = { kind: "nemotron", heldId: HELD_10, measuredSec: 590, kieSec: 595 }
    const id = addCaptionsRenderChargeId("job", charge)
    expect(id).toBe(HELD_10)
    await commitAddCaptionsRender("ul", "job", charge, id)
    expect(shared.commitJobCredits).toHaveBeenCalledWith("ul", "job")
    expect(commits()).toBe(1)
  })

  it("KIE decoded more: charged at KIE's minutes, up, through the metered commit — with the caption id family", async () => {
    const charge: AddCaptionsRenderCharge = { kind: "nemotron", heldId: HELD_10, measuredSec: 600, kieSec: 610 }
    const id = addCaptionsRenderChargeId("job", charge)
    expect(id).toBe(addCaptionsNemotronMinutesId(11))
    await commitAddCaptionsRender("ul", "job", charge, id)
    expect(shared.commitJobCreditsAtActualPrice).toHaveBeenCalledWith("ul", "job", addCaptionsNemotronMinutesId(11))
    expect(commits()).toBe(1)
  })

  it("the 1 s grace upward holds here too", () => {
    expect(addCaptionsRenderChargeId("job", { kind: "nemotron", heldId: HELD_10, measuredSec: 600, kieSec: 600.8 })).toBe(HELD_10)
    expect(addCaptionsRenderChargeId("job", { kind: "nemotron", heldId: HELD_10, measuredSec: 600, kieSec: 601.2 })).toBe(addCaptionsNemotronMinutesId(11))
  })

  it("no length from KIE: its credits, then the measured length, then the hold (a whole unmeasured 60-minute hold alerted)", () => {
    expect(addCaptionsRenderChargeId("job", { kind: "nemotron", heldId: HELD_10, kieCredits: 0.6 })).toBe(addCaptionsNemotronMinutesId(2))
    expect(addCaptionsRenderChargeId("job", { kind: "nemotron", heldId: HELD_10, measuredSec: 300 })).toBe(addCaptionsNemotronMinutesId(5))
    expect(addCaptionsRenderChargeId("job", { kind: "nemotron", heldId: addCaptionsNemotronMinutesId(60) })).toBeUndefined()
    expect(error.mock.calls.some((c: unknown[]) => String(c[0]).startsWith("[ALERT] [add-captions]"))).toBe(true)
  })

  it("a per-minute hold that relayed settles DOWN to the plain render, exactly once (never charged twice)", async () => {
    const charge: AddCaptionsRenderCharge = { kind: "at", heldId: HELD_10, creditId: ADD_CAPTIONS_KINETIC_CREDIT_ID }
    const id = addCaptionsRenderChargeId("job", charge)
    await commitAddCaptionsRender("ul", "job", charge, id)
    expect(shared.commitJobCreditsAtActualPrice).toHaveBeenCalledWith("ul", "job", ADD_CAPTIONS_KINETIC_CREDIT_ID)
    expect(commits()).toBe(1)
  })

  it("no charge (every other render): the hold committed as before", async () => {
    await commitAddCaptionsRender("ul", "job", undefined, addCaptionsRenderChargeId("job", undefined))
    expect(shared.commitJobCredits).toHaveBeenCalledWith("ul", "job")
    expect(commits()).toBe(1)
  })
})
