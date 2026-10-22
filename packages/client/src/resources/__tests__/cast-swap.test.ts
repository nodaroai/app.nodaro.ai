import { describe, expect, it, vi } from "vitest"
import {
  createClient,
  StaticTokenAuth,
  type CastSwapEstimate,
  type CastSwapFaceMasking,
  type CastSwapParams,
} from "../../index.js"

function mockOk<T>(body: T, status = 200) {
  return Promise.resolve({ ok: true, status, json: async () => body } as unknown as Response)
}

function make(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({
    baseUrl: "https://api.example.com",
    auth: new StaticTokenAuth("t"),
    fetch: fetchMock as unknown as typeof fetch,
  })
}

const params: CastSwapParams = {
  videoUrl: "https://cdn.example.com/clip.mp4",
  roles: [
    {
      kind: "person",
      name: "the woman that attacks",
      images: ["https://cdn.example.com/me.png"],
      body: "original",
      outfit: "new",
    },
    { kind: "person", name: "the man", images: null, previewName: "the tall man", inPreview: false },
    { kind: "location", images: ["https://cdn.example.com/beach.png"] },
  ],
  prePrompt: "{role:2} in slow motion",
  postPrompt: "{role:1} smiles at the end",
  preview: true,
  previewStart: 2,
  quality: "draft",
  sessionId: "session-1",
  origin: "tools",
}

describe("castSwap resource", () => {
  it("run posts the body to /v1/cast-swap", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1" }, 202))
    const client = make(fetchMock)

    await expect(client.castSwap.run(params)).resolves.toEqual({ jobId: "job-1" })

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/cast-swap")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual(params)
  })

  it("run sends idempotencyKey as the Idempotency-Key header", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1" }, 202))
    const client = make(fetchMock)

    await client.castSwap.run(params, { idempotencyKey: "retry-key-0001" })

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string>; body: string }
    expect(init.headers["Idempotency-Key"]).toBe("retry-key-0001")
    expect(JSON.parse(init.body)).toEqual(params)
  })

  it("run sends no Idempotency-Key header without a key", async () => {
    const fetchMock = vi.fn().mockReturnValue(mockOk({ jobId: "job-1" }, 202))
    const client = make(fetchMock)

    await client.castSwap.run(params)
    await client.castSwap.run(params, {})

    for (const call of fetchMock.mock.calls) {
      const init = call[1] as { headers: Record<string, string> }
      expect(Object.keys(init.headers).map((k) => k.toLowerCase())).not.toContain("idempotency-key")
    }
  })

  it("run passes a dedup hit through as { jobId, deduped: true }", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1", deduped: true }, 200))
    const client = make(fetchMock)

    const out: { jobId: string; deduped?: boolean } = await client.castSwap.run(params)
    expect(out).toEqual({ jobId: "job-1", deduped: true })
  })

  it("run posts pet and product roles, the resolution and the preparation switch unchanged", async () => {
    const v1: CastSwapParams = {
      videoUrl: "https://cdn.example.com/clip.mp4",
      roles: [
        { kind: "person", name: "the runner", images: ["https://cdn.example.com/me.png"], hair: "original" },
        { kind: "pet", name: "the dog", images: ["https://cdn.example.com/dog.png"], coat: "original" },
        { kind: "product", name: "the can", images: ["https://cdn.example.com/can.png"], shape: "new", finish: "original" },
        { kind: "pet", name: "the cat", images: null },
      ],
      resolution: "1080p",
      draft: false,
      prepareReferences: false,
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-2" }, 202))
    const client = make(fetchMock)

    await expect(client.castSwap.run(v1)).resolves.toEqual({ jobId: "job-2" })

    const init = fetchMock.mock.calls[0][1] as { body: string }
    expect(JSON.parse(init.body)).toEqual(v1)
  })

  it("run posts faceMasking unchanged, every setting included", async () => {
    const faceMasking: CastSwapFaceMasking = {
      mode: "auto",
      fill: "depth",
      minFaceHeightPct: 10,
      maxFaceHeightPct: 60,
      zone: { leftPct: 5, rightPct: 5, topPct: 0, bottomPct: 20 },
      blurStrengthPct: 3,
      threshold: 0.4,
    }
    const withMasking: CastSwapParams = { ...params, faceMasking }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-3" }, 202))
    const client = make(fetchMock)

    await client.castSwap.run(withMasking)

    const init = fetchMock.mock.calls[0][1] as { body: string }
    expect(JSON.parse(init.body).faceMasking).toEqual(faceMasking)
  })

  // vitest does not typecheck: the `@ts-expect-error` lines below are held by
  // CI's "SDK type tests" step (`tsc -p packages/client/tsconfig.type-tests.json`).
  it("types faceMasking: mode is required, the rest optional, and only the documented values", () => {
    const minimal: CastSwapFaceMasking = { mode: "always" }
    const zoneOnly: CastSwapFaceMasking = { mode: "always", zone: { leftPct: 10 } }
    // @ts-expect-error — mode is required
    const noMode: CastSwapFaceMasking = { fill: "blur" }
    // @ts-expect-error — not a mode
    const badMode: CastSwapFaceMasking = { mode: "sometimes" }
    // @ts-expect-error — not a fill
    const badFill: CastSwapFaceMasking = { mode: "auto", fill: "pixelate" }
    expect([minimal, zoneOnly, noMode, badMode, badFill]).toHaveLength(5)
  })

  it("estimate passes the masking credits through", async () => {
    const estimate: CastSwapEstimate = {
      totalCredits: 15,
      breakdown: { castSwap: 5, seedance: 7, references: 3, masking: 2 },
      maskingCredits: 2,
      settlesLower: false,
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(estimate))
    const client = make(fetchMock)

    const out = await client.castSwap.estimate({ ...params, faceMasking: { mode: "auto" } })
    expect(out.maskingCredits).toBe(2)
    expect(out.breakdown.masking).toBe(2)
  })

  it("estimate posts to /v1/cast-swap/estimate", async () => {
    const estimate = { totalCredits: 15, breakdown: { castSwap: 5, seedance: 7, references: 3 }, settlesLower: true }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(estimate))
    const client = make(fetchMock)

    const out: CastSwapEstimate = await client.castSwap.estimate(params)
    expect(out).toEqual(estimate)
    expect(out.breakdown.references).toBe(3)

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/cast-swap/estimate")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual(params)
  })
})
