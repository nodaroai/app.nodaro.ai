/**
 * Suno Add Vocals / Add Instrumental on KIE's market lane (decided
 * 2026-11-23): the bodies are the documented allow-lists (the song as
 * `upload_url`, the four required fields always present, every optional field
 * only when set, `vocal_gender` as m / f, the style as `tags` on Add
 * Instrumental, no prompt there), and the two runs create the documented
 * market models and return the task's tracks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/config.js", () => ({
  config: { KIE_API_KEY: "test-kie-key", KIE_API_BASE_URL: "https://api.kie.ai", NODE_ENV: "test", EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

import {
  SUNO_ADD_INSTRUMENTAL_MARKET_MODEL,
  SUNO_ADD_TRACK_FALLBACK_TITLE,
  SUNO_ADD_VOCALS_MARKET_MODEL,
  sunoAddInstrumentalInput,
  sunoAddVocalsInput,
  sunoAddTrackTextProblem,
  sunoVocalGenderCode,
} from "../suno-add-track.js"
import { sunoAddInstrumental, sunoAddVocals } from "../suno-market.js"

const SONG = "https://cdn.example/song.wav"
const BARE = { uploadUrl: SONG, style: "soulful pop", title: "Fresh Step" }

describe("the Add Vocals body", () => {
  it("an old-style run (no direction) still carries what KIE requires: the file, title, style, an empty negative_tags, the model", () => {
    expect(sunoAddVocalsInput(BARE)).toEqual({
      upload_url: SONG, model: "V6", title: "Fresh Step", negative_tags: "", style: "soulful pop",
    })
  })

  it("every field the person sets is sent in KIE's names, vocal_gender as m / f", () => {
    expect(sunoAddVocalsInput({
      ...BARE, model: "V6_WILD", prompt: "[Verse] la la", negativeTags: "rap", vocalGender: "female",
      styleWeight: 0.6, weirdnessConstraint: 0.25, audioWeight: 0.8,
    })).toEqual({
      upload_url: SONG, model: "V6_WILD", title: "Fresh Step", negative_tags: "rap", style: "soulful pop", prompt: "[Verse] la la",
      vocal_gender: "f", style_weight: 0.6, weirdness_constraint: 0.25, audio_weight: 0.8,
    })
    expect(sunoAddVocalsInput({ ...BARE, vocalGender: "male" }).vocal_gender).toBe("m")
  })

  it("fields left empty are not sent; weights off KIE's grid are rounded to 0.01, out of range dropped", () => {
    const body = sunoAddVocalsInput({ ...BARE, prompt: "   ", vocalGender: "other", styleWeight: 0.333, weirdnessConstraint: 1.5, audioWeight: Number.NaN })
    expect(body).not.toHaveProperty("prompt")
    expect(body).not.toHaveProperty("vocal_gender")
    expect(body.style_weight).toBe(0.33)
    expect(body).not.toHaveProperty("weirdness_constraint")
    expect(body).not.toHaveProperty("audio_weight")
  })

  it("the person's words are sent as they are, never cut (a cut would drop what the prompt policy added); only the title is cut, and a missing one is a placeholder", () => {
    const body = sunoAddVocalsInput({ uploadUrl: SONG, title: "", style: "s".repeat(1200), prompt: "p".repeat(6000), negativeTags: "n".repeat(300) })
    expect((body.prompt as string).length).toBe(6000)
    expect((body.style as string).length).toBe(1200)
    expect((body.negative_tags as string).length).toBe(300)
    expect(body.title).toBe(SUNO_ADD_TRACK_FALLBACK_TITLE)
    expect(sunoAddVocalsInput({ ...BARE, title: "t".repeat(100) }).title).toHaveLength(80)
  })

  it("sunoAddTrackTextProblem names the first text over the provider's limit (counted in characters, not bytes)", () => {
    expect(sunoAddTrackTextProblem({ prompt: "p".repeat(5000), style: "s".repeat(1000), negativeTags: "n".repeat(200) })).toBeNull()
    expect(sunoAddTrackTextProblem({ prompt: "p".repeat(5001) })).toMatch(/lyrics or direction.*5000/)
    expect(sunoAddTrackTextProblem({ style: "s".repeat(1001) })).toMatch(/style.*1000/)
    expect(sunoAddTrackTextProblem({ negativeTags: "n".repeat(201) })).toMatch(/keep out.*200/)
    expect(sunoAddTrackTextProblem({ prompt: "🎵".repeat(5000) })).toBeNull()
  })

  it("never sends a field KIE does not document for it", () => {
    const body = sunoAddVocalsInput({ ...BARE, prompt: "x", vocalGender: "female", styleWeight: 0.5, weirdnessConstraint: 0.5, audioWeight: 0.5, negativeTags: "n" })
    const documented = ["upload_url", "prompt", "lyrics", "model", "title", "negative_tags", "style", "vocal_gender", "style_weight", "weirdness_constraint", "audio_weight", "variety"]
    for (const key of Object.keys(body)) expect(documented).toContain(key)
  })
})

describe("the Add Instrumental body", () => {
  it("the style goes as tags; there is no prompt field", () => {
    const body = sunoAddInstrumentalInput({ ...BARE, prompt: "ignored", vocalGender: "male", audioWeight: 0.7 })
    expect(body).toEqual({ upload_url: SONG, model: "V6", title: "Fresh Step", negative_tags: "", tags: "soulful pop", vocal_gender: "m", audio_weight: 0.7 })
    const documented = ["upload_url", "model", "title", "negative_tags", "tags", "lyrics", "vocal_gender", "style_weight", "weirdness_constraint", "audio_weight", "variety"]
    for (const key of Object.keys(body)) expect(documented).toContain(key)
  })
})

describe("sunoVocalGenderCode", () => {
  it("maps the platform's spelling and KIE's own; anything else is none", () => {
    expect(sunoVocalGenderCode("female")).toBe("f")
    expect(sunoVocalGenderCode("m")).toBe("m")
    expect(sunoVocalGenderCode(undefined)).toBeUndefined()
    expect(sunoVocalGenderCode("x")).toBeUndefined()
  })
})

describe("the two runs on the market lane", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/jobs/createTask")) return new Response(JSON.stringify({ code: 200, data: { taskId: "t-add" } }), { status: 200 })
      if (url.includes("/jobs/recordInfo")) {
        return new Response(JSON.stringify({
          code: 200,
          data: { taskId: "t-add", state: "success", response: { data: [{ id: "trk-1", audio_url: "https://cdn.example/out.mp3", title: "Fresh Step", duration: 70 }] } },
        }), { status: 200 })
      }
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    const p = fn()
    p.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(600_000)
    return p
  }
  const sent = () => JSON.parse((fetchMock.mock.calls.find(([u]) => String(u).includes("createTask"))![1] as { body: string }).body)

  it("Add Vocals creates ai-music-api/add-vocals with the body, saves the task, and returns its tracks", async () => {
    const onTaskCreated = vi.fn()
    const result = await run(() => sunoAddVocals({ ...BARE, prompt: "la la", vocalGender: "female" }, { onTaskCreated, modelKey: "suno-add-vocals" }))
    expect(sent()).toEqual({ model: SUNO_ADD_VOCALS_MARKET_MODEL, input: sunoAddVocalsInput({ ...BARE, prompt: "la la", vocalGender: "female" }) })
    expect(onTaskCreated).toHaveBeenCalledWith("t-add")
    expect(result.tracks).toEqual([{ id: "trk-1", audioUrl: "https://cdn.example/out.mp3", title: "Fresh Step", duration: 70 }])
  })

  it("Add Instrumental creates ai-music-api/add-instrumental", async () => {
    await run(() => sunoAddInstrumental(BARE))
    expect(sent()).toEqual({ model: SUNO_ADD_INSTRUMENTAL_MARKET_MODEL, input: sunoAddInstrumentalInput(BARE) })
  })
})
