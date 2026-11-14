import { beforeEach, describe, expect, it, vi } from "vitest"

// What a dub is started with, field by field. A field the service accepts but
// this list does not name is one we deliberately do not send.

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock("../../egress.js", () => ({ providerFetch: mocks.fetch }))
vi.mock("../client.js", () => ({
  ELEVENLABS_BASE_URL: "https://api.elevenlabs.io",
  getElevenLabsHeaders: () => ({ "xi-api-key": "secret" }),
  fetchMediaFromUrl: vi.fn(async () => Buffer.from([1, 2, 3])),
}))
vi.mock("../../video/merge-video-audio.js", () => ({ mergeVideoAudio: vi.fn() }))
vi.mock("../../video/ffmpeg-utils.js", () => ({
  createWorkDir: vi.fn(), cleanupWorkDir: vi.fn(), downloadFile: vi.fn(), runFfmpeg: vi.fn(),
}))

import { startDubbing } from "../dubbing.js"

const everyOption = {
  sourceLang: "en",
  numSpeakers: 2,
  watermark: false,
  disableVoiceCloning: true,
  dropBackgroundAudio: true,
  startTime: 1,
  endTime: 30,
  highestResolution: true,
  useProfanityFilter: true,
  targetAccent: "british",
}

function sentFields(): string[] {
  const form = mocks.fetch.mock.calls[0][2].body as FormData
  return [...new Set(form.keys())].sort()
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("the fields a dub is started with", () => {
  it("a dub made in one request sends every option it was given, and nothing else", async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ dubbing_id: "dub_1", expected_duration_sec: 30 }) })

    await startDubbing({ url: "https://media.example/a.mp4", mime: "video/mp4", ext: "mp4" }, "es", everyOption)

    expect(mocks.fetch.mock.calls[0][1]).toBe("https://api.elevenlabs.io/v1/dubbing")
    expect(sentFields()).toEqual([
      "disable_voice_cloning",
      "drop_background_audio",
      "end_time",
      "file",
      "highest_resolution",
      "num_speakers",
      "source_lang",
      "start_time",
      "target_accent",
      "target_lang",
      "use_profanity_filter",
      "watermark",
    ])
  })

  it("a project dub sends its language, its engine and its source language", async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ project_id: "proj_1" }) })

    await startDubbing({ url: "https://media.example/a.mp4", mime: "video/mp4", ext: "mp4" }, "he", { sourceLang: "en" })

    expect(mocks.fetch.mock.calls[0][1]).toBe("https://api.elevenlabs.io/v1/dubbing/project")
    expect(sentFields()).toEqual(["file", "model_id", "source_language", "target_language"])
  })

  // A dub started in the service's editing mode cannot be read or delivered by
  // this workspace (its lines and its media both refuse), so no dub is.
  it("never starts a dub in the service's editing mode", async () => {
    mocks.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ dubbing_id: "dub_1", expected_duration_sec: 30, project_id: "proj_1" }) })

    await startDubbing({ url: "https://media.example/a.mp4" }, "es", everyOption)
    await startDubbing({ url: "https://media.example/a.mp4" }, "he", { sourceLang: "en" })

    for (const call of mocks.fetch.mock.calls) {
      expect([...(call[2].body as FormData).keys()]).not.toContain("dubbing_studio")
    }
  })
})
