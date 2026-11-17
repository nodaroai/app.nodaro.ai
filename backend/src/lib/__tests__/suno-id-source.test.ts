/**
 * Suno tracks named by their ids (lib/suno-id-source.ts, decided 2026-11-17):
 * whose task a caller may name, and what Suno Cover and Suno Convert to WAV do
 * with it — before any row or hold, on the routes and the workflow run alike.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const m = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  taskFilter: undefined as unknown,
  /** The last track-id lookup (`contains` on output_data) and the rows it answers. */
  contained: undefined as unknown,
  speechTakeRows: [] as Array<Record<string, unknown>>,
  failLookups: false,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => {
      let byTrack = false
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => {
          if (col === "provider_task_id") m.taskFilter = v
          return q
        },
        gte: () => q,
        contains: (_col: string, v: unknown) => {
          byTrack = true
          m.contained = v
          return q
        },
        limit: async () => m.failLookups
          ? { data: null, error: { message: "connection reset" } }
          : { data: byTrack ? m.speechTakeRows : m.rows.filter((r) => r.provider_task_id === m.taskFilter), error: null },
      }
      return q
    },
  },
}))

import {
  SUNO_COVERABLE_BY_ID_JOB_TYPES,
  SUNO_COVER_BY_ID_MAX_AGE_MS,
  SUNO_COVER_BY_ID_WHEN_FILE_PRESENT,
  resolveSunoCoverSource,
  resolveSunoWavSource,
  stampSunoIdSource,
  sunoSpeechTakeRefusal,
} from "../suno-id-source.js"

const ME = "user-me"
const OTHER = "user-other"
const NOW = Date.parse("2026-11-17T12:00:00.000Z")
const FILE = "https://cdn/x.mp3"
const row = (task: string, userId: string, jobType: string, output: Record<string, unknown> = {}, createdAt = "2026-11-16T12:00:00.000Z") =>
  ({ provider_task_id: task, user_id: userId, job_type: jobType, status: "completed", created_at: createdAt, output_data: output })
const SPEECH = { sunoTrackKind: "speech", sunoTaskId: "sp", sunoTracks: [{ id: "take-1" }] }

beforeEach(() => {
  m.rows = []
  m.taskFilter = undefined
  m.contained = undefined
  m.speechTakeRows = []
  m.failLookups = false
})

const SONG = { sunoTaskId: "t1", sunoTrackId: "a1", audioUrl: FILE, sunoTracks: [{ id: "a1", audioUrl: FILE }, { id: "a2", audioUrl: "https://cdn/x-2.mp3" }] }

describe("Suno Cover — the gate: by id only when the request carries no file (decided 2026-11-17)", () => {
  it("a request with a file covers the file exactly as before, with no lookup at all — a wired Suno song included", async () => {
    m.rows = [row("t1", ME, "suno-generate", SONG)]
    expect(SUNO_COVER_BY_ID_WHEN_FILE_PRESENT).toBe(false)
    expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a1", uploadUrl: FILE, userId: ME, now: NOW })).toStrictEqual({ ok: true, byId: false, uploadUrl: FILE })
    expect(m.taskFilter).toBeUndefined()
    expect(await stampSunoIdSource("suno-cover", { taskId: "t1", audioId: "a1", uploadUrl: FILE, prompt: "jazz" }, ME)).toStrictEqual({ ok: true, patch: { taskId: undefined, audioId: undefined, uploadUrl: FILE } })
  })

  it("ids alone, of my own finished song, go by id", async () => {
    for (const jobType of SUNO_COVERABLE_BY_ID_JOB_TYPES) {
      m.rows = [row("t1", ME, jobType, SONG)]
      expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a1", userId: ME, now: NOW })).toStrictEqual({ ok: true, byId: true, taskId: "t1", audioId: "a1" })
    }
    expect(await stampSunoIdSource("suno-cover", { taskId: "t1", audioId: "a2", prompt: "jazz" }, ME)).toStrictEqual({ ok: true, patch: { taskId: "t1", audioId: "a2", uploadUrl: undefined } })
  })

  it("with the gate lifted, ids beside their own file go by id with the file kept as the fallback", async () => {
    m.rows = [row("t1", ME, "suno-generate", SONG)]
    expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a1", uploadUrl: FILE, userId: ME, now: NOW, byIdWhenFilePresent: true })).toStrictEqual({ ok: true, byId: true, taskId: "t1", audioId: "a1", uploadUrl: FILE })
  })
})

describe("Suno Cover — by id only for the caller's own finished song, else by its audio", () => {
  // The gate open, so the file-beside-ids rules are exercised as they will run when it is lifted.
  const open = { byIdWhenFilePresent: true, now: NOW, userId: ME }

  it("a task no job here carries is never covered by id: its audio as before, and refused with none", async () => {
    expect(await resolveSunoCoverSource({ taskId: "unknown", audioId: "a1", uploadUrl: FILE, ...open })).toStrictEqual({ ok: true, byId: false, uploadUrl: FILE })
    expect(await resolveSunoCoverSource({ taskId: "unknown", audioId: "a1", userId: ME })).toMatchObject({ ok: false, status: 400, code: "suno_cover_source" })
  })

  it("refuses another account's task given alone; covers its audio when the request carries it", async () => {
    m.rows = [row("t1", OTHER, "suno-generate", SONG)]
    expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a1", userId: ME })).toMatchObject({ ok: false, status: 403, code: "suno_task_not_yours" })
    expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a1", uploadUrl: FILE, ...open })).toStrictEqual({ ok: true, byId: false, uploadUrl: FILE })
  })

  it("a task that is not a song (a WAV, a separation, a speech run) goes by its audio, or is refused with none", async () => {
    for (const jobType of ["suno-convert-wav", "suno-separate", "suno-speech", "suno-lyrics"]) {
      m.rows = [row("t1", ME, jobType, SONG)]
      expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a1", uploadUrl: FILE, ...open })).toStrictEqual({ ok: true, byId: false, uploadUrl: FILE })
      expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a1", userId: ME })).toMatchObject({ ok: false, status: 400, code: "suno_cover_source" })
    }
  })

  it("the song must be finished and the audio id one of the tracks it saved, before any hold", async () => {
    m.rows = [{ ...row("t1", ME, "suno-generate", SONG), status: "processing" }]
    expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a1", userId: ME, now: NOW })).toMatchObject({ ok: false, status: 400, code: "suno_cover_source" })
    m.rows = [row("t1", ME, "suno-generate", SONG)]
    expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "not-a-track", userId: ME, now: NOW })).toMatchObject({ ok: false, status: 400, code: "suno_cover_source" })
    expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "not-a-track", uploadUrl: FILE, ...open })).toStrictEqual({ ok: true, byId: false, uploadUrl: FILE })
    // The second take is a track of the job too; an older job that saved only its first track is read by that.
    expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a2", userId: ME, now: NOW })).toMatchObject({ ok: true, byId: true, audioId: "a2" })
    m.rows = [row("t1", ME, "suno-generate", { sunoTaskId: "t1", sunoTrackId: "a1", audioUrl: FILE })]
    expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a1", userId: ME, now: NOW })).toMatchObject({ ok: true, byId: true })
  })

  it("ids and a file that are not the same audio (a link and a Suno track on different wires): the ids are dropped, the file is covered", async () => {
    m.rows = [row("t1", ME, "suno-generate", SONG)]
    expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a1", uploadUrl: "https://www.youtube.com/watch?v=abc", ...open })).toStrictEqual({ ok: true, byId: false, uploadUrl: "https://www.youtube.com/watch?v=abc" })
    // The second take's ids beside the first take's file are not the same audio either.
    expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a2", uploadUrl: FILE, ...open })).toStrictEqual({ ok: true, byId: false, uploadUrl: FILE })
  })

  it("my own song older than 13 days goes by its file when there is one; with none, still by id", async () => {
    const old = new Date(NOW - SUNO_COVER_BY_ID_MAX_AGE_MS - 60_000).toISOString()
    const fresh = new Date(NOW - SUNO_COVER_BY_ID_MAX_AGE_MS + 60_000).toISOString()
    m.rows = [row("t1", ME, "suno-generate", SONG, old)]
    expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a1", uploadUrl: FILE, ...open })).toStrictEqual({ ok: true, byId: false, uploadUrl: FILE })
    expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a1", userId: ME, now: NOW })).toMatchObject({ ok: true, byId: true })
    m.rows = [row("t1", ME, "suno-generate", SONG, fresh)]
    expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a1", uploadUrl: FILE, ...open })).toMatchObject({ ok: true, byId: true, uploadUrl: FILE })
  })

  it("fields a cover by id cannot say go by the file, never cut; with no file they are refused", async () => {
    m.rows = [row("t1", ME, "suno-generate", SONG)]
    for (const fields of [{ prompt: "jazz", style: "folk" }, { prompt: "j".repeat(1001) }, { customMode: true, prompt: "make it jazz", lyrics: "real words" }]) {
      expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a1", uploadUrl: FILE, ...open, fields })).toStrictEqual({ ok: true, byId: false, uploadUrl: FILE })
      expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a1", userId: ME, now: NOW, fields })).toMatchObject({ ok: false, status: 400, code: "suno_cover_source" })
    }
    expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a1", userId: ME, now: NOW, fields: { prompt: "jazz" } })).toMatchObject({ ok: true, byId: true })
  })

  it("no ids: the audio, as before (no lookup)", async () => {
    expect(await resolveSunoCoverSource({ uploadUrl: FILE, userId: ME })).toStrictEqual({ ok: true, byId: false, uploadUrl: FILE })
    expect(m.taskFilter).toBeUndefined()
    expect(await resolveSunoCoverSource({ taskId: "t1", userId: ME })).toBeUndefined()
  })

  it("the workflow stamp: a job that is not a cover gets no patch", async () => {
    expect(await stampSunoIdSource("generate-image", { taskId: "t1" }, ME)).toStrictEqual({ ok: true, patch: {} })
  })
})

describe("Suno Convert to WAV — a track or a stem, whoever made it", () => {
  it("a generation (or a task no job carries) is a track, as before", async () => {
    m.rows = [row("t1", ME, "suno-generate")]
    expect(await resolveSunoWavSource({ taskId: "t1", audioId: "a1", userId: ME })).toStrictEqual({ ok: true, stem: false })
    expect(await resolveSunoWavSource({ taskId: "nobody", audioId: "a1", userId: ME })).toStrictEqual({ ok: true, stem: false })
  })

  it("another account's track or stem is converted as before: no ownership check", async () => {
    m.rows = [row("gen", OTHER, "suno-generate")]
    expect(await resolveSunoWavSource({ taskId: "gen", audioId: "a", userId: ME })).toStrictEqual({ ok: true, stem: false })
    m.rows = [row("sep", OTHER, "suno-separate", { engineUsed: "suno", sunoStemIds: { vocalUrl: "s-v" } })]
    expect(await resolveSunoWavSource({ taskId: "sep", audioId: "s-v", userId: ME })).toStrictEqual({ ok: true, stem: true })
    expect(await stampSunoIdSource("suno-convert-wav", { taskId: "sep", audioId: "s-v" }, ME)).toStrictEqual({ ok: true, patch: { stem: true } })
  })

  it("a stem of my Suno separation takes the stem lane", async () => {
    m.rows = [row("sep", ME, "suno-separate", { engineUsed: "suno", sunoTaskId: "sep", sunoStemIds: { vocalUrl: "s-v", instrumentalUrl: "s-i" } })]
    expect(await resolveSunoWavSource({ taskId: "sep", audioId: "s-i", userId: ME })).toStrictEqual({ ok: true, stem: true })
    expect(await stampSunoIdSource("suno-convert-wav", { taskId: "sep", audioId: "s-v" }, ME)).toStrictEqual({ ok: true, patch: { stem: true } })
  })

  it("refuses a Demucs separation and an id that is not one of the stems, whoever made the separation", async () => {
    for (const owner of [ME, OTHER]) {
      m.rows = [row("sep", owner, "suno-separate", { engineUsed: "demucs" })]
      expect(await resolveSunoWavSource({ taskId: "sep", audioId: "s-v", userId: ME })).toMatchObject({ ok: false, status: 400, code: "suno_wav_stem" })
      m.rows = [row("sep", owner, "suno-separate", { engineUsed: "suno", sunoStemIds: { vocalUrl: "s-v" } })]
      expect(await resolveSunoWavSource({ taskId: "sep", audioId: "nope", userId: ME })).toMatchObject({ ok: false, status: 400, code: "suno_wav_stem" })
      // A separation that kept no stem ids (made before they were kept): "run the separation again", before any hold.
      m.rows = [row("sep", owner, "suno-separate", { engineUsed: "suno", vocalUrl: "https://cdn/v.mp3" })]
      const idless = await resolveSunoWavSource({ taskId: "sep", audioId: "s-v", userId: ME })
      expect(idless).toMatchObject({ ok: false, status: 400, code: "suno_wav_stem" })
      expect((idless as { message: string }).message).toMatch(/Run the separation again/)
    }
    expect(await stampSunoIdSource("suno-convert-wav", { taskId: "sep", audioId: "nope" }, ME)).toMatchObject({ ok: false, refusal: { code: "suno_wav_stem" } })
  })
})

describe("a Suno Speech take is not a song — refused by its ids before any hold", () => {
  it("Convert to WAV and Separate refuse a speech task, whoever made it", async () => {
    m.rows = [row("sp", OTHER, "suno-speech", SPEECH)]
    expect(await resolveSunoWavSource({ taskId: "sp", audioId: "take-1", userId: ME })).toMatchObject({ ok: false, status: 400, code: "suno_not_a_track" })
    expect(await sunoSpeechTakeRefusal({ taskId: "sp", userId: ME })).toMatchObject({ ok: false, status: 400, code: "suno_not_a_track" })
    m.rows = [row("sp", ME, "suno-speech", SPEECH)]
    expect(await resolveSunoWavSource({ taskId: "sp", audioId: "take-1", userId: ME })).toMatchObject({ ok: false, status: 400, code: "suno_not_a_track" })
    expect(await sunoSpeechTakeRefusal({ taskId: "sp", userId: ME })).toMatchObject({ ok: false, status: 400, code: "suno_not_a_track" })
    expect(await stampSunoIdSource("suno-convert-wav", { taskId: "sp", audioId: "take-1" }, ME)).toMatchObject({ ok: false, refusal: { code: "suno_not_a_track" } })
    expect(await stampSunoIdSource("suno-separate", { taskId: "sp", audioId: "take-1" }, ME)).toMatchObject({ ok: false, refusal: { code: "suno_not_a_track" } })
  })

  it("Extend, which names only the take's id, finds it among my recent speech runs", async () => {
    m.speechTakeRows = [{ id: "job-speech" }]
    expect(await sunoSpeechTakeRefusal({ audioId: "take-1", userId: ME })).toMatchObject({ ok: false, code: "suno_not_a_track" })
    expect(m.contained).toStrictEqual({ sunoTrackKind: "speech", sunoTracks: [{ id: "take-1" }] })
    expect(await stampSunoIdSource("suno-extend", { audioId: "take-1" }, ME)).toMatchObject({ ok: false, refusal: { code: "suno_not_a_track" } })
  })

  it("a lookup that fails never fails a run that needed none before: the tools run as they did, a cover covers its file", async () => {
    m.failLookups = true
    expect(await resolveSunoWavSource({ taskId: "t1", audioId: "a1", userId: ME })).toStrictEqual({ ok: true, stem: false })
    expect(await sunoSpeechTakeRefusal({ taskId: "sp", userId: ME })).toBeUndefined()
    expect(await sunoSpeechTakeRefusal({ audioId: "take-1", userId: ME })).toBeUndefined()
    expect(await resolveSunoCoverSource({ taskId: "t1", audioId: "a1", uploadUrl: FILE, userId: ME, byIdWhenFilePresent: true })).toStrictEqual({ ok: true, byId: false, uploadUrl: FILE })
    await expect(resolveSunoCoverSource({ taskId: "t1", audioId: "a1", userId: ME })).rejects.toThrow(/lookup failed/)
  })

  it("a song's ids and no ids at all run as before", async () => {
    m.rows = [row("gen", ME, "suno-generate", { sunoTaskId: "gen" })]
    expect(await sunoSpeechTakeRefusal({ taskId: "gen", userId: ME })).toBeUndefined()
    expect(await sunoSpeechTakeRefusal({ audioId: "track-9", userId: ME })).toBeUndefined()
    expect(await sunoSpeechTakeRefusal({ userId: ME })).toBeUndefined()
    expect(await stampSunoIdSource("suno-extend", { audioId: "track-9" }, ME)).toStrictEqual({ ok: true, patch: {} })
    expect(await stampSunoIdSource("suno-separate", { audioUrl: "https://cdn/x.mp3" }, ME)).toStrictEqual({ ok: true, patch: {} })
  })
})
