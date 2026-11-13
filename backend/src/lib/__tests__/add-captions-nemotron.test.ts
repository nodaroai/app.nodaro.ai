import { beforeEach, describe, expect, it, vi } from "vitest"
import { addCaptionsNemotronCreditId, addCaptionsNemotronMinutesId, NEMOTRON_TRANSCRIBE_ID } from "@nodaro/shared/credits"

const probe = vi.hoisted(() => ({
  fn: (async () => ({ durationSec: 600, sizeBytes: 900 * 1024 * 1024 })) as (url: string) => Promise<{ durationSec?: number; sizeBytes?: number }>,
  urls: [] as string[],
  guard: (async () => {}) as (url: string) => Promise<void>,
}))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  assertSafeProbeSource: async (url: string) => probe.guard(url),
  probeMediaDurationAndSize: async (url: string) => {
    probe.urls.push(url)
    return probe.fn(url)
  },
}))
/** Whether this install relays a Nemotron transcription to the cloud (keyless, connected). */
const cloud = vi.hoisted(() => ({ relays: false }))
vi.mock("../../providers/nodaro/run-on-cloud.js", () => ({
  shouldRunOnCloud: async () => cloud.relays,
}))

import {
  addCaptionsNemotronReserveId,
  addCaptionsTranscribesOnNemotron,
  measureAddCaptionsNemotronHold,
  stampAddCaptionsNemotronInput,
} from "../add-captions-nemotron.js"

const VIDEO = "https://cdn.example/clip.mp4"

beforeEach(() => {
  probe.fn = async () => ({ durationSec: 600, sizeBytes: 900 * 1024 * 1024 })
  probe.urls = []
  probe.guard = async () => {}
  cloud.relays = false
})

describe("addCaptionsTranscribesOnNemotron: the per-minute hold only when a transcription runs on Nemotron", () => {
  it("a Nemotron render with no caption source of its own", () => {
    expect(addCaptionsTranscribesOnNemotron({ transcribe_provider: NEMOTRON_TRANSCRIBE_ID, style: "word-highlight" })).toBe(true)
    expect(addCaptionsTranscribesOnNemotron({ transcribe_provider: NEMOTRON_TRANSCRIBE_ID, style: "subtitle" })).toBe(true)
  })

  it("never for a render that brings its own captions, transcript or static text, or turns transcription off", () => {
    const n = { transcribe_provider: NEMOTRON_TRANSCRIBE_ID }
    expect(addCaptionsTranscribesOnNemotron({ ...n, style: "karaoke", captions: [{ text: "hi", startMs: 0, endMs: 1 }] })).toBe(false)
    expect(addCaptionsTranscribesOnNemotron({ ...n, style: "karaoke", transcript: { words: [] } })).toBe(false)
    expect(addCaptionsTranscribesOnNemotron({ ...n, style: "subtitle", text: "Hello" })).toBe(false)
    expect(addCaptionsTranscribesOnNemotron({ ...n, style: "karaoke", auto_transcribe: false })).toBe(false)
  })

  it("never on another engine", () => {
    expect(addCaptionsTranscribesOnNemotron({ transcribe_provider: "elevenlabs-stt", style: "karaoke" })).toBe(false)
    expect(addCaptionsTranscribesOnNemotron({ style: "karaoke" })).toBe(false)
  })
})

describe("measureAddCaptionsNemotronHold (the route's preHandler and the workflow run's stamp)", () => {
  it("holds the render plus the video's measured minutes", async () => {
    expect(await measureAddCaptionsNemotronHold({ transcribe_provider: NEMOTRON_TRANSCRIBE_ID, videoUrl: VIDEO })).toEqual({
      ok: true,
      hold: { creditId: addCaptionsNemotronCreditId(600), durationSec: 600 },
    })
    expect(probe.urls).toEqual([VIDEO])
  })

  it("never refuses on the video's SIZE: only its audio track is sent", async () => {
    probe.fn = async () => ({ durationSec: 61, sizeBytes: 5 * 1024 * 1024 * 1024 })
    expect(await measureAddCaptionsNemotronHold({ transcribe_provider: NEMOTRON_TRANSCRIBE_ID, videoUrl: VIDEO })).toMatchObject({
      ok: true,
      hold: { creditId: addCaptionsNemotronMinutesId(2) },
    })
  })

  it("refuses a video over 60 minutes, and anything but an https link the SSRF guard passes, before anything is held", async () => {
    probe.fn = async () => ({ durationSec: 3601 })
    expect(await measureAddCaptionsNemotronHold({ transcribe_provider: NEMOTRON_TRANSCRIBE_ID, videoUrl: VIDEO })).toMatchObject({
      ok: false,
      code: "media_duration_exceeds_limit",
    })
    expect(await measureAddCaptionsNemotronHold({ transcribe_provider: NEMOTRON_TRANSCRIBE_ID, videoUrl: "http://cdn.example/clip.mp4" })).toMatchObject({
      ok: false,
      code: "invalid_media_url",
    })
    probe.guard = async () => {
      throw new Error("resolves to a private address")
    }
    probe.urls = []
    expect(await measureAddCaptionsNemotronHold({ transcribe_provider: NEMOTRON_TRANSCRIBE_ID, videoUrl: VIDEO })).toMatchObject({
      ok: false,
      code: "invalid_media_url",
    })
    expect(probe.urls).toEqual([])
  })

  it("holds 60 minutes for a video whose length cannot be read", async () => {
    probe.fn = async () => {
      throw new Error("ffprobe: invalid data")
    }
    expect(await measureAddCaptionsNemotronHold({ transcribe_provider: NEMOTRON_TRANSCRIBE_ID, videoUrl: VIDEO })).toEqual({
      ok: true,
      hold: { creditId: addCaptionsNemotronMinutesId(60) },
    })
  })

  it("a keyless install that relays the transcription holds the render alone: the cloud bills the minutes, never both", async () => {
    cloud.relays = true
    expect(await measureAddCaptionsNemotronHold({ transcribe_provider: NEMOTRON_TRANSCRIBE_ID, videoUrl: VIDEO })).toEqual({ ok: true })
    expect(probe.urls).toEqual([])
  })

  it("a render that transcribes nothing, or on another engine, holds its own price and measures nothing", async () => {
    expect(await measureAddCaptionsNemotronHold({ transcribe_provider: NEMOTRON_TRANSCRIBE_ID, videoUrl: VIDEO, style: "subtitle", text: "Hi" })).toEqual({ ok: true })
    expect(await measureAddCaptionsNemotronHold({ transcribe_provider: "elevenlabs-stt", videoUrl: VIDEO })).toEqual({ ok: true })
    expect(probe.urls).toEqual([])
  })
})

describe("stampAddCaptionsNemotronInput / addCaptionsNemotronReserveId (the workflow run)", () => {
  it("stamps the per-minute hold and the measured length, which the reserve chain then holds", async () => {
    const payload: Record<string, unknown> = { videoUrl: VIDEO, transcribe_provider: NEMOTRON_TRANSCRIBE_ID, style: "word-highlight" }
    expect(await stampAddCaptionsNemotronInput("add-captions", payload)).toBeUndefined()
    expect(payload.duration_seconds).toBe(600)
    expect(addCaptionsNemotronReserveId("add-captions", payload)).toBe(addCaptionsNemotronCreditId(600))
  })

  it("returns the route's refusal for a video it would refuse", async () => {
    probe.fn = async () => ({ durationSec: 4000 })
    const payload: Record<string, unknown> = { videoUrl: VIDEO, transcribe_provider: NEMOTRON_TRANSCRIBE_ID }
    expect(await stampAddCaptionsNemotronInput("add-captions", payload)).toMatchObject({ code: "media_duration_exceeds_limit" })
    expect(addCaptionsNemotronReserveId("add-captions", payload)).toBeUndefined()
  })

  it("relayed: nothing stamped, so the run reserves the render's own row", async () => {
    cloud.relays = true
    const payload: Record<string, unknown> = { videoUrl: VIDEO, transcribe_provider: NEMOTRON_TRANSCRIBE_ID }
    expect(await stampAddCaptionsNemotronInput("add-captions", payload)).toBeUndefined()
    expect(addCaptionsNemotronReserveId("add-captions", payload)).toBeUndefined()
    expect(payload.duration_seconds).toBeUndefined()
  })

  it("leaves every other job untouched", async () => {
    const payload: Record<string, unknown> = { audioUrl: VIDEO, provider: NEMOTRON_TRANSCRIBE_ID }
    expect(await stampAddCaptionsNemotronInput("transcribe", payload)).toBeUndefined()
    expect(addCaptionsNemotronReserveId("transcribe", { ...payload, bucketKey: addCaptionsNemotronCreditId(600) })).toBeUndefined()
    expect(probe.urls).toEqual([])
  })

  it("reserves only a per-minute caption id", () => {
    expect(addCaptionsNemotronReserveId("add-captions", { bucketKey: "add-captions:kinetic" })).toBeUndefined()
  })
})
