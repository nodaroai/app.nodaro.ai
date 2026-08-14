import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The generic path exists because the instance and the cloud run the same
 * code: a worker's `job.data` IS the validated route body. These tests pin the
 * two things that makes true — the route map matches reality, and the
 * instance-only bookkeeping fields never travel (they identify rows in THIS
 * database and would be meaningless, or misleading, on the cloud).
 */
const createCloudJob = vi.fn()
const waitForCloudJob = vi.fn()
const ensureCloudReachableMediaUrl = vi.fn(async (u: string) => u)
vi.mock("../client.js", () => ({
  createCloudJob: (...a: unknown[]) => createCloudJob(...a),
  waitForCloudJob: (...a: unknown[]) => waitForCloudJob(...a),
  ensureCloudReachableMediaUrl: (u: string) => ensureCloudReachableMediaUrl(u),
  NodaroCloudError: class NodaroCloudError extends Error {},
}))

const { runJobOnCloud, canRunOnCloud, cloudRouteForJobType } = await import("../run-on-cloud.js")

describe("runJobOnCloud", () => {
  beforeEach(() => {
    createCloudJob.mockReset().mockResolvedValue("cloud-job-1")
    waitForCloudJob.mockReset().mockResolvedValue({ output_data: { audioUrl: "https://c/a.mp3" } })
  })

  it("posts the payload to the job type's own cloud route", async () => {
    await runJobOnCloud("suno-generate", { prompt: "a song", model: "V5" })
    expect(createCloudJob).toHaveBeenCalledWith("/v1/suno/generate", {
      prompt: "a song",
      model: "V5",
    })
  })

  it("strips instance-only bookkeeping — those ids mean nothing on the cloud", async () => {
    await runJobOnCloud("suno-cover", {
      prompt: "x",
      jobId: "local-uuid",
      usageLogId: "local-usage",
      userId: "local-user",
      workflowExecutionId: "local-exec",
    })
    expect(createCloudJob).toHaveBeenCalledWith("/v1/suno/cover", { prompt: "x" })
  })

  it("drops undefined values rather than sending nulls the cloud's Zod would reject", async () => {
    await runJobOnCloud("suno-extend", { prompt: "x", style: undefined })
    expect(createCloudJob).toHaveBeenCalledWith("/v1/suno/extend", { prompt: "x" })
  })

  it("returns the finished job's output verbatim — finalizing stays with the caller", async () => {
    waitForCloudJob.mockResolvedValue({ output_data: { audioUrl: "https://c/a.mp3", trackCount: 2 } })
    await expect(runJobOnCloud("suno-generate", {})).resolves.toEqual({
      audioUrl: "https://c/a.mp3",
      trackCount: 2,
    })
  })

  it("refuses a job type that isn't mapped instead of guessing a route", async () => {
    await expect(runJobOnCloud("generate-image", {})).rejects.toThrow(/cannot run on the connection/)
    expect(createCloudJob).not.toHaveBeenCalled()
  })

  it("fails loudly when the cloud job finishes with no output", async () => {
    waitForCloudJob.mockResolvedValue({ output_data: null })
    await expect(runJobOnCloud("suno-generate", {})).rejects.toThrow(/no output/)
  })

  it("canRunOnCloud agrees with the map", () => {
    expect(canRunOnCloud("suno-generate")).toBe(true)
    expect(canRunOnCloud("generate-image")).toBe(false)
    expect(cloudRouteForJobType("suno-cover")).toBe("/v1/suno/cover")
    // Unwired operations must NOT be claimed — see the note in the map.
    expect(canRunOnCloud("suno-lyrics")).toBe(false)
    expect(canRunOnCloud("suno-convert-wav")).toBe(false)
  })
})

describe("the route map matches the routes the cloud actually serves", () => {
  it("every mapped path exists in routes/suno.ts", async () => {
    const { readFileSync } = await import("node:fs")
    const { fileURLToPath } = await import("node:url")
    const { dirname, resolve } = await import("node:path")
    const routes = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../routes/suno.ts"),
      "utf8",
    )
    // A typo'd path would only surface as a 404 mid-generation on a user's
    // machine — cheap to catch here instead, since the cloud runs this file.
    // Only the operations a handler actually routes. lyrics / separate /
    // music-video / convert-wav return text, stems, a video and a wav
    // respectively — each needs its own result adapter, and mapping them before
    // wiring them would advertise a path nothing takes.
    for (const jobType of [
      "suno-generate", "suno-cover", "suno-extend", "suno-mashup",
      "suno-replace-section", "suno-add-instrumental", "suno-add-vocals",
      "suno-upload-extend",
    ]) {
      const path = cloudRouteForJobType(jobType)
      expect(path, `${jobType} must be mapped`).toBeTruthy()
      expect(routes, `${jobType} -> ${path} is not a real route`).toContain(`"${path}"`)
    }
  })
})

describe("nothing about OUR billing state travels to the cloud", () => {
  beforeEach(() => {
    createCloudJob.mockReset().mockResolvedValue("cloud-job-1")
    waitForCloudJob.mockReset().mockResolvedValue({ output_data: { audioUrl: "https://c/a.mp3" } })
  })

  it("strips watermark/tier/credit hints — those are the cloud account's own decisions", async () => {
    await runJobOnCloud("suno-generate", {
      prompt: "x",
      shouldWatermark: false,
      should_watermark: false,
      tier: "business",
      creditsReserved: 999,
    })
    expect(createCloudJob).toHaveBeenCalledWith("/v1/suno/generate", { prompt: "x" })
  })
})

describe("the map and the handlers stay in step", () => {
  it("every mapped Suno job type is actually routed by a handler", async () => {
    const { readFileSync } = await import("node:fs")
    const { fileURLToPath } = await import("node:url")
    const { dirname, resolve } = await import("node:path")
    const handlers = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../workers/handlers/suno.ts"),
      "utf8",
    )
    // The two halves fail differently and both silently: a mapped type with no
    // handler advertises a path nothing takes, and a wired handler with no map
    // entry throws "cannot run on the connection" at generation time.
    for (const jobType of [
      "suno-generate", "suno-cover", "suno-extend", "suno-mashup",
      "suno-replace-section", "suno-add-instrumental", "suno-add-vocals",
      "suno-upload-extend",
    ]) {
      expect(cloudRouteForJobType(jobType), `${jobType} must be mapped`).toBeTruthy()
      expect(handlers, `${jobType} is mapped but no handler routes it`).toContain(
        `maybeRunSunoOnCloud(job, ctx, "${jobType}"`,
      )
    }
    // ...and the reverse: nothing wired is missing from the map.
    for (const m of handlers.matchAll(/maybeRunSunoOnCloud\(job, ctx, "([^"]+)"/g)) {
      expect(cloudRouteForJobType(m[1]), `${m[1]} is wired but not mapped`).toBeTruthy()
    }
  })
})


describe("media in a replayed payload gets re-hosted", () => {
  beforeEach(() => {
    createCloudJob.mockReset().mockResolvedValue("cloud-job-1")
    waitForCloudJob.mockReset().mockResolvedValue({ output_data: { audioUrl: "https://c/a.mp3" } })
    ensureCloudReachableMediaUrl.mockReset().mockImplementation(async (u: string) =>
      u.includes("localhost") ? u.replace("http://localhost:3000/storage", "https://cloud/up") : u,
    )
  })

  it("rewrites URL-shaped fields that point at this instance", async () => {
    // Without this the cloud received http://localhost:3000/... and refused it
    // on its private-host guard — the same wall image-to-video hit.
    await runJobOnCloud("suno-cover", {
      prompt: "x",
      uploadUrl: "http://localhost:3000/storage/audio/a.mp3",
    })
    expect(createCloudJob).toHaveBeenCalledWith("/v1/suno/cover", {
      prompt: "x",
      uploadUrl: "https://cloud/up/audio/a.mp3",
    })
  })

  it("handles list-shaped url fields too", async () => {
    await runJobOnCloud("suno-mashup", {
      uploadUrlList: [
        "http://localhost:3000/storage/audio/a.mp3",
        "https://public.example/b.mp3",
      ],
    })
    expect(createCloudJob).toHaveBeenCalledWith("/v1/suno/mashup", {
      uploadUrlList: ["https://cloud/up/audio/a.mp3", "https://public.example/b.mp3"],
    })
  })

  it("leaves non-URL fields alone — a prompt containing a link must not be rewritten", async () => {
    await runJobOnCloud("suno-generate", {
      prompt: "a song about http://localhost:3000/storage/x.mp3",
      model: "V5",
    })
    expect(ensureCloudReachableMediaUrl).not.toHaveBeenCalled()
    expect(createCloudJob).toHaveBeenCalledWith("/v1/suno/generate", {
      prompt: "a song about http://localhost:3000/storage/x.mp3",
      model: "V5",
    })
  })
})


describe("payload adapters — for job types whose enqueued shape isn't the route body", () => {
  beforeEach(() => {
    createCloudJob.mockReset().mockResolvedValue("cloud-job-1")
    waitForCloudJob.mockReset().mockResolvedValue({ output_data: { script: { title: "t", scenes: [] } } })
    ensureCloudReachableMediaUrl.mockReset().mockImplementation(async (u: string) => u)
  })

  it("flattens generate-script's nested `advanced` back to the flat route body", async () => {
    // The enqueue nests advancedMode/temperature/maxTokens under `advanced` so
    // the worker can carry them. Sending that verbatim would drop exactly the
    // settings a user deliberately changed — silently, since an unknown key is
    // simply ignored by the cloud's Zod.
    await runJobOnCloud("generate-script", {
      prompt: "a short film",
      sceneCount: 3,
      advanced: { advancedMode: true, temperature: 0.9, maxTokens: 4000 },
    })
    expect(createCloudJob).toHaveBeenCalledWith("/v1/generate-script", {
      prompt: "a short film",
      sceneCount: 3,
      advancedMode: true,
      temperature: 0.9,
      maxTokens: 4000,
    })
  })

  it("leaves the payload alone when the job type has no adapter", async () => {
    await runJobOnCloud("suno-generate", { prompt: "x", model: "V5" })
    expect(createCloudJob).toHaveBeenCalledWith("/v1/suno/generate", { prompt: "x", model: "V5" })
  })

  it("tolerates a missing or malformed advanced block instead of throwing mid-job", async () => {
    await runJobOnCloud("generate-script", { prompt: "x" })
    expect(createCloudJob).toHaveBeenCalledWith("/v1/generate-script", { prompt: "x" })
    createCloudJob.mockClear()
    await runJobOnCloud("generate-script", { prompt: "y", advanced: "nonsense" })
    expect(createCloudJob).toHaveBeenCalledWith("/v1/generate-script", { prompt: "y" })
  })
})
