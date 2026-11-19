import { describe, expect, it, vi } from "vitest"
import {
  CastSwapResource,
  VideoRemakeResource,
  createClient,
  NodaroError,
  StaticTokenAuth,
  type CastSwapEngine,
  type CastSwapParams,
  type VideoRemakeAdvanced,
  type VideoRemakeArtStyle,
  type VideoRemakeEngine,
  type VideoRemakeEstimate,
  type VideoRemakeFullQualityEstimate,
  type VideoRemakeFullQualityKind,
  type VideoRemakeFullQualityRefusalCode,
  type VideoRemakeFullQualityResult,
  type VideoRemakeFaceMasking,
  type VideoRemakeParams,
  type VideoRemakeStyle,
  type VideoRemakeStyleChoice,
  type VideoRemakeStyleChoiceOption,
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

const params: VideoRemakeParams = {
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

describe("videoRemake resource", () => {
  it("run posts the body to /v1/video-remake", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1" }, 202))
    const client = make(fetchMock)

    await expect(client.videoRemake.run(params)).resolves.toEqual({ jobId: "job-1" })

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/video-remake")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual(params)
  })

  it("run sends idempotencyKey as the Idempotency-Key header", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1" }, 202))
    const client = make(fetchMock)

    await client.videoRemake.run(params, { idempotencyKey: "retry-key-0001" })

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string>; body: string }
    expect(init.headers["Idempotency-Key"]).toBe("retry-key-0001")
    expect(JSON.parse(init.body)).toEqual(params)
  })

  it("run sends no Idempotency-Key header without a key", async () => {
    const fetchMock = vi.fn().mockReturnValue(mockOk({ jobId: "job-1" }, 202))
    const client = make(fetchMock)

    await client.videoRemake.run(params)
    await client.videoRemake.run(params, {})

    for (const call of fetchMock.mock.calls) {
      const init = call[1] as { headers: Record<string, string> }
      expect(Object.keys(init.headers).map((k) => k.toLowerCase())).not.toContain("idempotency-key")
    }
  })

  it("run passes a dedup hit through as { jobId, deduped: true }", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1", deduped: true }, 200))
    const client = make(fetchMock)

    const out: { jobId: string; deduped?: boolean } = await client.videoRemake.run(params)
    expect(out).toEqual({ jobId: "job-1", deduped: true })
  })

  it("run posts pet and product roles, the resolution and the preparation switch unchanged", async () => {
    const v1: VideoRemakeParams = {
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

    await expect(client.videoRemake.run(v1)).resolves.toEqual({ jobId: "job-2" })

    const init = fetchMock.mock.calls[0][1] as { body: string }
    expect(JSON.parse(init.body)).toEqual(v1)
  })

  // faceMasking is deprecated and ignored by the server (Nodaro sets it per engine); the SDK
  // still types and sends it as given, so older code compiles and runs unchanged.
  it("still sends a deprecated faceMasking as given (the server ignores it)", async () => {
    const faceMasking: VideoRemakeFaceMasking = {
      mode: "auto",
      fill: "depth",
      minFaceHeightPct: 10,
      maxFaceHeightPct: 60,
      zone: { leftPct: 5, rightPct: 5, topPct: 0, bottomPct: 20 },
      blurStrengthPct: 3,
      threshold: 0.4,
    }
    const withMasking: VideoRemakeParams = { ...params, faceMasking }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-3" }, 202))
    const client = make(fetchMock)

    await client.videoRemake.run(withMasking)

    const init = fetchMock.mock.calls[0][1] as { body: string }
    expect(JSON.parse(init.body).faceMasking).toEqual(faceMasking)
  })

  // vitest does not typecheck: the `@ts-expect-error` lines below are held by
  // CI's "SDK type tests" step (`tsc -p packages/client/tsconfig.type-tests.json`).
  it("types faceMasking: mode is required, the rest optional, and only the documented values", () => {
    const minimal: VideoRemakeFaceMasking = { mode: "always" }
    const zoneOnly: VideoRemakeFaceMasking = { mode: "always", zone: { leftPct: 10 } }
    // null = no margins (left out = the default margins).
    const noMargins: VideoRemakeFaceMasking = { mode: "always", zone: null }
    // @ts-expect-error — mode is required
    const noMode: VideoRemakeFaceMasking = { fill: "blur" }
    // @ts-expect-error — not a mode
    const badMode: VideoRemakeFaceMasking = { mode: "sometimes" }
    // @ts-expect-error — not a fill
    const badFill: VideoRemakeFaceMasking = { mode: "auto", fill: "pixelate" }
    expect([minimal, zoneOnly, noMargins, noMode, badMode, badFill]).toHaveLength(6)
  })

  it("run and estimate post engine unchanged, Nodaro Pulse at 720p with no draft", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-k" }, 202)).mockReturnValueOnce(mockOk({ totalCredits: 1, breakdown: { castSwap: 1, motion: 0, references: 0 }, settlesLower: false }))
    const client = make(fetchMock)
    const lite: VideoRemakeParams = { videoUrl: params.videoUrl, roles: params.roles, engine: "nodaro-pulse", resolution: "720p", draft: false, motionLength: "cut-start" }
    await client.videoRemake.run(lite)
    await client.videoRemake.estimate(lite)
    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse((call[1] as { body: string }).body)).toMatchObject({ engine: "nodaro-pulse", resolution: "720p", draft: false, motionLength: "cut-start" })
    }
  })

  it("run and estimate post style unchanged, and leave it out when it is not given", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ jobId: "job-m" }, 202))
      .mockReturnValueOnce(mockOk({ totalCredits: 1, breakdown: {}, settlesLower: false }))
      .mockReturnValueOnce(mockOk({ jobId: "job-p" }, 202))
    const client = make(fetchMock)
    const motion: VideoRemakeParams = { ...params, style: "motion" }
    await client.videoRemake.run(motion)
    await client.videoRemake.estimate(motion)
    await client.videoRemake.run(params)
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse((call[1] as { body: string }).body) as { style?: string })
    expect(bodies.map((b) => b.style)).toEqual(["motion", "motion", undefined])
    const styles: VideoRemakeStyle[] = ["precise", "motion"]
    // @ts-expect-error — not a style
    const bad: VideoRemakeStyle = "loose"
    expect([styles, bad]).toHaveLength(2)
  })

  it("answers an estimate's engine by its public id, whichever id the server named it by", async () => {
    for (const [answered, engine] of [
      ["motion-prism", "nodaro-prism"],
      ["motion-pro", "nodaro-prism"],
      ["seedance-2-5", "nodaro-prism"],
      ["motion-pulse", "nodaro-pulse"],
      ["motion-lite", "nodaro-pulse"],
      ["kling-4", "nodaro-pulse"],
      ["nodaro-pulse", "nodaro-pulse"],
    ] as const) {
      const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ engine: answered, totalCredits: 1, breakdown: {}, settlesLower: false }))
      await expect(make(fetchMock).videoRemake.estimate(params)).resolves.toMatchObject({ engine, totalCredits: 1 })
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ totalCredits: 2, breakdown: {}, settlesLower: false }))
    expect(await make(fetchMock).videoRemake.estimate(params)).not.toHaveProperty("engine")
  })

  it("leaves engine out of the body when it is not given (the route runs Nodaro Prism)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-s" }, 202))
    const client = make(fetchMock)
    await client.videoRemake.run(params)
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).not.toHaveProperty("engine")
  })

  it("types engine and the Full Quality kind: only the documented values", () => {
    const engines: VideoRemakeEngine[] = ["nodaro-prism", "nodaro-pulse"]
    // @ts-expect-error — not an engine
    const badEngine: VideoRemakeEngine = "kling-3"
    // @ts-expect-error — an old id is not a public engine (it is never returned)
    const oldId: VideoRemakeEngine = "kling-4"
    // @ts-expect-error — nor is an earlier public id
    const earlierId: VideoRemakeEngine = "motion-lite"
    // @ts-expect-error — nor the one before the current ids
    const previousId: VideoRemakeEngine = "motion-prism"
    // …but a request still takes them (deprecated).
    const legacy: VideoRemakeParams["engine"][] = ["seedance-2-5", "kling-4", "motion-pro", "motion-lite", "motion-prism", "motion-pulse", "nodaro-prism"]
    // @ts-expect-error — not a length fit ("pad" would stretch the motion)
    const badLength: VideoRemakeParams["motionLength"] = "pad"
    const kinds: VideoRemakeFullQualityKind[] = ["same-take", "new-take"]
    // @ts-expect-error — not a kind
    const badKind: VideoRemakeFullQualityKind = "remaster"
    // kind is optional: an older engine answers none (a same take).
    const older: VideoRemakeFullQualityEstimate = { totalCredits: 1, breakdown: { castSwap: 1, motionHd: 0 }, availableUntil: "x" }
    expect([engines, badEngine, oldId, earlierId, previousId, legacy, badLength, kinds, badKind, older]).toHaveLength(10)
  })

  it("types the base fee as base, with castSwap (an older server's name) still accepted", async () => {
    // castSwap only (an older server), both, base only (the current one).
    const quotes: VideoRemakeEstimate[] = [
      { totalCredits: 12, breakdown: { castSwap: 5, references: 0, motion: 7 }, settlesLower: false },
      { totalCredits: 12, breakdown: { base: 5, castSwap: 5, references: 0, motion: 7 }, settlesLower: false },
      { totalCredits: 12, breakdown: { base: 5, references: 0, motion: 7 }, settlesLower: false },
    ]
    const fq: VideoRemakeFullQualityEstimate[] = [
      { totalCredits: 12, breakdown: { castSwap: 5, motionHd: 7 }, availableUntil: "x" },
      { totalCredits: 12, breakdown: { base: 5, castSwap: 5, motionHd: 7 }, availableUntil: "x" },
      { totalCredits: 12, breakdown: { base: 5, motionHd: 7 }, availableUntil: "x" },
    ]
    for (const q of [...quotes, ...fq]) {
      const fetchMock = vi.fn().mockReturnValueOnce(mockOk(q))
      const client = make(fetchMock)
      const out = "settlesLower" in q ? await client.videoRemake.estimate(params) : await client.videoRemake.fullQualityEstimate("draft-1")
      // The SDK passes the quote through unchanged; a reader takes base, else castSwap.
      expect(out).toEqual(q)
      const base: number | undefined = out.breakdown.base ?? out.breakdown.castSwap
      expect(base).toBe(5)
    }
  })

  it("estimate passes the privacy credits and the neutral breakdown through", async () => {
    const estimate: VideoRemakeEstimate = {
      engine: "nodaro-prism",
      totalCredits: 15,
      breakdown: { base: 5, motion: 7, references: 3, privacy: 2 },
      privacyCredits: 2,
      settlesLower: false,
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(estimate))
    const client = make(fetchMock)

    const out = await client.videoRemake.estimate(params)
    expect(out.privacyCredits).toBe(2)
    expect(out.breakdown.privacy).toBe(2)
    expect(out.breakdown.motion).toBe(7)
  })

  it("estimate passes the expected charge through beside the hold", async () => {
    const estimate: VideoRemakeEstimate = {
      totalCredits: 40,
      expectedCredits: 31,
      breakdown: { base: 5, motion: 32, motionExpected: 23, references: 3 },
      settlesLower: true,
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(estimate))
    const client = make(fetchMock)

    const out = await client.videoRemake.estimate(params)
    expect(out).toEqual(estimate)
    expect(out.expectedCredits).toBe(31)
    expect(out.breakdown.motionExpected).toBe(23)
    // The expected charge is the hold with the video model's expected charge in place of its hold.
    expect(out.totalCredits - out.breakdown.motion! + out.breakdown.motionExpected!).toBe(out.expectedCredits)
  })

  it("estimate posts to /v1/video-remake/estimate", async () => {
    const estimate = { totalCredits: 15, breakdown: { castSwap: 5, motion: 7, references: 3 }, settlesLower: true }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(estimate))
    const client = make(fetchMock)

    const out: VideoRemakeEstimate = await client.videoRemake.estimate(params)
    expect(out).toEqual(estimate)
    expect(out.breakdown.references).toBe(3)

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/video-remake/estimate")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual(params)
  })
  it("run posts fixed references unchanged", async () => {
    const withReferences: VideoRemakeParams = {
      videoUrl: "https://cdn.example.com/clip.mp4",
      roles: [{ kind: "person", name: "the woman", images: null }],
      references: [
        { images: ["https://cdn.example.com/glass.png"], line: "the glass she drinks from" },
        { images: ["https://cdn.example.com/sky1.png", "https://cdn.example.com/sky2.png"], line: "Use {image} for the sky" },
      ],
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-3" }, 202))
    const client = make(fetchMock)

    await client.videoRemake.run(withReferences)

    const init = fetchMock.mock.calls[0][1] as { body: string }
    expect(JSON.parse(init.body).references).toEqual(withReferences.references)
  })

  it("fullQualityEstimate posts to the draft's /full-quality/estimate", async () => {
    const quote: VideoRemakeFullQualityEstimate = {
      totalCredits: 12,
      breakdown: { castSwap: 5, motionHd: 7 },
      availableUntil: "2026-10-28T10:00:00.000Z",
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(quote))
    const client = make(fetchMock)

    await expect(client.videoRemake.fullQualityEstimate("draft-1")).resolves.toEqual(quote)

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/video-remake/draft-1/full-quality/estimate")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string }
    expect(init.method).toBe("POST")
    // An empty JSON object, never an empty body: a JSON content type with no body is refused.
    expect(JSON.parse(init.body)).toEqual({})
  })

  it("fullQualityEstimate passes the kind through (a Kling 4 new take)", async () => {
    const quote: VideoRemakeFullQualityEstimate = {
      kind: "new-take",
      totalCredits: 400,
      breakdown: { castSwap: 40, kling: 360 },
      availableUntil: "2026-10-28T10:00:00.000Z",
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(quote))
    await expect(make(fetchMock).videoRemake.fullQualityEstimate("run-720")).resolves.toEqual(quote)
  })

  it("fullQuality posts the session to the draft's /full-quality and returns the job", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "fq-1" }, 202))
    const client = make(fetchMock)

    const out: VideoRemakeFullQualityResult = await client.videoRemake.fullQuality("draft-1", { sessionId: "session-1" })
    expect(out).toEqual({ jobId: "fq-1" })

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/video-remake/draft-1/full-quality")
    const init = fetchMock.mock.calls[0][1] as { method: string; body: string; headers: Record<string, string> }
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ sessionId: "session-1" })
    // The server keys the job by the draft; a client key would be replaced, so none is sent.
    expect(Object.keys(init.headers).map((k) => k.toLowerCase())).not.toContain("idempotency-key")
  })

  it("fullQuality without options sends an empty JSON object", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "fq-1" }, 202))
    const client = make(fetchMock)

    await client.videoRemake.fullQuality("draft-1")

    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({})
  })

  it("fullQuality passes an existing try through as { jobId, existing: true }", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "fq-0", existing: true }, 200))
    const client = make(fetchMock)

    await expect(client.videoRemake.fullQuality("draft-1")).resolves.toEqual({ jobId: "fq-0", existing: true })
  })

  it("encodes the job id into the path", async () => {
    const fetchMock = vi.fn().mockReturnValue(mockOk({ jobId: "fq-1" }, 202))
    const client = make(fetchMock)

    await client.videoRemake.fullQuality("a/b?c")
    await client.videoRemake.fullQualityEstimate("a/b?c")

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/video-remake/a%2Fb%3Fc/full-quality")
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.example.com/v1/video-remake/a%2Fb%3Fc/full-quality/estimate")
  })

  it("a Full Quality refusal throws a NodaroError carrying the route's code", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(409, { error: { code: "full_quality_unavailable", message: "This run cannot be finished at full quality." } }),
    )
    const client = make(fetchMock)

    const err = await client.videoRemake.fullQuality("draft-1").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    const code: VideoRemakeFullQualityRefusalCode = (err as NodaroError).code
    expect(code).toBe("full_quality_unavailable")
    expect((err as NodaroError).status).toBe(409)
  })

  it("full_quality_pending, the refusal that ends on its own, carries retryable in its details", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(409, { error: { code: "full_quality_pending", message: "An earlier try is still being finished.", retryable: true } }),
    )
    const client = make(fetchMock)

    const err = await client.videoRemake.fullQualityEstimate("draft-1").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    const code: VideoRemakeFullQualityRefusalCode = (err as NodaroError).code
    expect(code).toBe("full_quality_pending")
    expect((err as NodaroError).status).toBe(409)
    expect((err as NodaroError).details.retryable).toBe(true)
  })

  it("advanced GETs /v1/video-remake/advanced and answers whether the page shows its Advanced options", async () => {
    for (const show of [true, false]) {
      const answer: VideoRemakeAdvanced = { show }
      const fetchMock = vi.fn().mockReturnValueOnce(mockOk(answer))
      const client = make(fetchMock)

      const got = await client.videoRemake.advanced()
      expect(got).toEqual(answer)
      const shown: boolean = got.show
      expect(shown).toBe(show)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe("https://api.example.com/v1/video-remake/advanced")
      expect(init.method).toBe("GET")
      expect(init.body).toBeUndefined()
    }
  })

  it("advanced is the same method on the castSwap alias", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ show: true }))
    const client = make(fetchMock)

    expect(await client.castSwap.advanced()).toEqual({ show: true })
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.example.com/v1/video-remake/advanced")
  })

  it("artStyles GETs /v1/video-remake/art-styles in the language asked for and answers the list", async () => {
    const answer: VideoRemakeArtStyle[] = [
      { id: "anime", label: "אנימה", clipUrl: "https://cdn.example.com/a.mp4", stillUrl: "https://cdn.example.com/a.jpg" },
      { id: "watercolor", label: "צבעי מים", clipUrl: "https://cdn.example.com/w.mp4", stillUrl: "https://cdn.example.com/w.jpg" },
    ]
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: answer }))
    const client = make(fetchMock)

    const got = await client.videoRemake.artStyles({ locale: "he" })
    expect(got).toEqual(answer)
    const first: VideoRemakeArtStyle = got[0]!
    expect(first.id).toBe("anime")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.example.com/v1/video-remake/art-styles?locale=he")
    expect(init.method).toBe("GET")
    expect(init.body).toBeUndefined()
  })

  it("artStyles sends no locale when none is asked for, and answers an empty list as it is", async () => {
    const fetchMock = vi.fn().mockReturnValue(mockOk({ data: [] }))
    const client = make(fetchMock)

    expect(await client.videoRemake.artStyles()).toEqual([])
    expect(await client.videoRemake.artStyles({})).toEqual([])
    expect(await client.castSwap.artStyles({ locale: "pt-BR" })).toEqual([])
    const urls = fetchMock.mock.calls.map((c) => (c as [string, RequestInit])[0])
    expect(urls).toEqual([
      "https://api.example.com/v1/video-remake/art-styles",
      "https://api.example.com/v1/video-remake/art-styles",
      "https://api.example.com/v1/video-remake/art-styles?locale=pt-BR",
    ])
  })

  it("styleChoice GETs /v1/video-remake/style-choice and answers every engine's choice", async () => {
    const answer: VideoRemakeStyleChoice = { engines: { "nodaro-prism": "flex", "nodaro-pulse": "user" } }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(answer))
    const client = make(fetchMock)

    const got = await client.videoRemake.styleChoice()
    expect(got).toEqual(answer)
    const option: VideoRemakeStyleChoiceOption = got.engines["nodaro-prism"]
    expect(option).toBe("flex")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.example.com/v1/video-remake/style-choice")
    expect(init.method).toBe("GET")
    expect(init.body).toBeUndefined()
  })

  it("styleChoice passes styleOnly through, per engine, typed", async () => {
    const answer: VideoRemakeStyleChoice = {
      engines: { "nodaro-prism": "user", "nodaro-pulse": "user" },
      styleOnly: { "nodaro-prism": true, "nodaro-pulse": false },
    }
    const client = make(vi.fn().mockReturnValueOnce(mockOk(answer)))
    const got = await client.videoRemake.styleChoice()
    expect(got).toEqual(answer)
    const prism: boolean | undefined = got.styleOnly?.["nodaro-prism"]
    expect(prism).toBe(true)
    expect(got.styleOnly?.["nodaro-pulse"]).toBe(false)
  })

  it("styleChoice from an older server has no styleOnly: every engine reads as false", async () => {
    const answer = { engines: { "nodaro-prism": "user", "nodaro-pulse": "user" } }
    const client = make(vi.fn().mockReturnValueOnce(mockOk(answer)))
    const got = await client.videoRemake.styleChoice()
    expect(got).toEqual(answer)
    expect(got.styleOnly).toBeUndefined()
    expect(got.styleOnly?.["nodaro-prism"] === true).toBe(false)
    expect(got.preciseArtStyle?.["nodaro-prism"] === true).toBe(false)
    expect(got.preciseArtStyleAlone?.["nodaro-prism"] === true).toBe(false)
  })

  it("styleChoice passes preciseArtStyle through, per engine, typed", async () => {
    const answer: VideoRemakeStyleChoice = {
      engines: { "nodaro-prism": "user", "nodaro-pulse": "user" },
      styleOnly: { "nodaro-prism": true, "nodaro-pulse": false },
      preciseArtStyle: { "nodaro-prism": true, "nodaro-pulse": false },
    }
    const client = make(vi.fn().mockReturnValueOnce(mockOk(answer)))
    const got = await client.videoRemake.styleChoice()
    expect(got).toEqual(answer)
    const prism: boolean | undefined = got.preciseArtStyle?.["nodaro-prism"]
    expect(prism).toBe(true)
    expect(got.preciseArtStyle?.["nodaro-pulse"]).toBe(false)
  })

  it("styleChoice passes preciseArtStyleAlone through, per engine, typed", async () => {
    const answer: VideoRemakeStyleChoice = {
      engines: { "nodaro-prism": "user", "nodaro-pulse": "user" },
      preciseArtStyleAlone: { "nodaro-prism": true, "nodaro-pulse": false },
    }
    const client = make(vi.fn().mockReturnValueOnce(mockOk(answer)))
    const got = await client.videoRemake.styleChoice()
    expect(got).toEqual(answer)
    const prism: boolean | undefined = got.preciseArtStyleAlone?.["nodaro-prism"]
    expect(prism).toBe(true)
    expect(got.preciseArtStyleAlone?.["nodaro-pulse"]).toBe(false)
  })
})

describe("the resource's former names (deprecated)", () => {
  it("client.castSwap is the videoRemake resource itself, calling the same routes", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1" }, 202))
    const client = make(fetchMock)
    expect(client.castSwap).toBe(client.videoRemake)
    expect(client.videoRemake).toBeInstanceOf(VideoRemakeResource)
    expect(CastSwapResource).toBe(VideoRemakeResource)
    await client.castSwap.run(params)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/video-remake")
  })

  it("keeps the CastSwap* types as the VideoRemake* ones", () => {
    const body: CastSwapParams = params
    const same: VideoRemakeParams = body
    const engine: CastSwapEngine = "nodaro-prism"
    const current: VideoRemakeEngine = engine
    expect([same, current]).toHaveLength(2)
  })
})
