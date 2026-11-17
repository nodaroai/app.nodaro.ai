/**
 * Suno on KIE's market lane (suno-market.ts, decided 2026-11-17): Suno Speech,
 * cover by id and a stem to WAV. Each request body is the saved schema's
 * allow-list; the tracks of a finished task are read where the schema puts
 * them (`data.response.data[]`) and in the other Suno shapes; two takes come
 * back as two tracks with their durations.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/config.js", () => ({
  config: {
    KIE_API_KEY: "test-kie-key",
    KIE_API_BASE_URL: "https://api.kie.ai",
    NODE_ENV: "test",
    EDITION: "cloud",
  },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

import { sunoSpeechRun } from "@nodaro/render-rules"
import {
  SUNO_SPEECH_PROVIDER_COST_USD,
  SunoCoverByIdInexpressibleError,
  SunoCoverByIdRefusedError,
  isDefiniteCreateRefusal,
  sunoConvertWavStem,
  sunoCoverById,
  sunoCoverByIdInput,
  sunoMarketTracksOf,
  sunoSpeech,
} from "../suno-market.js"

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function withTimers<T>(fn: () => Promise<T>, advanceMs = 600_000): Promise<T> {
  const promise = fn()
  promise.catch(() => undefined)
  await vi.advanceTimersByTimeAsync(advanceMs)
  return promise
}

/** createTask answers a task id; every recordInfo poll answers `record`. */
function mockCreateThenRecord(record: unknown, taskId = "t-market"): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/jobs/createTask")) return new Response(JSON.stringify({ code: 200, data: { taskId } }), { status: 200 })
    if (url.includes("/jobs/recordInfo")) return new Response(JSON.stringify(record), { status: 200 })
    throw new Error(`unexpected url ${url}`)
  })
}

function createTaskBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/jobs/createTask"))
  expect(call, "createTask was called").toBeDefined()
  return JSON.parse((call![1] as { body: string }).body) as Record<string, unknown>
}

/** The record the speech and cover schemas document: two takes in `data.response.data[]`. */
const TWO_TAKES = {
  code: 200,
  data: {
    taskId: "t-market",
    state: "success",
    response: {
      data: [
        { id: "clip-1", audio_url: "https://cdn.example/a.mp3", stream_audio_url: "https://cdn.example/a-stream", image_url: "https://cdn.example/a.jpeg", title: "", duration: 12.3 },
        { id: "clip-2", audio_url: "https://cdn.example/b.mp3", stream_audio_url: "https://cdn.example/b-stream", image_url: "https://cdn.example/b.jpeg", title: "", duration: 11.8 },
      ],
    },
  },
}

describe("sunoMarketTracksOf — where a finished task's tracks sit", () => {
  it("reads the documented data.response.data[]: both takes, their ids and durations; never the stream URL", () => {
    expect(sunoMarketTracksOf(TWO_TAKES.data)).toStrictEqual([
      { id: "clip-1", audioUrl: "https://cdn.example/a.mp3", duration: 12.3, imageUrl: "https://cdn.example/a.jpeg" },
      { id: "clip-2", audioUrl: "https://cdn.example/b.mp3", duration: 11.8, imageUrl: "https://cdn.example/b.jpeg" },
    ])
  })

  it("also reads resultJson (a string or an object), its resultObject.data, and sunoData", () => {
    const track = { id: "x", audio_url: "https://cdn.example/x.mp3" }
    expect(sunoMarketTracksOf({ resultJson: JSON.stringify({ resultObject: { data: [track] } }) })).toHaveLength(1)
    expect(sunoMarketTracksOf({ resultJson: { data: [track] } })).toHaveLength(1)
    expect(sunoMarketTracksOf({ response: { sunoData: [track] } })).toHaveLength(1)
  })

  it("drops a track with no downloadable audio (a stream URL alone is not stored)", () => {
    expect(sunoMarketTracksOf({ response: { data: [{ id: "s", stream_audio_url: "https://cdn.example/s" }] } })).toStrictEqual([])
  })
})

describe("sunoSpeech", () => {
  it("creates ai-music-api/speech with the Brief allow-list and returns both takes", async () => {
    mockCreateThenRecord(TWO_TAKES)
    const result = await withTimers(() => sunoSpeech(sunoSpeechRun({ mode: "brief", prompt: "A short morning news intro" })))
    expect(createTaskBody()).toStrictEqual({ model: "ai-music-api/speech", input: { customMode: false, prompt: "A short morning news intro" } })
    expect(result.taskId).toBe("t-market")
    expect(result.tracks.map((t) => [t.id, t.duration])).toStrictEqual([["clip-1", 12.3], ["clip-2", 11.8]])
  })

  it("Script sends only the script and the options set", async () => {
    mockCreateThenRecord(TWO_TAKES)
    await withTimers(() => sunoSpeech(sunoSpeechRun({ mode: "script", script: "Hello there.", tone: "warm", vocalGender: "male", prompt: "dropped" })))
    expect(createTaskBody()).toStrictEqual({ model: "ai-music-api/speech", input: { customMode: true, script: "Hello there.", tone: "warm", vocalGender: "m" } })
  })

  it("a failed task is an upstream failure; a success with no track is a failure, never an empty success", async () => {
    mockCreateThenRecord({ code: 200, data: { taskId: "t-market", state: "fail", failCode: "422", failMsg: "variety must be between 0 and 4" } })
    await expect(withTimers(() => sunoSpeech(sunoSpeechRun({ prompt: "x" })))).rejects.toThrow()
    mockCreateThenRecord({ code: 200, data: { taskId: "t-market", state: "success", response: { data: [] } } })
    await expect(withTimers(() => sunoSpeech(sunoSpeechRun({ prompt: "x" })))).rejects.toThrow()
  })

  it("records KIE's charge for one request: 12 KIE credits", () => {
    expect(SUNO_SPEECH_PROVIDER_COST_USD).toBeCloseTo(0.06, 10)
  })
})

describe("cover by id", () => {
  const base = { taskId: "gen-task", audioId: "track-2", model: "V6" as const }
  const ids = { task_id: "gen-task", audio_id: "track-2", model: "V6" }

  // Every row of the mapping (suno-cover-by-id.ts): what the upload lane would
  // have been sent, and the by-id body that says the same — or none, and the
  // run covers the file.
  it.each([
    ["simple, a prompt alone: the prompt is the style", { prompt: "jazz version" }, { ...ids, instrumental: false, style: "jazz version" }],
    ["simple, a style alone", { style: "folk" }, { ...ids, instrumental: false, style: "folk" }],
    ["simple, a prompt beside a style: not expressible", { prompt: "jazz version", style: "folk" }, undefined],
    ["simple, lyrics left in the node's data are never sent or sung", { prompt: "jazz version", lyrics: "old words" }, { ...ids, instrumental: false, style: "jazz version" }],
    ["simple, lyrics in the data, a prompt and a style: not expressible", { prompt: "jazz", lyrics: "old words", style: "folk" }, undefined],
    ["simple, a prompt of exactly the style limit", { prompt: "j".repeat(1000) }, { ...ids, instrumental: false, style: "j".repeat(1000) }],
    ["simple, a prompt over the style limit: not expressible, never cut", { prompt: "j".repeat(1001) }, undefined],
    ["V4: the style limit is 200", { model: "V4" as const, prompt: "j".repeat(201) }, undefined],
    ["custom, a prompt alone: the prompt is sung as the lyrics", { customMode: true, prompt: "la la" }, { ...ids, instrumental: false, lyrics: "la la" }],
    ["custom, a long prompt is lyrics, not a style: sent whole", { customMode: true, prompt: "l".repeat(3000) }, { ...ids, instrumental: false, lyrics: "l".repeat(3000) }],
    ["custom, a prompt and a style: lyrics and style", { customMode: true, prompt: "la la", style: "folk" }, { ...ids, instrumental: false, lyrics: "la la", style: "folk" }],
    ["custom, lyrics and a prompt: two texts to sing, not expressible (the file lane sends both)", { customMode: true, prompt: "make it jazz", lyrics: "real words" }, undefined],
    ["custom, lyrics, a prompt and a style: not expressible", { customMode: true, prompt: "make it jazz", lyrics: "real words", style: "folk" }, undefined],
    ["custom, lyrics and a style, no prompt", { customMode: true, lyrics: "real words", style: "folk" }, { ...ids, instrumental: false, lyrics: "real words", style: "folk" }],
    ["instrumental, a prompt alone: the style, no lyrics", { instrumental: true, prompt: "lofi beat" }, { ...ids, instrumental: true, style: "lofi beat" }],
    ["instrumental custom with lyrics and a gender: neither is sent (the schema forbids them)", { instrumental: true, customMode: true, lyrics: "words", vocalGender: "male", style: "lofi" }, { ...ids, instrumental: true, style: "lofi" }],
    ["instrumental, a prompt beside a style: not expressible", { instrumental: true, customMode: true, prompt: "words", style: "lofi" }, undefined],
  ])("%s", (_name, fields, body) => {
    expect(sunoCoverByIdInput({ ...base, ...fields })).toStrictEqual(body)
  })

  it("title, negative_tags, vocal_gender as f / m and the persona ride along; never upload_url", () => {
    const body = sunoCoverByIdInput({ ...base, customMode: true, prompt: "la la", style: "folk", title: "T", negativeStyle: "metal", vocalGender: "female", personaId: "p1" })
    expect(body).toStrictEqual({ ...ids, instrumental: false, lyrics: "la la", style: "folk", title: "T", negative_tags: "metal", vocal_gender: "f", persona_id: "p1", persona_model: "voice_persona" })
    expect(body).not.toHaveProperty("upload_url")
  })

  it("creates the market cover model and returns its takes", async () => {
    mockCreateThenRecord(TWO_TAKES)
    const result = await withTimers(() => sunoCoverById({ ...base, prompt: "jazz" }))
    const body = createTaskBody()
    expect(body.model).toBe("ai-music-api/upload-and-cover-audio")
    expect(body.input).not.toHaveProperty("upload_url")
    expect(result.tracks).toHaveLength(2)
  })

  it.each([
    ["an HTTP 422", () => new Response(JSON.stringify({ code: 422, msg: "audio not found" }), { status: 422 })],
    ["an HTTP 400", () => new Response("bad request", { status: 400 })],
    ["a 200 whose body carries an error code", () => new Response(JSON.stringify({ code: 422, message: "The audio no longer exists" }), { status: 200 })],
    ["a 200 whose body carries code 500", () => new Response(JSON.stringify({ code: 500, message: "Server exception" }), { status: 200 })],
  ])("a definite refusal at create (%s) is a SunoCoverByIdRefusedError: no task exists, so the run may cover the file", async (_name, answer) => {
    fetchMock.mockImplementation(async () => answer())
    await expect(withTimers(() => sunoCoverById({ ...base, prompt: "jazz" }))).rejects.toBeInstanceOf(SunoCoverByIdRefusedError)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/jobs/recordInfo"))).toHaveLength(0)
  })

  it.each([
    ["a gateway 502", () => new Response("Bad Gateway", { status: 502 })],
    ["an HTTP 500", () => new Response(JSON.stringify({ code: 500, msg: "Server exception" }), { status: 500 })],
    ["a 200 whose body is not JSON", () => new Response("<html>ok</html>", { status: 200 })],
    ["a 200 with no task id", () => new Response(JSON.stringify({ code: 200, data: {} }), { status: 200 })],
  ])("a create that may have made a task (%s) is thrown as it is: never a refusal, so never a second task", async (_name, answer) => {
    fetchMock.mockImplementation(async () => answer())
    const err = await withTimers(() => sunoCoverById({ ...base, prompt: "jazz" })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(SunoCoverByIdRefusedError)
    expect(isDefiniteCreateRefusal(err)).toBe(false)
  })

  it("a connection that fails at create is thrown as it is (a task may exist), and a task that fails later is the task's failure", async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError("fetch failed") })
    const lost = await withTimers(() => sunoCoverById({ ...base, prompt: "jazz" })).catch((e: unknown) => e)
    expect(lost).not.toBeInstanceOf(SunoCoverByIdRefusedError)
    mockCreateThenRecord({ code: 200, data: { taskId: "t-market", state: "fail", failCode: "500", failMsg: "boom" } })
    const failed = await withTimers(() => sunoCoverById({ ...base, prompt: "jazz" })).catch((e: unknown) => e)
    expect(failed).not.toBeInstanceOf(SunoCoverByIdRefusedError)
    expect(failed).toBeInstanceOf(Error)
  })

  it("fields a by-id body cannot say are never sent", async () => {
    await expect(sunoCoverById({ ...base, prompt: "jazz", style: "folk" })).rejects.toBeInstanceOf(SunoCoverByIdInexpressibleError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("a stem to WAV", () => {
  it("sends the separation's task id and the stem's id to the WAV model, and returns resultUrls[0]", async () => {
    mockCreateThenRecord({ code: 200, data: { taskId: "t-wav", state: "success", resultJson: JSON.stringify({ resultUrls: ["https://cdn.example/stem.wav"] }) } }, "t-wav")
    const result = await withTimers(() => sunoConvertWavStem({ taskId: "sep-task", audioId: "stem-vocals" }))
    expect(createTaskBody()).toStrictEqual({ model: "ai-music-api/convert-to-wav-format", input: { task_id: "sep-task", audio_id: "stem-vocals" } })
    expect(result).toStrictEqual({ taskId: "t-wav", audioUrl: "https://cdn.example/stem.wav" })
  })
})
