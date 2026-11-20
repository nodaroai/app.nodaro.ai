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
  type VideoRemakeCustomStyleRefusalCode,
  type VideoRemakeDescribedStyle,
  type VideoRemakeArtStyle,
  type VideoRemakeEngine,
  type VideoRemakeEstimate,
  type VideoRemakeFullQualityEstimate,
  type VideoRemakeFullQualityKind,
  type VideoRemakeFullQualityRefusalCode,
  type VideoRemakeFullQualityResult,
  type VideoRemakeFaceMasking,
  type VideoRemakeParams,
  type VideoRemakePlanRolesDecision,
  type VideoRemakePlanRolesParams,
  type VideoRemakePlanRolesRefusalCode,
  type VideoRemakePlannedRoles,
  type VideoRemakeClipKind,
  type VideoRemakePrevizOptions,
  type VideoRemakePrevizRefusalCode,
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
      face: "original",
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

  it("styleChoice passes roleFace through, typed; an older server's answer has none", async () => {
    const answer: VideoRemakeStyleChoice = { engines: { "nodaro-prism": "user", "nodaro-pulse": "user" }, roleFace: true }
    const client = make(vi.fn().mockReturnValueOnce(mockOk(answer)))
    const got = await client.videoRemake.styleChoice()
    const keeps: boolean | undefined = got.roleFace
    expect(keeps).toBe(true)
    const older = make(vi.fn().mockReturnValueOnce(mockOk({ engines: answer.engines })))
    expect((await older.videoRemake.styleChoice()).roleFace === true).toBe(false)
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

describe("a custom style: the style in your own words", () => {
  const TEXT = "Hand-drawn ink on rough paper, heavy outlines, flat muted colours"

  it("run and estimate send direction.customStyle as written, in place of direction.style", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ jobId: "job-c" }, 202))
      .mockReturnValueOnce(mockOk({ totalCredits: 3, breakdown: {}, settlesLower: false }))
    const client = make(fetchMock)
    const params: VideoRemakeParams = { videoUrl: "https://cdn.example.com/clip.mp4", roles: [], style: "motion", direction: { customStyle: TEXT } }

    await client.videoRemake.run(params)
    await client.videoRemake.estimate(params)
    const [runUrl, runInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const [estimateUrl, estimateInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(runUrl).toBe("https://api.example.com/v1/video-remake")
    expect(estimateUrl).toBe("https://api.example.com/v1/video-remake/estimate")
    for (const init of [runInit, estimateInit]) {
      expect(JSON.parse(init.body as string).direction).toEqual({ customStyle: TEXT })
    }
  })

  it("direction is a catalog art style or a custom style, never both (types)", () => {
    const catalog: VideoRemakeParams["direction"] = { style: "pop-art" }
    const custom: VideoRemakeParams["direction"] = { customStyle: TEXT }
    // @ts-expect-error a run has one style: a catalog id or its own words
    const both: VideoRemakeParams["direction"] = { style: "pop-art", customStyle: TEXT }
    // @ts-expect-error a direction names one of the two
    const neither: VideoRemakeParams["direction"] = {}
    expect([catalog, custom, both, neither]).toHaveLength(4)
  })

  it("describeStyle POSTs /v1/video-remake/describe-style and answers the image's style in words", async () => {
    const answer: VideoRemakeDescribedStyle = { text: TEXT, medium: "2d", tones: "colour" }
    const fetchMock = vi.fn().mockReturnValue(mockOk(answer))
    const client = make(fetchMock)

    const got = await client.videoRemake.describeStyle({ imageUrl: "https://cdn.example.com/look.png", note: "like this, but darker" })
    expect(got).toEqual(answer)
    const text: string = got.text
    expect(text).toBe(TEXT)
    let [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.example.com/v1/video-remake/describe-style")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ imageUrl: "https://cdn.example.com/look.png", note: "like this, but darker" })

    // Without a note the body carries the image alone; the castSwap alias is the same method.
    await client.castSwap.describeStyle({ imageUrl: "https://cdn.example.com/look.png" })
    ;[url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe("https://api.example.com/v1/video-remake/describe-style")
    expect(JSON.parse(init.body as string)).toEqual({ imageUrl: "https://cdn.example.com/look.png" })
  })

  it("a refusal surfaces its code: not offered here, an unreadable image, a style that could not be described", async () => {
    const refusals: Array<[number, VideoRemakeCustomStyleRefusalCode]> = [
      [403, "custom_style_not_available"],
      [400, "image_unreadable"],
      [502, "describe_style_failed"],
      [422, "style_not_described"],
    ]
    for (const [status, code] of refusals) {
      const client = make(vi.fn().mockReturnValue(mockErr(status, { error: { code, message: "refused" } })))
      const err = await client.videoRemake.describeStyle({ imageUrl: "https://cdn.example.com/look.png" }).catch((e: unknown) => e)
      expect(err, code).toBeInstanceOf(NodaroError)
      const got: VideoRemakeCustomStyleRefusalCode = (err as NodaroError).code
      expect(got).toBe(code)
      expect((err as NodaroError).status).toBe(status)
    }
    const run = make(vi.fn().mockReturnValue(mockErr(400, { error: { code: "custom_style_with_art_style", message: "refused" } })))
    const err = await run.videoRemake.run({ videoUrl: "https://cdn.example.com/clip.mp4", roles: [], direction: { customStyle: TEXT } }).catch((e: unknown) => e)
    expect((err as NodaroError).code).toBe("custom_style_with_art_style")
  })

  it("styleChoice passes customStyle through, per engine, typed; an older server has none", async () => {
    const answer: VideoRemakeStyleChoice = {
      engines: { "nodaro-prism": "user", "nodaro-pulse": "user" },
      customStyle: { "nodaro-prism": true, "nodaro-pulse": false },
    }
    let client = make(vi.fn().mockReturnValueOnce(mockOk(answer)))
    let got = await client.videoRemake.styleChoice()
    expect(got).toEqual(answer)
    const prism: boolean | undefined = got.customStyle?.["nodaro-prism"]
    expect(prism).toBe(true)
    expect(got.customStyle?.["nodaro-pulse"]).toBe(false)

    client = make(vi.fn().mockReturnValueOnce(mockOk({ engines: { "nodaro-prism": "user", "nodaro-pulse": "user" } })))
    got = await client.videoRemake.styleChoice()
    expect(got.customStyle?.["nodaro-prism"] === true).toBe(false)
  })
})

describe("roles planned from the prompt", () => {
  const CLIP = "https://cdn.example.com/clip.mp4"
  const IMAGES = ["https://cdn.example.com/anna.png", "https://cdn.example.com/beach.png", "https://cdn.example.com/mystery.png"]
  const REQUEST = "put the first photo in place of the woman on the left, use the second as the room, and make it rain"
  const PLANNED: VideoRemakePlannedRoles = {
    prompt: REQUEST,
    roles: [
      { kind: "person", name: "the woman in the red scarf on the left", images: [IMAGES[0]!] },
      { kind: "location", name: "the living room", images: [IMAGES[1]!] },
    ],
    references: [],
    postPrompt: "make it rain",
    removed: ["put the first photo in place of the woman on the left", "use the second as the room"],
    unresolved: [{ images: [IMAGES[2]!], imageIndexes: [2], reason: "not_placed" }],
  }

  it("planRoles POSTs /v1/video-remake/plan-roles with the clip, the request and the images alone, and answers the plan", async () => {
    const fetchMock = vi.fn().mockReturnValue(mockOk(PLANNED))
    const client = make(fetchMock)

    const got = await client.videoRemake.planRoles({ videoUrl: CLIP, prompt: REQUEST, images: IMAGES })
    expect(got).toEqual(PLANNED)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.example.com/v1/video-remake/plan-roles")
    expect(init.method).toBe("POST")
    // Nothing the caller left out is sent (the route's body is strict).
    expect(JSON.parse(init.body as string)).toEqual({ videoUrl: CLIP, prompt: REQUEST, images: IMAGES })
  })

  it("sends the engine, the roles and references the caller already has, and the preview, as given", async () => {
    const fetchMock = vi.fn().mockReturnValue(mockOk(PLANNED))
    const client = make(fetchMock)
    const params: VideoRemakePlanRolesParams = {
      videoUrl: CLIP,
      prompt: REQUEST,
      images: IMAGES,
      engine: "nodaro-pulse",
      roles: [{ kind: "pet", name: "the dog", images: ["https://cdn.example.com/rex.png"], coat: "original" }],
      references: [{ images: ["https://cdn.example.com/glass.png"], line: "the glass she drinks from" }],
      preview: true,
      previewStart: 2,
    }
    // The castSwap alias is the same method.
    await client.castSwap.planRoles(params)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.example.com/v1/video-remake/plan-roles")
    expect(JSON.parse(init.body as string)).toEqual(params)
  })

  it("planRoles sends a 3D previz clip's statement and options as given, and answers each role's locator and subject", async () => {
    const planned: VideoRemakePlannedRoles = { ...PLANNED, roles: [{ kind: "person", name: "the tall model on the left", subject: "the pilot", images: [IMAGES[0]!] }] }
    const fetchMock = vi.fn().mockReturnValue(mockOk(planned))
    const client = make(fetchMock)
    const params: VideoRemakePlanRolesParams = { videoUrl: CLIP, prompt: REQUEST, images: IMAGES, clipKind: "previz", previz: { lighting: true, sound: "generated" } }
    const got = await client.videoRemake.planRoles(params)
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual(params)
    expect(got.roles[0]).toEqual({ kind: "person", name: "the tall model on the left", subject: "the pilot", images: [IMAGES[0]] })
    // A refusal of such a clip is a run's own code.
    const refused: VideoRemakePlanRolesRefusalCode = "previz_needs_prism"
    expect(refused).toBe("previz_needs_prism")
  })

  it("the plan goes to estimate and run as it is: its roles after the caller's own, its postPrompt as the run's", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk(PLANNED))
      .mockReturnValueOnce(mockOk({ totalCredits: 3, breakdown: {}, settlesLower: false }))
    const client = make(fetchMock)
    const mine: VideoRemakeParams["roles"] = [{ kind: "pet", name: "the dog", images: null }]
    const plan = await client.videoRemake.planRoles({ videoUrl: CLIP, prompt: REQUEST, images: IMAGES, roles: mine })
    const run: VideoRemakeParams = { videoUrl: CLIP, roles: [...mine, ...plan.roles], references: plan.references, postPrompt: plan.postPrompt }
    await client.videoRemake.estimate(run)
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ videoUrl: CLIP, roles: [...mine, ...PLANNED.roles], references: [], postPrompt: "make it rain" })
    // What could not be placed is typed for a caller to ask about.
    const [first] = plan.unresolved
    const indexes: number[] = first!.imageIndexes
    const candidates: string[] | undefined = first!.candidates
    expect(indexes).toEqual([2])
    expect(candidates).toBeUndefined()
  })

  it("a refusal surfaces its code, and an unreadable image says which", async () => {
    const refusals: Array<[number, VideoRemakePlanRolesRefusalCode]> = [
      [403, "plan_roles_not_available"],
      [400, "clip_out_of_range"],
      [400, "preview_out_of_range"],
      [400, "video_unreadable"],
      [502, "plan_roles_failed"],
      [429, "rate_limit_exceeded"],
    ]
    for (const [status, code] of refusals) {
      const client = make(vi.fn().mockReturnValue(mockErr(status, { error: { code, message: "refused" } })))
      const err = await client.videoRemake.planRoles({ videoUrl: CLIP, prompt: REQUEST, images: IMAGES }).catch((e: unknown) => e)
      expect(err, code).toBeInstanceOf(NodaroError)
      const got: VideoRemakePlanRolesRefusalCode = (err as NodaroError).code
      expect(got).toBe(code)
      expect((err as NodaroError).status).toBe(status)
    }
    const client = make(vi.fn().mockReturnValue(mockErr(400, { error: { code: "image_unreadable", message: "Image 2 could not be read.", details: { index: 1 } } })))
    const err = (await client.videoRemake.planRoles({ videoUrl: CLIP, prompt: REQUEST, images: IMAGES }).catch((e: unknown) => e)) as NodaroError
    expect(err.code).toBe("image_unreadable")
    // The envelope's own `details`, among the envelope's other fields.
    expect(err.details).toEqual({ details: { index: 1 } })
  })

  it("an empty request is sent as it is, and the plan's decisions come back typed, one per role; an older server sends none", async () => {
    const decided: VideoRemakePlannedRoles = {
      ...PLANNED,
      prompt: "",
      postPrompt: "",
      removed: [],
      unresolved: [],
      decisions: [
        { role: 0, basis: "inferred", confidence: "guess", alternatives: ["the woman by the window"] },
        { role: 1, basis: "request", evidence: "use the second as the room" },
      ],
    }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(decided)).mockReturnValueOnce(mockOk(decided)).mockReturnValueOnce(mockOk(PLANNED))
    const client = make(fetchMock)

    const got = await client.videoRemake.planRoles({ videoUrl: CLIP, prompt: "", images: IMAGES })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ videoUrl: CLIP, prompt: "", images: IMAGES })
    const first: VideoRemakePlanRolesDecision | undefined = got.decisions?.[0]
    expect(first).toEqual({ role: 0, basis: "inferred", confidence: "guess", alternatives: ["the woman by the window"] })
    const evidence: string | undefined = got.decisions?.[1]?.evidence
    expect(evidence).toBe("use the second as the room")
    // Left out, the request is not sent at all (the route reads that as empty).
    await client.videoRemake.planRoles({ videoUrl: CLIP, images: IMAGES })
    expect(JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string)).toEqual({ videoUrl: CLIP, images: IMAGES })
    // One per role, in the roles' order.
    expect(got.decisions).toHaveLength(got.roles.length)
    const guessed = got.roles.filter((_, i) => got.decisions?.[i]?.confidence === "guess")
    expect(guessed).toEqual([PLANNED.roles[0]])

    const older = await client.videoRemake.planRoles({ videoUrl: CLIP, prompt: REQUEST, images: IMAGES })
    expect(older.decisions).toBeUndefined()
    expect(older.roles.filter((_, i) => older.decisions?.[i]?.confidence === "guess")).toEqual([])
  })

  it("a server from before the route answers 404: an error to read as not offered, never a plan", async () => {
    const client = make(vi.fn().mockReturnValue(mockErr(404, { message: "Route POST:/v1/video-remake/plan-roles not found", error: "Not Found" })))
    const err = await client.videoRemake.planRoles({ videoUrl: CLIP, prompt: REQUEST, images: IMAGES }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroError)
    expect((err as NodaroError).status).toBe(404)
  })

  it("styleChoice passes planRoles through, one boolean; an older server has none", async () => {
    const answer: VideoRemakeStyleChoice = { engines: { "nodaro-prism": "user", "nodaro-pulse": "user" }, planRoles: true }
    let client = make(vi.fn().mockReturnValueOnce(mockOk(answer)))
    let got = await client.videoRemake.styleChoice()
    const offered: boolean | undefined = got.planRoles
    expect(offered).toBe(true)

    client = make(vi.fn().mockReturnValueOnce(mockOk({ engines: { "nodaro-prism": "user", "nodaro-pulse": "user" } })))
    got = await client.videoRemake.styleChoice()
    expect(got.planRoles === true).toBe(false)
  })
})

describe("a 3D previz clip (clipKind, previz, a role's subject)", () => {
  const CLIP = "https://cdn.example.com/previz.mp4"
  const previzRun: VideoRemakeParams = {
    videoUrl: CLIP,
    clipKind: "previz",
    previz: { lighting: true, sound: "generated" },
    roles: [
      { kind: "person", name: "the pink model", subject: "the detective", images: ["https://cdn.example.com/detective.png"] },
      { kind: "product", name: "the blue box on the table", subject: "a delivery parcel", images: ["https://cdn.example.com/parcel.png"] },
      { kind: "pet", name: "the small grey model", subject: "the dog", images: null },
      { kind: "location", subject: "a rainy street", images: ["https://cdn.example.com/street.png"] },
    ],
    postPrompt: "At night, in the rain.",
    resolution: "720p",
  }

  it("run and estimate post clipKind, previz and each role's subject unchanged", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockOk({ totalCredits: 400, breakdown: { video: 400 }, settlesLower: false }))
      .mockReturnValueOnce(mockOk({ jobId: "job-1" }, 202))
    const client = make(fetchMock)
    await client.videoRemake.estimate(previzRun)
    expect(await client.videoRemake.run(previzRun)).toEqual({ jobId: "job-1" })
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["https://api.example.com/v1/video-remake/estimate", "https://api.example.com/v1/video-remake"])
    for (const call of fetchMock.mock.calls) expect(JSON.parse(call[1].body as string)).toEqual(previzRun)
  })

  it("an ordinary run sends none of them: the body of before", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "job-1" }, 202))
    await make(fetchMock).videoRemake.run(params)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).not.toHaveProperty("clipKind")
    expect(body).not.toHaveProperty("previz")
    for (const role of body.roles) expect(role).not.toHaveProperty("subject")
  })

  it("the kinds and the options are typed: footage or previz, lighting, and whose sound", () => {
    const kinds: VideoRemakeClipKind[] = ["footage", "previz"]
    const options: VideoRemakePrevizOptions[] = [{}, { lighting: false }, { sound: "clip" }, { lighting: true, sound: "generated" }]
    expect(kinds).toHaveLength(2)
    expect(options).toHaveLength(4)
    // @ts-expect-error a clip is footage or a previz
    const wrongKind: VideoRemakeClipKind = "animation"
    // @ts-expect-error the sound is the clip's or generated
    const wrongSound: VideoRemakePrevizOptions = { sound: "silent" }
    expect([wrongKind, wrongSound]).toHaveLength(2)
  })

  it("each refusal arrives as a NodaroError with its code, on the run and the estimate", async () => {
    const refusals: Array<[number, VideoRemakePrevizRefusalCode]> = [
      [403, "previz_not_available"],
      [400, "previz_needs_prism"],
      [400, "previz_not_for_trends"],
      [400, "previz_no_draft"],
      [400, "previz_role_needs_locator"],
      [400, "previz_needs_clip_kind"],
    ]
    for (const [status, code] of refusals) {
      for (const call of ["run", "estimate"] as const) {
        const client = make(vi.fn().mockReturnValue(mockErr(status, { error: { code, message: "Refused." } })))
        const err = await client.videoRemake[call](previzRun).catch((e: unknown) => e)
        expect(err, `${code} on ${call}`).toBeInstanceOf(NodaroError)
        const got: VideoRemakePrevizRefusalCode = (err as NodaroError).code
        expect(got).toBe(code)
        expect((err as NodaroError).status).toBe(status)
      }
    }
  })

  it("a Full Quality asked of a previz run is refused 409 previz_no_full_quality", async () => {
    const client = make(vi.fn().mockReturnValue(mockErr(409, { error: { code: "previz_no_full_quality", message: "A 3D previz run has no Full Quality." } })))
    const err = (await client.videoRemake.fullQuality("job-1").catch((e: unknown) => e)) as NodaroError
    expect(err).toBeInstanceOf(NodaroError)
    const code: VideoRemakePrevizRefusalCode = err.code
    expect(code).toBe("previz_no_full_quality")
    expect(err.status).toBe(409)
  })

  it("styleChoice passes previz through, one boolean; an older server has none", async () => {
    const answer: VideoRemakeStyleChoice = { engines: { "nodaro-prism": "user", "nodaro-pulse": "user" }, planRoles: true, previz: true }
    let client = make(vi.fn().mockReturnValueOnce(mockOk(answer)))
    let got = await client.videoRemake.styleChoice()
    const offered: boolean | undefined = got.previz
    expect(offered).toBe(true)

    client = make(vi.fn().mockReturnValueOnce(mockOk({ engines: { "nodaro-prism": "user", "nodaro-pulse": "user" }, planRoles: true })))
    got = await client.videoRemake.styleChoice()
    expect(got.previz === true).toBe(false)
  })

  it("styleChoice passes planRolesPreviz through, one boolean; an older server has none", async () => {
    const answer: VideoRemakeStyleChoice = { engines: { "nodaro-prism": "user", "nodaro-pulse": "user" }, planRoles: true, previz: true, planRolesPreviz: true }
    let client = make(vi.fn().mockReturnValueOnce(mockOk(answer)))
    let got = await client.videoRemake.styleChoice()
    const offered: boolean | undefined = got.planRolesPreviz
    expect(offered).toBe(true)

    client = make(vi.fn().mockReturnValueOnce(mockOk({ engines: { "nodaro-prism": "user", "nodaro-pulse": "user" }, planRoles: true, previz: true })))
    got = await client.videoRemake.styleChoice()
    expect(got.planRolesPreviz === true).toBe(false)
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
