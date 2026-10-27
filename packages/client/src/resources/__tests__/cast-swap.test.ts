import { describe, expect, it, vi } from "vitest"
import {
  createClient,
  NodaroError,
  StaticTokenAuth,
  type CastSwapEngine,
  type CastSwapEstimate,
  type CastSwapFullQualityEstimate,
  type CastSwapFullQualityKind,
  type CastSwapFullQualityRefusalCode,
  type CastSwapFullQualityResult,
  type CastSwapFaceMasking,
  type CastSwapParams,
  type CastSwapStyle,
} from "../../index.js"

function mockOk<T>(body: T, status = 200) {
  return Promise.resolve({ ok: true, status, json: async () => body } as unknown as Response)
}

function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body, headers: new Headers() } as unknown as Response)
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

  // faceMasking is deprecated and ignored by the server (Nodaro sets it per engine); the SDK
  // still types and sends it as given, so older code compiles and runs unchanged.
  it("still sends a deprecated faceMasking as given (the server ignores it)", async () => {
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
    // null = no margins (left out = the default margins).
    const noMargins: CastSwapFaceMasking = { mode: "always", zone: null }
    // @ts-expect-error — mode is required
    const noMode: CastSwapFaceMasking = { fill: "blur" }
    // @ts-expect-error — not a mode
    const badMode: CastSwapFaceMasking = { mode: "sometimes" }
    // @ts-expect-error — not a fill
    const badFill: CastSwapFaceMasking = { mode: "auto", fill: "pixelate" }
    expect([minimal, zoneOnly, noMargins, noMode, badMode, badFill]).toHaveLength(6)
  })

  it("run and estimate post engine unchanged, Nodaro Motion Pulse at 720p with no draft", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-k" }, 202)).mockReturnValueOnce(mockOk({ totalCredits: 1, breakdown: { castSwap: 1, motion: 0, references: 0 }, settlesLower: false }))
    const client = make(fetchMock)
    const lite: CastSwapParams = { videoUrl: params.videoUrl, roles: params.roles, engine: "motion-pulse", resolution: "720p", draft: false, motionLength: "cut-start" }
    await client.castSwap.run(lite)
    await client.castSwap.estimate(lite)
    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse((call[1] as { body: string }).body)).toMatchObject({ engine: "motion-pulse", resolution: "720p", draft: false, motionLength: "cut-start" })
    }
  })

  it("run and estimate post style unchanged, and leave it out when it is not given", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ jobId: "job-m" }, 202))
      .mockReturnValueOnce(mockOk({ totalCredits: 1, breakdown: {}, settlesLower: false }))
      .mockReturnValueOnce(mockOk({ jobId: "job-p" }, 202))
    const client = make(fetchMock)
    const motion: CastSwapParams = { ...params, style: "motion" }
    await client.castSwap.run(motion)
    await client.castSwap.estimate(motion)
    await client.castSwap.run(params)
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse((call[1] as { body: string }).body) as { style?: string })
    expect(bodies.map((b) => b.style)).toEqual(["motion", "motion", undefined])
    const styles: CastSwapStyle[] = ["precise", "motion"]
    // @ts-expect-error — not a style
    const bad: CastSwapStyle = "loose"
    expect([styles, bad]).toHaveLength(2)
  })

  it("answers an estimate's engine by its public id, whichever id the server named it by", async () => {
    for (const [answered, engine] of [
      ["motion-pro", "motion-prism"],
      ["motion-lite", "motion-pulse"],
      ["kling-4", "motion-pulse"],
      ["motion-pulse", "motion-pulse"],
    ] as const) {
      const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ engine: answered, totalCredits: 1, breakdown: {}, settlesLower: false }))
      await expect(make(fetchMock).castSwap.estimate(params)).resolves.toMatchObject({ engine, totalCredits: 1 })
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ totalCredits: 2, breakdown: {}, settlesLower: false }))
    expect(await make(fetchMock).castSwap.estimate(params)).not.toHaveProperty("engine")
  })

  it("leaves engine out of the body when it is not given (the route runs Nodaro Motion Prism)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-s" }, 202))
    const client = make(fetchMock)
    await client.castSwap.run(params)
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).not.toHaveProperty("engine")
  })

  it("types engine and the Full Quality kind: only the documented values", () => {
    const engines: CastSwapEngine[] = ["motion-prism", "motion-pulse"]
    // @ts-expect-error — not an engine
    const badEngine: CastSwapEngine = "kling-3"
    // @ts-expect-error — an old id is not a public engine (it is never returned)
    const oldId: CastSwapEngine = "kling-4"
    // @ts-expect-error — nor is an earlier public id
    const earlierId: CastSwapEngine = "motion-lite"
    // …but a request still takes it (deprecated).
    const legacy: CastSwapParams["engine"][] = ["seedance-2-5", "kling-4", "motion-pro", "motion-lite", "motion-prism"]
    // @ts-expect-error — not a length fit ("pad" would stretch the motion)
    const badLength: CastSwapParams["motionLength"] = "pad"
    const kinds: CastSwapFullQualityKind[] = ["same-take", "new-take"]
    // @ts-expect-error — not a kind
    const badKind: CastSwapFullQualityKind = "remaster"
    // kind is optional: an older engine answers none (a same take).
    const older: CastSwapFullQualityEstimate = { totalCredits: 1, breakdown: { castSwap: 1, motionHd: 0 }, availableUntil: "x" }
    expect([engines, badEngine, oldId, earlierId, legacy, badLength, kinds, badKind, older]).toHaveLength(9)
  })

  it("types the base fee as base, with castSwap (an older server's name) still accepted", async () => {
    // castSwap only (a server before Cast Swap 0.396.0), both (0.396.0), base only (0.397.0).
    const quotes: CastSwapEstimate[] = [
      { totalCredits: 12, breakdown: { castSwap: 5, references: 0, motion: 7 }, settlesLower: false },
      { totalCredits: 12, breakdown: { base: 5, castSwap: 5, references: 0, motion: 7 }, settlesLower: false },
      { totalCredits: 12, breakdown: { base: 5, references: 0, motion: 7 }, settlesLower: false },
    ]
    const fq: CastSwapFullQualityEstimate[] = [
      { totalCredits: 12, breakdown: { castSwap: 5, motionHd: 7 }, availableUntil: "x" },
      { totalCredits: 12, breakdown: { base: 5, castSwap: 5, motionHd: 7 }, availableUntil: "x" },
      { totalCredits: 12, breakdown: { base: 5, motionHd: 7 }, availableUntil: "x" },
    ]
    for (const q of [...quotes, ...fq]) {
      const fetchMock = vi.fn().mockReturnValueOnce(mockOk(q))
      const client = make(fetchMock)
      const out = "settlesLower" in q ? await client.castSwap.estimate(params) : await client.castSwap.fullQualityEstimate("draft-1")
      // The SDK passes the quote through unchanged; a reader takes base, else castSwap.
      expect(out).toEqual(q)
      const base: number | undefined = out.breakdown.base ?? out.breakdown.castSwap
      expect(base).toBe(5)
    }
  })

  it("estimate passes the privacy credits and the neutral breakdown through", async () => {
    const estimate: CastSwapEstimate = {
      engine: "motion-prism",
      totalCredits: 15,
      breakdown: { base: 5, motion: 7, references: 3, privacy: 2 },
      privacyCredits: 2,
      settlesLower: false,
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(estimate))
    const client = make(fetchMock)

    const out = await client.castSwap.estimate(params)
    expect(out.privacyCredits).toBe(2)
    expect(out.breakdown.privacy).toBe(2)
    expect(out.breakdown.motion).toBe(7)
  })

  it("estimate passes the expected charge through beside the hold", async () => {
    const estimate: CastSwapEstimate = {
      totalCredits: 40,
      expectedCredits: 31,
      breakdown: { base: 5, motion: 32, motionExpected: 23, references: 3 },
      settlesLower: true,
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(estimate))
    const client = make(fetchMock)

    const out = await client.castSwap.estimate(params)
    expect(out).toEqual(estimate)
    expect(out.expectedCredits).toBe(31)
    expect(out.breakdown.motionExpected).toBe(23)
    // The expected charge is the hold with the video model's expected charge in place of its hold.
    expect(out.totalCredits - out.breakdown.motion! + out.breakdown.motionExpected!).toBe(out.expectedCredits)
  })

  it("estimate posts to /v1/cast-swap/estimate", async () => {
    const estimate = { totalCredits: 15, breakdown: { castSwap: 5, motion: 7, references: 3 }, settlesLower: true }
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
  it("run posts fixed references unchanged", async () => {
    const withReferences: CastSwapParams = {
      videoUrl: "https://cdn.example.com/clip.mp4",
      roles: [{ kind: "person", name: "the woman", images: null }],
      references: [
        { images: ["https://cdn.example.com/glass.png"], line: "the glass she drinks from" },
        { images: ["https://cdn.example.com/sky1.png", "https://cdn.example.com/sky2.png"], line: "Use {image} for the sky" },
      ],
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-3" }, 202))
    const client = make(fetchMock)

    await client.castSwap.run(withReferences)

    const init = fetchMock.mock.calls[0][1] as { body: string }
    expect(JSON.parse(init.body).references).toEqual(withReferences.references)
  })

  it("fullQualityEstimate posts to the draft's /full-quality/estimate", async () => {
    const quote: CastSwapFullQualityEstimate = {
      totalCredits: 12,
      breakdown: { castSwap: 5, motionHd: 7 },
      availableUntil: "2026-10-28T10:00:00.000Z",
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(quote))
    const client = make(fetchMock)

    await expect(client.castSwap.fullQualityEstimate("draft-1")).resolves.toEqual(quote)

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/cast-swap/draft-1/full-quality/estimate")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    // An empty JSON object, never an empty body: a JSON content type with no body is refused.
    expect(JSON.parse(init.body)).toEqual({})
  })

  it("fullQualityEstimate passes the kind through (a Kling 4 new take)", async () => {
    const quote: CastSwapFullQualityEstimate = {
      kind: "new-take",
      totalCredits: 400,
      breakdown: { castSwap: 40, kling: 360 },
      availableUntil: "2026-10-28T10:00:00.000Z",
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(quote))
    await expect(make(fetchMock).castSwap.fullQualityEstimate("run-720")).resolves.toEqual(quote)
  })

  it("fullQuality posts the session to the draft's /full-quality and returns the job", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "fq-1" }, 202))
    const client = make(fetchMock)

    const out: CastSwapFullQualityResult = await client.castSwap.fullQuality("draft-1", { sessionId: "session-1" })
    expect(out).toEqual({ jobId: "fq-1" })

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/cast-swap/draft-1/full-quality")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string; headers: Record<string, string> }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ sessionId: "session-1" })
    // The server keys the job by the draft; a client key would be replaced, so none is sent.
    expect(Object.keys(init.headers).map((k) => k.toLowerCase())).not.toContain("idempotency-key")
  })

  it("fullQuality without options sends an empty JSON object", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "fq-1" }, 202))
    const client = make(fetchMock)

    await client.castSwap.fullQuality("draft-1")

    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({})
  })

  it("fullQuality passes an existing try through as { jobId, existing: true }", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "fq-0", existing: true }, 200))
    const client = make(fetchMock)

    await expect(client.castSwap.fullQuality("draft-1")).resolves.toEqual({ jobId: "fq-0", existing: true })
  })

  it("encodes the job id into the path", async () => {
    const fetchMock = vi.fn().mockReturnValue(mockOk({ jobId: "fq-1" }, 202))
    const client = make(fetchMock)

    await client.castSwap.fullQuality("a/b?c")
    await client.castSwap.fullQualityEstimate("a/b?c")

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/cast-swap/a%2Fb%3Fc/full-quality")
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.example.com/v1/cast-swap/a%2Fb%3Fc/full-quality/estimate")
  })

  it("a Full Quality refusal throws a NodaroError carrying the route's code", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(409, { error: { code: "full_quality_unavailable", message: "This run cannot be finished at full quality." } }),
    )
    const client = make(fetchMock)

    const err = await client.castSwap.fullQuality("draft-1").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    const code: CastSwapFullQualityRefusalCode = (err as NodaroError).code
    expect(code).toBe("full_quality_unavailable")
    expect((err as NodaroError).status).toBe(409)
  })

  it("full_quality_pending, the refusal that ends on its own, carries retryable in its details", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(409, { error: { code: "full_quality_pending", message: "An earlier try is still being finished.", retryable: true } }),
    )
    const client = make(fetchMock)

    const err = await client.castSwap.fullQualityEstimate("draft-1").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    const code: CastSwapFullQualityRefusalCode = (err as NodaroError).code
    expect(code).toBe("full_quality_pending")
    expect((err as NodaroError).status).toBe(409)
    expect((err as NodaroError).details.retryable).toBe(true)
  })
})
