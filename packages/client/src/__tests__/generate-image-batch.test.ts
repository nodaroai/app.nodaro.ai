import { describe, it, expect, vi, afterEach } from "vitest"
import { createClient, StaticTokenAuth, NodaroError, JobFailedError, JobAbortedError } from "../index.js"
// WIRE-01: every type in a public method signature is re-exported from @nodaro/sdk.
import type {
  GenerateImageParams,
  GenerateImageBatchResult,
  GenerateImageBatchOutput,
  BatchJobOutcome,
  GenerationSessionParams,
  VideoUpscaleParams,
  VideoDepthParams,
  AssembleNarratedVideoParams,
  GenerateCharacterInput,
  GenerateObjectInput,
  GenerateLocationInput,
  GenerateCreatureInput,
  GenerateScene3DParams,
  ListJobsParams,
} from "../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

type FetchMock = ReturnType<typeof vi.fn> & typeof fetch

function client(fetchMock: FetchMock) {
  return createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
}

const BATCH: GenerateImageBatchResult = {
  jobId: "job-1",
  jobIds: ["job-1", "job-2", "job-3"],
  batchId: "6b1f7e2a-0c4d-5e8f-9a1b-2c3d4e5f6a7b",
  groups: [
    { model: "gpt-image-2", jobIds: ["job-1", "job-2"], credits: 120 },
    { model: "flux-2-max", jobIds: ["job-3"], credits: 90, adjustments: [{ field: "resolution", from: "1K", to: "2 MP", reason: "x" }] },
  ],
  totalCredits: 210,
}

/** POST answers `runBody`; GET /v1/jobs/:id/status answers per job from `statusOf`. */
function batchFetch(runBody: unknown, statusOf: (jobId: string) => Record<string, unknown>): FetchMock {
  return vi.fn((url: string, init: { method: string }) => {
    if (init.method === "POST") return mockOk(runBody)
    const jobId = decodeURIComponent(url.split("/v1/jobs/")[1]!.split("/")[0]!)
    return mockOk({ data: { id: jobId, progress: 100, ...statusOf(jobId) } })
  }) as unknown as FetchMock
}

const sentBody = (fetchMock: FetchMock) => JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as Record<string, unknown>

afterEach(() => vi.useRealTimers())

describe("types (compile-time: the file builds only if they exist and carry the fields)", () => {
  it("GenerateImageParams types count, models, seed and userPrompt", () => {
    const params: GenerateImageParams = { prompt: "a red car", userPrompt: "a red {Thing}", count: 2, models: ["gpt-image-2", "flux-2-max"], seed: 7 }
    expect(params.count).toBe(2)
  })

  it("origin and sessionId are typed once and reach every generation params type", () => {
    const shared: GenerationSessionParams = { origin: "create-image", sessionId: "s" }
    const upscale: VideoUpscaleParams = { videoUrl: "https://cdn.example/v.mp4", ...shared }
    const depth: VideoDepthParams = { videoUrl: "https://cdn.example/v.mp4", ...shared }
    const narrated: AssembleNarratedVideoParams = { blocks: [], ...shared }
    const character: GenerateCharacterInput = { name: "Kira", ...shared }
    const object: GenerateObjectInput = { name: "Lamp", ...shared } as GenerateObjectInput
    const location: GenerateLocationInput = { name: "Pier", ...shared } as GenerateLocationInput
    const creature: GenerateCreatureInput = { name: "Fox", ...shared } as GenerateCreatureInput
    const scene: GenerateScene3DParams = { prompt: "a room", ...shared } as GenerateScene3DParams
    expect([upscale, depth, narrated, character, object, location, creature, scene].every((p) => p.origin === "create-image")).toBe(true)
  })

  it("jobs.list takes batchId", () => {
    const params: ListJobsParams = { batchId: BATCH.batchId }
    expect(params.batchId).toBe(BATCH.batchId)
  })
})

describe("nodes.run(\"generate-image\") with count / models", () => {
  it("posts the batch fields under their own names, with the Idempotency-Key", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(BATCH)) as unknown as FetchMock
    // A literal count above 1 (or models) picks the batch overload: typed, no cast.
    const result: GenerateImageBatchResult = await client(fetchMock).nodes.run("generate-image", { prompt: "a red car", count: 2, models: ["gpt-image-2", "flux-2-max"] }, { idempotencyKey: "client-key-0001" })
    expect(sentBody(fetchMock)).toMatchObject({ prompt: "a red car", count: 2, models: ["gpt-image-2", "flux-2-max"] })
    const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }
    expect(init.headers["Idempotency-Key"]).toBe("client-key-0001")
    expect(result.jobIds).toEqual(["job-1", "job-2", "job-3"])
    expect(result.groups.map((g) => g.model)).toEqual(["gpt-image-2", "flux-2-max"])
  })
})

describe("nodes.runAndWait refuses a batch: it waits for ONE job", () => {
  it.each([
    ["count above 1", { prompt: "x", count: 2 }],
    ["models", { prompt: "x", models: ["gpt-image-2", "flux-2-max"] }],
  ])("%s — rejects before calling the API, naming runBatchAndWait", async (_label, params) => {
    const fetchMock = vi.fn() as unknown as FetchMock
    const err = await client(fetchMock).nodes.runAndWait("generate-image", params as GenerateImageParams).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    expect((err as NodaroError).code).toBe("batch_requires_run_batch_and_wait")
    expect((err as Error).message).toContain("runBatchAndWait")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("count 1 is one job and waits as before", async () => {
    const fetchMock = batchFetch({ jobId: "job-1" }, () => ({ status: "completed", output_data: { imageUrl: "https://cdn.example/1.png" } }))
    const out = await client(fetchMock).nodes.runAndWait("generate-image", { prompt: "x", count: 1 })
    expect(out.imageUrl).toBe("https://cdn.example/1.png")
  })

  it("never silently waits for only the first job of a batch answer", async () => {
    const fetchMock = batchFetch(BATCH, () => ({ status: "completed" }))
    const err = await client(fetchMock).nodes.runAndWait("generate-image", { prompt: "x" }).catch((e: unknown) => e)
    expect((err as NodaroError).code).toBe("batch_requires_run_batch_and_wait")
    expect((err as Error).message).toContain("job-1, job-2, job-3")
  })
})

describe("nodes.runBatchAndWait", () => {
  it("submits once, waits for every job, and settles each one in order", async () => {
    const fetchMock = batchFetch(BATCH, (jobId) =>
      jobId === "job-2"
        ? { status: "failed", error_message: "blocked by the provider" }
        : { status: "completed", output_data: { imageUrl: `https://cdn.example/${jobId}.png` } },
    )
    const out: GenerateImageBatchOutput = await client(fetchMock).nodes.runBatchAndWait("generate-image", { prompt: "x", count: 2, models: ["gpt-image-2", "flux-2-max"] }, { pollMs: 1 })
    expect(fetchMock.mock.calls.filter((c) => (c[1] as { method: string }).method === "POST")).toHaveLength(1)
    expect(out.batch).toEqual(BATCH)
    expect(out.results.map((r) => [r.jobId, r.model, r.status])).toEqual([
      ["job-1", "gpt-image-2", "completed"],
      ["job-2", "gpt-image-2", "error"],
      ["job-3", "flux-2-max", "completed"],
    ])
    const done = out.results[0] as Extract<BatchJobOutcome, { status: "completed" }>
    expect(done.output.imageUrl).toBe("https://cdn.example/job-1.png")
    // One image failing never discards the others; the error stays typed.
    const failed = out.results[1] as Extract<BatchJobOutcome, { status: "error" }>
    expect(failed.error).toBeInstanceOf(JobFailedError)
    expect(failed.error.message).toBe("blocked by the provider")
  })

  it("passes the Idempotency-Key to the one submit", async () => {
    const fetchMock = batchFetch(BATCH, () => ({ status: "completed" }))
    await client(fetchMock).nodes.runBatchAndWait("generate-image", { prompt: "x", count: 3 }, { pollMs: 1, idempotencyKey: "client-key-0001" })
    const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }
    expect(init.headers["Idempotency-Key"]).toBe("client-key-0001")
  })

  it("refuses a one-image request before calling the API, naming runAndWait", async () => {
    const fetchMock = vi.fn() as unknown as FetchMock
    const err = await client(fetchMock).nodes.runBatchAndWait("generate-image", { prompt: "x", count: 1 }).catch((e: unknown) => e)
    expect((err as NodaroError).code).toBe("not_a_batch")
    expect((err as Error).message).toContain("runAndWait")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("an abort rejects the whole wait", async () => {
    const ac = new AbortController()
    const fetchMock = batchFetch(BATCH, () => ({ status: "processing" }))
    const promise = client(fetchMock).nodes.runBatchAndWait("generate-image", { prompt: "x", count: 3 }, { pollMs: 5, signal: ac.signal }).catch((e: unknown) => e)
    setTimeout(() => ac.abort(), 20)
    expect(await promise).toBeInstanceOf(JobAbortedError)
  })
})

describe("jobs.list({ batchId })", () => {
  it("sends batchId as a query parameter", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [], next: null })) as unknown as FetchMock
    await client(fetchMock).jobs.list({ batchId: BATCH.batchId })
    expect(String(fetchMock.mock.calls[0]![0])).toContain(`batchId=${BATCH.batchId}`)
  })
})
