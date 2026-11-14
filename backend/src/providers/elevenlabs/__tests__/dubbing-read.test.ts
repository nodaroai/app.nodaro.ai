import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), media: vi.fn() }))
vi.mock("../../egress.js", () => ({ providerFetch: mocks.fetch }))
vi.mock("../client.js", () => ({
  ELEVENLABS_BASE_URL: "https://api.elevenlabs.io",
  getElevenLabsHeaders: () => ({ "xi-api-key": "secret" }),
  fetchMediaFromUrl: mocks.media,
}))

import {
  DUBBING_CAPTIONS_MAX_BYTES,
  REGULAR_SOURCE_TRANSCRIPT,
  readProjectDub,
  readProjectLanguageLines,
  readProjectSource,
  readProjectSubtitles,
  readRegularCaptions,
  readRegularDub,
  readRegularTranscript,
} from "../dubbing-read.js"

const BASE = "https://api.elevenlabs.io/v1/dubbing/"
const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
})
const refused = (status: number, body: string) => ({ ok: false, status, json: async () => JSON.parse(body), text: async () => body })
const urls = (): string[] => mocks.fetch.mock.calls.map((call) => call[1] as string)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("what a refused read answers", () => {
  it("says the dub is gone when the service no longer holds it", async () => {
    mocks.fetch.mockResolvedValueOnce(refused(404, '{"detail":{"code":"dubbing_not_found","status":"dubbing_not_found"}}'))
    await expect(readRegularDub("dub_1")).resolves.toEqual({ kind: "gone" })
  })

  it("says it is still being made", async () => {
    mocks.fetch.mockResolvedValueOnce(refused(409, '{"detail":{"code":"conflict","status":"conflict"}}'))
    await expect(readProjectLanguageLines("project:proj_1", "lang_1")).resolves.toEqual({ kind: "processing" })
  })

  it("names the reason the service gave for a part it will not read out", async () => {
    mocks.fetch.mockResolvedValueOnce(refused(400, '{"detail":{"code":"feature_not_available","status":"dubbing_studio_not_supported"}}'))
    await expect(readRegularTranscript("dub_1", "es")).resolves.toEqual({ kind: "unsupported", code: "dubbing_studio_not_supported" })
  })

  it("falls back to the service's code, then to unknown", async () => {
    mocks.fetch.mockResolvedValueOnce(refused(422, '{"detail":{"code":"invalid_language_code"}}'))
    await expect(readRegularTranscript("dub_1", "zz")).resolves.toEqual({ kind: "unsupported", code: "invalid_language_code" })

    mocks.fetch.mockResolvedValueOnce(refused(400, "not json"))
    await expect(readRegularTranscript("dub_1", "zz")).resolves.toEqual({ kind: "unsupported", code: "unknown" })
  })

  it("throws on anything else, so an outage is never read as a missing dub", async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      mocks.fetch.mockResolvedValueOnce(refused(status, "{}"))
      await expect(readRegularDub("dub_1")).rejects.toThrow("ElevenLabs dubbing read failed (" + String(status) + ")")
    }
  })

  it("reads as a status check that takes no slot and is billed to no model", async () => {
    mocks.fetch.mockResolvedValueOnce(ok({ status: "dubbed" }))
    await readRegularDub("dub_1")

    const [meta, , init] = mocks.fetch.mock.calls[0]
    expect(meta).toEqual({ provider: "elevenlabs", operation: "dubbing.status", modelKey: null, body: undefined, dimensions: {} })
    expect(init).toEqual({ method: "GET", headers: { "xi-api-key": "secret" } })
  })
})

describe("a dub made in one request", () => {
  it("reads what it is", async () => {
    mocks.fetch.mockResolvedValueOnce(ok({
      dubbing_id: "dub_1",
      status: "dubbed",
      source_language: "en",
      target_languages: ["es", 7, ""],
      media_metadata: { content_type: "video/mp4", duration: 61.5 },
    }))

    await expect(readRegularDub("dub_1")).resolves.toEqual({
      kind: "ok",
      value: { status: "dubbed", sourceLanguage: "en", targetLanguages: ["es"], durationSec: 61.5 },
    })
    expect(urls()).toEqual([BASE + "dub_1"])
  })

  it("reads a dub the service says little about", async () => {
    mocks.fetch.mockResolvedValueOnce(ok({ media_metadata: null }))
    await expect(readRegularDub("dub_1")).resolves.toEqual({
      kind: "ok",
      value: { status: "unknown", sourceLanguage: null, targetLanguages: [], durationSec: null },
    })
  })

  it("reads the lines of one language", async () => {
    mocks.fetch.mockResolvedValueOnce(ok({
      language: "es",
      utterances: [
        { text: "Hola", speaker_id: "speaker_0", start_s: 0.08, end_s: 2.96, words: [] },
        { text: "", speaker_id: null, start_s: -1, end_s: "x" },
      ],
    }))

    await expect(readRegularTranscript("dub_1", "es")).resolves.toEqual({
      kind: "ok",
      value: {
        language: "es",
        lines: [
          { speakerId: "speaker_0", start: 0.08, end: 2.96, text: "Hola" },
          { speakerId: null, start: 0, end: 0, text: "" },
        ],
      },
    })
    expect(urls()).toEqual([BASE + "dub_1/transcript/es?format_type=json"])
  })

  it("reads the original speech under the service's own name for it", async () => {
    mocks.fetch.mockResolvedValueOnce(ok({ language: null, utterances: null }))
    await expect(readRegularTranscript("dub_1", REGULAR_SOURCE_TRANSCRIPT)).resolves.toEqual({
      kind: "ok",
      value: { language: null, lines: [] },
    })
    expect(urls()).toEqual([BASE + "dub_1/transcript/source?format_type=json"])
  })

  it("asks the service for a caption file in the format wanted", async () => {
    mocks.fetch.mockResolvedValue(ok("1\n00:00:00,080 --> 00:00:02,960\nHola\n"))

    await expect(readRegularCaptions("dub_1", "es", "srt")).resolves.toEqual({
      kind: "ok",
      value: "1\n00:00:00,080 --> 00:00:02,960\nHola\n",
    })
    await readRegularCaptions("dub_1", "es", "vtt")

    expect(urls()).toEqual([
      BASE + "dub_1/transcript/es?format_type=srt",
      BASE + "dub_1/transcript/es?format_type=webvtt",
    ])
  })

  it("never lets an id or a language reach past its place in the address", async () => {
    mocks.fetch.mockResolvedValueOnce(ok({ utterances: [] }))
    await readRegularTranscript("dub/../x", "es?format_type=srt")
    expect(urls()).toEqual([BASE + "dub%2F..%2Fx/transcript/es%3Fformat_type%3Dsrt?format_type=json"])
  })
})

describe("a project dub", () => {
  const project = {
    project_id: "proj_1",
    status: "ready",
    source_language: "en",
    language_ids: ["lang_he", "lang_es"],
    media: { duration_s: 61, has_video: true },
  }
  const language = (id: string, code: string, status = "completed") => ({ language_id: id, target_language: code, status })

  it("lists its languages oldest first, the one it was created with leading", async () => {
    mocks.fetch
      .mockResolvedValueOnce(ok(project))
      // The service lists newest first.
      .mockResolvedValueOnce(ok({ languages: [language("lang_es", "es", "processing"), language("lang_he", "he")], next_cursor: null }))

    await expect(readProjectDub("project:proj_1")).resolves.toEqual({
      kind: "ok",
      value: {
        status: "ready",
        sourceLanguage: "en",
        durationSec: 61,
        languages: [
          { id: "lang_he", code: "he", status: "completed" },
          { id: "lang_es", code: "es", status: "processing" },
        ],
      },
    })
    expect(urls()).toEqual([BASE + "project/proj_1", BASE + "project/proj_1/language?page_size=100"])
  })

  it("reads the same project whichever language the stored id names", async () => {
    mocks.fetch.mockResolvedValueOnce(ok(project)).mockResolvedValueOnce(ok({ languages: [] }))
    await readProjectDub("project:proj_1:lang_es")
    expect(urls()[0]).toBe(BASE + "project/proj_1")
  })

  it("puts a language the project does not name yet after the named ones, oldest first", async () => {
    mocks.fetch
      .mockResolvedValueOnce(ok({ ...project, language_ids: ["lang_he"] }))
      .mockResolvedValueOnce(ok({ languages: [language("lang_fr", "fr", "queued"), language("lang_es", "es", "queued"), language("lang_he", "he")] }))

    const read = await readProjectDub("project:proj_1")

    expect(read.kind === "ok" && read.value.languages.map((entry) => entry.id)).toEqual(["lang_he", "lang_es", "lang_fr"])
  })

  it("follows the list to its last page", async () => {
    mocks.fetch
      .mockResolvedValueOnce(ok({ ...project, language_ids: [] }))
      .mockResolvedValueOnce(ok({ languages: [language("lang_3", "fr")], next_cursor: "c 1" }))
      .mockResolvedValueOnce(ok({ languages: [language("lang_2", "es")], next_cursor: "c2" }))
      .mockResolvedValueOnce(ok({ languages: [language("lang_1", "he")], next_cursor: null }))

    const read = await readProjectDub("project:proj_1")

    expect(read.kind === "ok" && read.value.languages.map((entry) => entry.id)).toEqual(["lang_1", "lang_2", "lang_3"])
    expect(urls().slice(1)).toEqual([
      BASE + "project/proj_1/language?page_size=100",
      BASE + "project/proj_1/language?page_size=100&cursor=c%201",
      BASE + "project/proj_1/language?page_size=100&cursor=c2",
    ])
  })

  it("stops following a list that never ends", async () => {
    mocks.fetch.mockResolvedValueOnce(ok({ ...project, language_ids: [] }))
    mocks.fetch.mockResolvedValue(ok({ languages: [], next_cursor: "again" }))

    await readProjectDub("project:proj_1")

    expect(mocks.fetch).toHaveBeenCalledTimes(1 + 5)
  })

  it("leaves out a language it cannot name", async () => {
    mocks.fetch
      .mockResolvedValueOnce(ok({ ...project, language_ids: [] }))
      .mockResolvedValueOnce(ok({ languages: [{ language_id: "lang_x" }, { target_language: "es" }, language("lang_he", "he")] }))

    const read = await readProjectDub("project:proj_1")

    expect(read.kind === "ok" && read.value.languages).toEqual([{ id: "lang_he", code: "he", status: "completed" }])
  })

  it("is gone when the project is, and when its list is", async () => {
    mocks.fetch.mockResolvedValueOnce(refused(404, "{}"))
    await expect(readProjectDub("project:proj_1")).resolves.toEqual({ kind: "gone" })

    mocks.fetch.mockResolvedValueOnce(ok(project)).mockResolvedValueOnce(refused(404, "{}"))
    await expect(readProjectDub("project:proj_1")).resolves.toEqual({ kind: "gone" })
  })

  it("reads the original speech line by line, each with its id", async () => {
    mocks.fetch.mockResolvedValueOnce(ok({
      language: "en",
      revision: 3,
      segments: [
        { id: "seg_1", text: "Hello", speaker_id: "speaker_0", start_s: 0.08, end_s: 2.96, external_id: null },
        { text: "a line with no id" },
      ],
    }))

    await expect(readProjectSource("project:proj_1:lang_es")).resolves.toEqual({
      kind: "ok",
      value: { language: "en", lines: [{ id: "seg_1", speakerId: "speaker_0", start: 0.08, end: 2.96, text: "Hello" }] },
    })
    expect(urls()).toEqual([BASE + "project/proj_1/transcript"])
  })

  it("reads one language beside the original lines it translates", async () => {
    mocks.fetch.mockResolvedValueOnce(ok({
      source_language: "en",
      target_language: "es",
      segments: [
        { id: "seg_1", speaker_id: "speaker_0", start_s: 0.08, end_s: 2.96, source_text: "Hello", translation: "Hola" },
        { id: "seg_2", speaker_id: "speaker_1", start_s: 3, end_s: 4, source_text: "Bye", translation: null },
      ],
    }))

    await expect(readProjectLanguageLines("project:proj_1", "lang_es")).resolves.toEqual({
      kind: "ok",
      value: [
        { id: "seg_1", speakerId: "speaker_0", start: 0.08, end: 2.96, text: "Hola", sourceText: "Hello" },
        { id: "seg_2", speakerId: "speaker_1", start: 3, end: 4, text: "", sourceText: "Bye" },
      ],
    })
    expect(urls()).toEqual([BASE + "project/proj_1/language/lang_es/transcript"])
  })
})

describe("the caption file of a project dub's language", () => {
  const signed = "https://files.example/subtitles.vtt?signature=abc"

  it("is read from the link the service hands out, which never leaves this module", async () => {
    mocks.fetch.mockResolvedValueOnce(ok({ language_id: "lang_es", status: "completed", outputs: { subtitles: signed } }))
    mocks.media.mockResolvedValueOnce(Buffer.from("WEBVTT\n\n00:00:00.080 --> 00:00:02.960\nHola\n", "utf8"))

    const read = await readProjectSubtitles("project:proj_1", "lang_es")

    expect(read).toEqual({ kind: "ok", value: "WEBVTT\n\n00:00:00.080 --> 00:00:02.960\nHola\n" })
    expect(urls()).toEqual([BASE + "project/proj_1/language/lang_es"])
    expect(mocks.media).toHaveBeenCalledWith(signed, DUBBING_CAPTIONS_MAX_BYTES)
    expect(JSON.stringify(read)).not.toContain("signature")
  })

  it("is not there yet while the language is being made", async () => {
    for (const status of ["queued", "processing"]) {
      mocks.fetch.mockResolvedValueOnce(ok({ status, outputs: null }))
      await expect(readProjectSubtitles("project:proj_1", "lang_es")).resolves.toEqual({ kind: "processing" })
    }
    expect(mocks.media).not.toHaveBeenCalled()
  })

  it("is not offered when the service wrote none", async () => {
    mocks.fetch.mockResolvedValueOnce(ok({ status: "failed", outputs: null }))
    await expect(readProjectSubtitles("project:proj_1", "lang_es")).resolves.toEqual({ kind: "unsupported", code: "no_subtitles" })

    mocks.fetch.mockResolvedValueOnce(ok({ status: "completed", outputs: { lossless_audio: "https://files.example/a.flac" } }))
    await expect(readProjectSubtitles("project:proj_1", "lang_es")).resolves.toEqual({ kind: "unsupported", code: "no_subtitles" })
    expect(mocks.media).not.toHaveBeenCalled()
  })

  it("is gone with its language", async () => {
    mocks.fetch.mockResolvedValueOnce(refused(404, '{"detail":{"status":"dubbing_not_found"}}'))
    await expect(readProjectSubtitles("project:proj_1", "lang_gone")).resolves.toEqual({ kind: "gone" })
  })
})
