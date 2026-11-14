import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock("../../egress.js", () => ({ providerFetch: mocks.fetch }))
vi.mock("../client.js", () => ({
  ELEVENLABS_BASE_URL: "https://api.elevenlabs.io",
  getElevenLabsHeaders: () => ({ "xi-api-key": "secret" }),
}))
vi.mock("../../video/merge-video-audio.js", () => ({ mergeVideoAudio: vi.fn() }))
vi.mock("../../video/ffmpeg-utils.js", () => ({
  createWorkDir: vi.fn(), cleanupWorkDir: vi.fn(), downloadFile: vi.fn(), runFfmpeg: vi.fn(),
}))

import {
  addDubbingProjectLanguage,
  parseProjectTaskId,
  pollDubbingProject,
  projectTaskId,
  startDubbingProjectLanguage,
} from "../dubbing-project.js"

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const refused = (status: number, body: string) => ({ ok: false, status, json: async () => JSON.parse(body), text: async () => body })

beforeEach(() => {
  vi.clearAllMocks()
})

describe("a project dub's stored id", () => {
  it("names the project alone for a dub's first language", () => {
    expect(parseProjectTaskId("project:proj_1")).toEqual({ projectId: "proj_1" })
    expect(projectTaskId("proj_1")).toBe("project:proj_1")
  })

  it("names the language too for one added later", () => {
    expect(parseProjectTaskId("project:proj_1:lang_2")).toEqual({ projectId: "proj_1", languageId: "lang_2" })
    expect(projectTaskId("proj_1", "lang_2")).toBe("project:proj_1:lang_2")
  })

  it("reads back what it wrote", () => {
    for (const id of ["project:proj_1", "project:proj_1:lang_2"]) {
      const { projectId, languageId } = parseProjectTaskId(id)
      expect(projectTaskId(projectId, languageId)).toBe(id)
    }
  })
})

describe("reading a project dub", () => {
  const project = { status: "ready", language_ids: ["lang_first", "lang_added"], media: { duration_s: 61, has_video: false, mime_type: "audio/mpeg" } }

  it("reads the language named in the id, never the project's first one", async () => {
    mocks.fetch.mockImplementation(async (_meta, url: string) => ok(url.includes("/language/")
      ? { status: "completed", target_language: "es" }
      : project))

    const status = await pollDubbingProject("project:proj_1:lang_added")

    const urls = mocks.fetch.mock.calls.map((c) => c[1])
    expect(urls).toEqual([
      "https://api.elevenlabs.io/v1/dubbing/project/proj_1",
      "https://api.elevenlabs.io/v1/dubbing/project/proj_1/language/lang_added",
    ])
    expect(status).toMatchObject({ dubbing_id: "project:proj_1:lang_added", status: "dubbed", target_languages: ["es"] })
  })

  it("still reads the oldest language for an id that names none", async () => {
    mocks.fetch.mockImplementation(async (_meta, url: string) => ok(url.includes("/language/")
      ? { status: "processing", target_language: "he" }
      : project))

    const status = await pollDubbingProject("project:proj_1")

    expect(mocks.fetch.mock.calls[1][1]).toBe("https://api.elevenlabs.io/v1/dubbing/project/proj_1/language/lang_first")
    expect(status).toMatchObject({ status: "dubbing", target_languages: ["he"] })
  })

  it("reports a failed added language as failed", async () => {
    mocks.fetch.mockImplementation(async (_meta, url: string) => ok(url.includes("/language/")
      ? { status: "failed", target_language: "es", error: { message: "could not be dubbed" } }
      : project))

    await expect(pollDubbingProject("project:proj_1:lang_added")).resolves.toMatchObject({ status: "failed", error: "could not be dubbed" })
  })
})

describe("adding a language to a project dub", () => {
  it("asks the project for one more language and names it in the id it returns", async () => {
    mocks.fetch.mockResolvedValueOnce(ok({ language_id: "lang_new", project_id: "proj_1", target_language: "es", status: "queued" }))
    const onTaskCreated = vi.fn().mockResolvedValue(undefined)

    const result = await addDubbingProjectLanguage("project:proj_1", "es", { onTaskCreated, dimensions: { duration: 61 } })

    expect(result).toEqual({ dubbingId: "project:proj_1:lang_new", expectedDurationSec: 0 })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    const [meta, url, init] = mocks.fetch.mock.calls[0]
    expect(url).toBe("https://api.elevenlabs.io/v1/dubbing/project/proj_1/language")
    expect(init.method).toBe("POST")
    expect(init.headers).toEqual({ "xi-api-key": "secret", "content-type": "application/json" })
    expect(JSON.parse(init.body)).toEqual({ target_language: "es" })
    expect(meta).toEqual({
      provider: "elevenlabs",
      operation: "dubbing.start",
      modelKey: "elevenlabs-dubbing-v2", // gitleaks:allow — our public model id, not a credential
      body: { target_language: "es" },
      dimensions: { duration: 61 },
    })
    expect(onTaskCreated).toHaveBeenCalledWith("project:proj_1:lang_new")
  })

  it("adds to the project even when the id it is given names another language", async () => {
    mocks.fetch.mockResolvedValueOnce(ok({ language_id: "lang_new" }))

    const result = await addDubbingProjectLanguage("project:proj_1:lang_older", "fr")

    expect(mocks.fetch.mock.calls[0][1]).toBe("https://api.elevenlabs.io/v1/dubbing/project/proj_1/language")
    expect(result.dubbingId).toBe("project:proj_1:lang_new")
  })

  it("fails with the service's own words when the language is refused", async () => {
    mocks.fetch.mockResolvedValueOnce(refused(400, '{"detail":{"status":"invalid_parameters","message":"Invalid language tag."}}'))
    const onTaskCreated = vi.fn()

    await expect(addDubbingProjectLanguage("project:proj_1", "zz", { onTaskCreated }))
      .rejects.toThrow(/ElevenLabs Dubbing start failed \(400\): .*invalid_parameters/)
    expect(onTaskCreated).not.toHaveBeenCalled()
  })

  it("fails when the answer names no language", async () => {
    mocks.fetch.mockResolvedValueOnce(ok({ project_id: "proj_1" }))
    const onTaskCreated = vi.fn()

    await expect(addDubbingProjectLanguage("project:proj_1", "es", { onTaskCreated })).rejects.toThrow("omitted language_id")
    expect(onTaskCreated).not.toHaveBeenCalled()
  })
})

describe("starting a language the server filed for a project dub", () => {
  it("adds a new language to the project when none is held for it", async () => {
    mocks.fetch.mockResolvedValueOnce(ok({ language_id: "lang_new" }))
    const onTaskCreated = vi.fn().mockResolvedValue(undefined)

    const result = await startDubbingProjectLanguage("project:proj_1", "es", undefined, { onTaskCreated })

    expect(mocks.fetch.mock.calls[0][1]).toBe("https://api.elevenlabs.io/v1/dubbing/project/proj_1/language")
    expect(result).toEqual({ dubbingId: "project:proj_1:lang_new", expectedDurationSec: 0 })
    expect(onTaskCreated).toHaveBeenCalledWith("project:proj_1:lang_new")
  })

  it("delivers a language the project holds instead of making it again: nothing is asked of the service", async () => {
    const onTaskCreated = vi.fn().mockResolvedValue(undefined)

    const result = await startDubbingProjectLanguage("project:proj_1:lang_older", "es", "lang_held", { onTaskCreated })

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(result).toEqual({ dubbingId: "project:proj_1:lang_held", expectedDurationSec: 0 })
    expect(onTaskCreated).toHaveBeenCalledWith("project:proj_1:lang_held")
  })
})
