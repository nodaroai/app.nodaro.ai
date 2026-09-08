/**
 * POST /v1/pro-3d-render and /v1/pro-3d-render/quote.
 *
 * This route's job is the set of refusals that cost nothing and the promise
 * that the SOURCE reaches the private engine unaltered. So that is what these
 * assert, and every refusal case also checks the negative: no job row, no
 * reservation, and — where ordering is the point — the engine never reached.
 *
 * The ones that matter most:
 *
 *  - a `{kind:'scene'}` source with NO `editPrompt` arrives with no
 *    `editPrompt`. That absence IS the render-only request, and a host that
 *    helpfully filled it in would convert a free export into a paid authoring
 *    run;
 *  - a run without a `quoteId` is refused, so nothing can execute at a price
 *    nobody produced, and quoting itself reserves nothing;
 *  - an install whose engine implements only one half of the operation is
 *    unavailable, rather than advertising a run nothing can quote;
 *  - an install with no CONFIGURED PRICE refuses before dispatch. This
 *    aggregates several paid stages and deliberately has no flat fallback
 *    cost, so the alternative to refusing is running at a number nobody chose.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  insertJob: vi.fn(),
  reserveCreditsForJob: vi.fn(),
  creditIds: [] as string[],
  basePrice: vi.fn(),
  denied: vi.fn(() => false),
}))

vi.mock("@/lib/surface-deny.js", () => ({
  isNodeDenied: mocks.denied,
  deniedNodeRejectionMessage: (types: string[]) => `Unavailable: ${types.join(", ")}`,
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", INTERNAL_ORCHESTRATOR_SECRET: "s".repeat(64), SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", SCENE3D_ADVANCED_ENABLED: true, SCENE3D_LOCAL_ENABLED: false },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: mocks.insertJob }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (resolver: (req: unknown) => string) => async (req: unknown) => { mocks.creditIds.push(resolver(req)) },
  reserveCreditsForJob: mocks.reserveCreditsForJob,
}))
// The rate limiter's only dependency is Redis; the behaviour under test is
// everything after it.
vi.mock("@/middleware/rate-limit.js", () => ({ rateLimiter: () => async () => {} }))
// The price lane runs through the REAL ee module with only the pricing lookup
// stubbed, so the 503 under test is the one the shipped `PriceNotConfiguredError`
// path produces rather than a hand-rolled imitation.
vi.mock("@/ee/billing/credits.js", async () => {
  const actual = await vi.importActual<typeof import("../../ee/billing/credits.js")>("../../ee/billing/credits.js")
  return { ...actual, getModelCreditBaseCost: mocks.basePrice }
})

import { config } from "../../lib/config.js"
import { setPluginEngines } from "../../lib/private-plugins/engine-registry.js"
import { pro3DRenderRoutes } from "../pro-3d-render.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const IMAGE = "https://r2.example/uploads/ref.png"
const KEY = "idem-key-abcdef0123"
const PROMPT_SOURCE = { kind: "prompt", prompt: "A red suitcase rolls behind a pillar" }
const SCENE_SOURCE = { kind: "scene", revisionId: "rev-1", sourceJobId: "job-1" }

let app: FastifyInstance

function proEngine(answer: unknown = { jobId: "pro-job" }) {
  return {
    capabilities: vi.fn().mockResolvedValue({
      version: "1", engines: ["blender-cloud"], sceneSchemaVersions: [2], maxRepairPasses: 2,
    }),
    generate: vi.fn(), edit: vi.fn(),
    proRender: vi.fn().mockResolvedValue(answer),
    quoteProRender: vi.fn().mockResolvedValue({
      quoteId: "quote-1", expiresAt: "2026-09-08T01:00:00.000Z", maxCredits: 900,
      breakdown: [], pricingVersion: "p1", capabilitiesVersion: "c1", normalizedInputHash: "hash-1",
    }),
  }
}

const post = (url: string, payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
  app.inject({
    method: "POST",
    url,
    headers: { authorization: "Bearer caller-token", "x-nodaro-workspace": "ws-1", ...headers },
    payload: { userId: USER_ID, ...payload },
  })

const run = (payload: Record<string, unknown>, headers: Record<string, string> = { "idempotency-key": KEY }) =>
  post("/v1/pro-3d-render", { source: PROMPT_SOURCE, quoteId: "quote-1", ...payload }, headers)

const quote = (payload: Record<string, unknown> = {}) =>
  post("/v1/pro-3d-render/quote", { source: PROMPT_SOURCE, ...payload })

/** Nothing was inserted, nothing was reserved. */
function spentNothing() {
  expect(mocks.insertJob).not.toHaveBeenCalled()
  expect(mocks.reserveCreditsForJob).not.toHaveBeenCalled()
  expect(mocks.creditIds).toEqual([])
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.denied.mockReturnValue(false)
  mocks.creditIds = []
  mocks.insertJob.mockResolvedValue({ data: { id: "job-1" }, error: null })
  mocks.reserveCreditsForJob.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false })
  mocks.basePrice.mockResolvedValue({ creditCost: 500, isEnabled: true, tierRestriction: null })
  setPluginEngines({})
  config.SCENE3D_ADVANCED_ENABLED = true
  config.SCENE3D_LOCAL_ENABLED = false

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(pro3DRenderRoutes)
  await app.ready()
})

describe("engine readiness gates both halves", () => {
  it("refuses with no engine installed, before any row or reservation", async () => {
    const res = await run({})
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("SCENE_CAPABILITY_UNAVAILABLE")
    spentNothing()
  })

  it("refuses an engine that can run but cannot quote", async () => {
    // A run needs a quoteId only `quoteProRender` can mint; half an engine is
    // an advertised operation nothing can start.
    const engine = { ...proEngine(), quoteProRender: undefined }
    setPluginEngines({ scene3d: engine as never })
    expect((await run({})).statusCode).toBe(503)
    expect((await quote()).statusCode).toBe(503)
    expect(engine.proRender).not.toHaveBeenCalled()
    spentNothing()
  })

  it("refuses an engine that can quote but cannot run", async () => {
    const engine = { ...proEngine(), proRender: undefined }
    setPluginEngines({ scene3d: engine as never })
    expect((await quote()).statusCode).toBe(503)
    expect(engine.quoteProRender).not.toHaveBeenCalled()
    spentNothing()
  })

  it("refuses while the advanced flag is off, even with a capable engine", async () => {
    config.SCENE3D_ADVANCED_ENABLED = false
    const engine = proEngine()
    setPluginEngines({ scene3d: engine })
    expect((await run({})).statusCode).toBe(503)
    expect(engine.proRender).not.toHaveBeenCalled()
    spentNothing()
  })
})

describe("the refusals that cost nothing", () => {
  it("enforces deployment denial for quote and run before reaching the engine", async () => {
    const engine = proEngine()
    setPluginEngines({ scene3d: engine })
    mocks.denied.mockReturnValue(true)
    for (const response of [await quote(), await run({})]) {
      expect(response.statusCode).toBe(403)
      expect(response.json().error.code).toBe("node_not_available")
    }
    expect(engine.capabilities).not.toHaveBeenCalled()
    expect(engine.quoteProRender).not.toHaveBeenCalled()
    expect(engine.proRender).not.toHaveBeenCalled()
    spentNothing()
  })
  let engine: ReturnType<typeof proEngine>
  beforeEach(() => {
    engine = proEngine()
    setPluginEngines({ scene3d: engine })
  })

  it("refuses a run with no quoteId — nothing executes at an unquoted price", async () => {
    const res = await post("/v1/pro-3d-render", { source: PROMPT_SOURCE }, { "idempotency-key": KEY })
    expect(res.statusCode).toBe(400)
    expect(engine.proRender).not.toHaveBeenCalled()
    spentNothing()
  })

  it("refuses a quote that smuggles a quoteId", async () => {
    expect((await quote({ quoteId: "quote-1" })).statusCode).toBe(400)
    expect(engine.quoteProRender).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", {}],
    ["too short", { "idempotency-key": "abc" }],
    ["too long", { "idempotency-key": "x".repeat(256) }],
  ])("refuses a run whose Idempotency-Key is %s", async (_label, headers) => {
    const res = await run({}, headers as Record<string, string>)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/Idempotency-Key/)
    expect(engine.proRender).not.toHaveBeenCalled()
    spentNothing()
  })

  it("refuses a source that mixes two branches", async () => {
    const res = await run({ source: { kind: "scene", revisionId: "r", sourceJobId: "j", prompt: "sneak" } })
    expect(res.statusCode).toBe(400)
    expect(engine.proRender).not.toHaveBeenCalled()
    spentNothing()
  })

  it("refuses an unknown source kind", async () => {
    expect((await run({ source: { kind: "glb-upload", url: "x" } })).statusCode).toBe(400)
    spentNothing()
  })

  it("refuses a blank source job when one is explicitly supplied", async () => {
    expect((await run({ source: { kind: "scene", revisionId: "rev-1", sourceJobId: " " } })).statusCode).toBe(400)
    spentNothing()
  })

  it("refuses an unavailable engine instead of downgrading it", async () => {
    // Local is off in this deployment, so both the engine choice and a desktop
    // export are refused — never quietly served by the cloud path.
    expect((await run({ engine: "blender-local" })).statusCode).toBe(503)
    expect((await run({ source: { kind: "local-export", exportId: "e1", connectionId: "c1" } })).statusCode).toBe(503)
    expect(engine.proRender).not.toHaveBeenCalled()
    spentNothing()
  })

  it("refuses a correction budget above the ceiling", async () => {
    expect((await run({ maxRepairPasses: 3 })).statusCode).toBe(400)
    expect((await run({ maxRepairPasses: -1 })).statusCode).toBe(400)
    spentNothing()
  })

  it("refuses an unknown scene schema declaration", async () => {
    expect((await run({ acceptedSceneSchemaVersions: [7] })).statusCode).toBe(400)
    spentNothing()
  })

  it("refuses a client that cannot read the schema a NEW scene mints", async () => {
    const res = await run({ acceptedSceneSchemaVersions: [1] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/schema version 2/)
    spentNothing()
  })

  it("does NOT demand v2 of a scene source — a retained v1 revision still renders", async () => {
    const res = await run({ source: SCENE_SOURCE, acceptedSceneSchemaVersions: [1] })
    expect(res.statusCode).toBe(200)
    expect(engine.proRender).toHaveBeenCalledTimes(1)
  })

  it("rejects a reference list the contract refuses", async () => {
    const res = await run({ source: { kind: "prompt", prompt: "x", references: [
      { id: "a", kind: "video", url: "https://r2.example/uploads/one.mp4" },
      { id: "b", kind: "video", url: "https://r2.example/uploads/two.mp4" },
    ] } })
    expect(res.statusCode).toBe(400)
    spentNothing()
  })

  it("requires authentication on both endpoints", async () => {
    for (const url of ["/v1/pro-3d-render", "/v1/pro-3d-render/quote"]) {
      expect((await app.inject({ method: "POST", url, payload: { source: PROMPT_SOURCE } })).statusCode).toBe(401)
    }
    spentNothing()
  })
})

describe("an unpriced install fails closed", () => {
  it("answers 503 on BOTH endpoints, before the private engine is reached", async () => {
    const engine = proEngine()
    setPluginEngines({ scene3d: engine })
    const { PriceNotConfiguredError } = await import("../../ee/billing/credits.js")
    mocks.basePrice.mockRejectedValue(new PriceNotConfiguredError("pro-3d-render"))

    for (const res of [await run({}), await quote()]) {
      expect(res.statusCode).toBe(503)
      expect(res.json().error.code).toBe("price_not_configured")
    }
    expect(engine.proRender).not.toHaveBeenCalled()
    expect(engine.quoteProRender).not.toHaveBeenCalled()
    spentNothing()
  })

  it("honours an operator who disabled the price", async () => {
    const engine = proEngine()
    setPluginEngines({ scene3d: engine })
    mocks.basePrice.mockResolvedValue({ creditCost: 500, isEnabled: false, tierRestriction: null })
    expect((await run({})).statusCode).toBe(503)
    expect(engine.proRender).not.toHaveBeenCalled()
    spentNothing()
  })
})

describe("delegation carries the request intact", () => {
  it("preserves input selectors for quote/run and refuses caller receipts", async () => {
    const engine = proEngine()
    setPluginEngines({ scene3d: engine })
    const asset = { id: "vehicle", revisionId: USER_ID, assetId: "00000000-0000-4000-8000-000000000011" }
    const source = { ...PROMPT_SOURCE, inputAssets: [asset] }
    expect((await quote({ source })).statusCode).toBe(200)
    expect((await run({ source })).statusCode).toBe(200)
    expect(engine.quoteProRender.mock.calls[0][0].body.source).toEqual(source)
    expect(engine.proRender.mock.calls[0][0].body.source).toEqual(source)
    expect((await quote({ source: { ...source, inputAssets: [{ ...asset, sha256: "a".repeat(64) }] } })).statusCode).toBe(400)
    expect(engine.quoteProRender).toHaveBeenCalledOnce()
    spentNothing()
  })
  it("delegates the parsed source and quote ID while preserving request context", async () => {
    const engine = proEngine()
    setPluginEngines({ scene3d: engine })
    expect((await quote({ source: { kind: "prompt", prompt: "  a suitcase  " } })).statusCode).toBe(200)
    expect(engine.quoteProRender.mock.calls[0][0].body.source.prompt).toBe("a suitcase")
    expect((await run({ source: { kind: "scene", revisionId: " rev-1 ", sourceJobId: " job-1 " }, quoteId: " quote-1 " })).statusCode).toBe(200)
    const request = engine.proRender.mock.calls[0][0]
    expect(request.body).toMatchObject({ source: SCENE_SOURCE, quoteId: "quote-1" })
    expect(request.body.source).not.toHaveProperty("editPrompt")
    expect(request.userId).toBe(USER_ID)
    expect(request.headers.authorization).toBe("Bearer caller-token")
  })
  let engine: ReturnType<typeof proEngine>
  beforeEach(() => {
    engine = proEngine()
    setPluginEngines({ scene3d: engine })
  })

  it("hands an authoring run to the engine with its references and controls", async () => {
    const references = [{ id: "look", kind: "image", role: "appearance", url: IMAGE }]
    const res = await run({
      source: { kind: "prompt", prompt: "A red suitcase rolls behind a pillar", references },
      durationSeconds: 30, fps: 24, aspectRatio: "21:9", maxRepairPasses: 1, quality: "standard", style: "clay",
    })
    expect(res.json()).toEqual({ jobId: "pro-job" })

    const req = engine.proRender.mock.calls[0][0]
    expect(req.userId).toBe(USER_ID)
    expect(req.headers["x-nodaro-workspace"]).toBe("ws-1")
    expect(req.headers["idempotency-key"]).toBe(KEY)
    expect(req.body.source).toEqual({ kind: "prompt", prompt: "A red suitcase rolls behind a pillar", references })
    // The table fixture's shape: 30 seconds at 21:9 must be expressible.
    expect(req.body).toMatchObject({ durationSeconds: 30, fps: 24, aspectRatio: "21:9", maxRepairPasses: 1, quoteId: "quote-1" })

    // The host reserves nothing: one parent reservation belongs to the runtime.
    expect(mocks.reserveCreditsForJob).not.toHaveBeenCalled()
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("preserves an ABSENT editPrompt — the render-only request survives the hop", async () => {
    await run({ source: SCENE_SOURCE })
    const body = engine.proRender.mock.calls[0][0].body
    expect(body.source).toEqual({ kind: "scene", revisionId: "rev-1", sourceJobId: "job-1" })
    expect("editPrompt" in body.source).toBe(false)
    // And nothing invented a brief to go with it.
    expect(body.source.prompt).toBeUndefined()
  })

  it("passes retained revisions without generation jobs to both canonical source resolvers", async () => {
    const source = { kind: "scene", revisionId: "manual-revision" }
    expect((await quote({ source })).statusCode).toBe(200)
    expect((await run({ source })).statusCode).toBe(200)
    expect(engine.quoteProRender.mock.calls[0][0].body.source).toEqual(source)
    expect(engine.proRender.mock.calls[0][0].body.source).toEqual(source)
  })

  it("passes an edit instruction through unchanged when there is one", async () => {
    await run({ source: { ...SCENE_SOURCE, editPrompt: "Move the camera left" } })
    expect(engine.proRender.mock.calls[0][0].body.source).toEqual({
      kind: "scene", revisionId: "rev-1", sourceJobId: "job-1", editPrompt: "Move the camera left",
    })
  })

  it("does not invent timing for a scene source that omitted it", async () => {
    await run({ source: SCENE_SOURCE })
    const body = engine.proRender.mock.calls[0][0].body
    for (const key of ["durationSeconds", "fps", "aspectRatio"]) {
      expect(body[key]).toBeUndefined()
    }
  })

  it("quotes the same body without spending anything", async () => {
    const res = await quote({ source: SCENE_SOURCE })
    expect(res.json()).toMatchObject({ quoteId: "quote-1", maxCredits: 900, normalizedInputHash: "hash-1" })
    expect(engine.quoteProRender).toHaveBeenCalledTimes(1)
    expect(engine.quoteProRender.mock.calls[0][0].body.source).toEqual(SCENE_SOURCE)
    expect(engine.proRender).not.toHaveBeenCalled()
    spentNothing()
  })
})
