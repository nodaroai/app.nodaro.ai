import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// POST /v1/dubbing prices the dubbed span per minute. A source it can measure
// — an upload, or a link (a post through the social-post probe, any other
// link by ffprobe) — is reserved at its span. One it cannot measure holds the
// 30-minute ceiling and is marked so delivery settles it to the span dubbed.
// A sourceUrl is also an import of someone else's link: the gate reads it
// before anything touches it (the length probe included), and the job carries
// the confirmation and the way in for the worker to spend. Only a file of our
// own storage is not someone else's link.

const mocks = vi.hoisted(() => ({
  guardCalls: [] as Array<number | undefined>,
  probe: vi.fn(),
  postProbe: vi.fn(),
  requireImportAllowed: vi.fn(async (_url: string, _rights: Record<string, unknown>): Promise<void> => undefined),
  insert: vi.fn(),
  queueAdd: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({ insert: mocks.insert })),
    auth: { getUser: vi.fn() },
  },
}))
vi.mock("@/lib/insert-job.js", () => ({
  insertJob: vi.fn(async (_req: unknown, row: Record<string, unknown>) => {
    mocks.insert(row)
    return { data: { id: "job-1" }, error: null }
  }),
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mocks.queueAdd }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard:
    (_resolver: unknown, opts?: { computeCredits?: (body: unknown, req: unknown) => Promise<number> | number }) =>
    async (req: { body: unknown }) => {
      mocks.guardCalls.push(opts?.computeCredits ? await opts.computeCredits(req.body, req) : undefined)
    },
  reserveCreditsForJob: vi.fn(async () => ({ usageLogId: "u-1", creditsReserved: 1, watermark: false })),
}))
vi.mock("@/lib/credit-base-cost.js", () => ({
  baseCreditCostFor: vi.fn(async (id: string) => (id === "elevenlabs-dubbing" ? 40 : 999)),
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/url-validator.js", async (importOriginal) => {
  const { z } = await import("zod")
  return { ...(await importOriginal<Record<string, unknown>>()), safeUrlSchema: z.string().url() }
})
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: mocks.probe }))
vi.mock("@/services/workflow-engine/video-analysis-post-probe.js", () => ({ probeSocialPostDurationSec: mocks.postProbe }))
vi.mock("@/lib/import-gate.js", () => ({
  isImportRefusal: (e: unknown) => e instanceof Error && "code" in e,
  requireImportAllowed: mocks.requireImportAllowed,
}))

import { dubbingRoutes } from "../dubbing.js"
import { registerServerOnlyBodyKeysHook } from "../../middleware/server-only-body-keys.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
// The deployment's own storage (lib/own-storage-url.ts reads it from the env).
const OWN_STORAGE = "https://cdn.nodaro.test"
const ORIGINAL_PUBLIC_URL = process.env.R2_PUBLIC_URL
let app: FastifyInstance

afterAll(() => {
  if (ORIGINAL_PUBLIC_URL === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = ORIGINAL_PUBLIC_URL
})

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.guardCalls.length = 0
  mocks.requireImportAllowed.mockImplementation(async () => undefined)
  process.env.R2_PUBLIC_URL = OWN_STORAGE
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    // A request with no account behind it, as the auth hook would leave it.
    if (req.headers["x-no-account"] === "1") return
    req.userId = USER_ID
    // How the request signed in, as the auth hook would set it (the import's way in).
    const kind = req.headers["x-auth-kind"]
    if (typeof kind === "string") req.authKind = kind as typeof req.authKind
  })
  // As the app drops them: a body's server-only keys never reach the route.
  registerServerOnlyBodyKeysHook(app)
  await app.register(async (instance) => {
    await dubbingRoutes(instance)
  })
  await app.ready()
})

const post = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/dubbing", payload: { targetLanguage: "fr", ...payload } })
const inserted = () => mocks.insert.mock.calls[0]![0] as { input_data: Record<string, unknown> }
const queued = () => mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>

describe("POST /v1/dubbing — priced per minute of the dubbed span", () => {
  it("an upload of 6 min 41 s is reserved at 7 minutes (280 base)", async () => {
    mocks.probe.mockResolvedValue(401)
    const res = await post({ videoUrl: "https://cdn.example.com/v.mp4" })
    expect(res.statusCode).toBe(200)
    expect(mocks.guardCalls).toEqual([280])
    expect(inserted().input_data).toMatchObject({ probedDurationSec: 401 })
    expect(inserted().input_data.reservedCeiling).toBeUndefined()
  })

  it("a post link is measured through the social-post probe (95 s → 80 base)", async () => {
    mocks.postProbe.mockResolvedValue(95)
    const res = await post({ sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })
    expect(res.statusCode).toBe(200)
    expect(mocks.postProbe).toHaveBeenCalledOnce()
    expect(mocks.guardCalls).toEqual([80])
    expect(queued().probedDurationSec).toBe(95)
  })

  it("a direct media link is measured by ffprobe", async () => {
    mocks.probe.mockResolvedValue(150)
    const res = await post({ sourceUrl: "https://media.example.com/clip.mp4" })
    expect(res.statusCode).toBe(200)
    expect(mocks.probe).toHaveBeenCalledWith("https://media.example.com/clip.mp4")
    expect(mocks.guardCalls).toEqual([120])
  })

  it("a link that cannot be measured holds the 30-minute ceiling (1,200 base) and is marked to settle", async () => {
    mocks.probe.mockRejectedValue(new Error("not a media file"))
    const res = await post({ sourceUrl: "https://example.com/some-page" })
    expect(res.statusCode).toBe(200)
    expect(mocks.guardCalls).toEqual([1200])
    expect(inserted().input_data).toMatchObject({ reservedCeiling: true })
    expect(queued()).toMatchObject({ reservedCeiling: true })
  })

  it("a length the request states is never priced: a link that cannot be measured still holds the ceiling", async () => {
    mocks.probe.mockRejectedValue(new Error("not a media file"))
    const res = await post({ sourceUrl: "https://example.com/some-page", __probedDurationSec: 1 })
    expect(res.statusCode).toBe(200)
    expect(mocks.guardCalls).toEqual([1200])
    expect(inserted().input_data).toMatchObject({ reservedCeiling: true })
    expect(inserted().input_data.probedDurationSec).toBeUndefined()
    expect(queued()).toMatchObject({ reservedCeiling: true, probedDurationSec: undefined })
  })

  it("a length the request states is never priced: a measured upload is priced at its own length", async () => {
    mocks.probe.mockResolvedValue(401)
    const res = await post({ videoUrl: "https://cdn.example.com/v.mp4", __probedDurationSec: 1 })
    expect(res.statusCode).toBe(200)
    expect(mocks.guardCalls).toEqual([280])
    expect(inserted().input_data).toMatchObject({ probedDurationSec: 401 })
  })

  it("a link over 30 minutes is refused before anything is reserved", async () => {
    mocks.postProbe.mockResolvedValue(31 * 60)
    const res = await post({ sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })
    expect(res.statusCode).toBe(413)
    expect(mocks.guardCalls).toEqual([])
  })
})

describe("POST /v1/dubbing — a sourceUrl is an import of someone else's link", () => {
  const SOURCE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  const CONFIRMATION = "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01"

  it("the gate reads the link before the length probe, with the confirmation and the way in, and the job carries both", async () => {
    mocks.postProbe.mockResolvedValue(120)
    const res = await app.inject({
      method: "POST",
      url: "/v1/dubbing",
      headers: { "x-auth-kind": "api_token" },
      payload: { targetLanguage: "fr", sourceUrl: SOURCE, confirmationId: CONFIRMATION },
    })
    expect(res.statusCode).toBe(200)
    expect(mocks.requireImportAllowed).toHaveBeenCalledWith(SOURCE, expect.objectContaining({ userId: USER_ID, confirmationId: CONFIRMATION, lane: "route", via: "api" }))
    expect(mocks.requireImportAllowed.mock.invocationCallOrder[0]).toBeLessThan(mocks.postProbe.mock.invocationCallOrder[0]!)
    expect(queued()).toMatchObject({ sourceUrl: SOURCE, confirmationId: CONFIRMATION, importVia: "api" })
  })

  it("a refusal is a 403 before the link is probed or a job created", async () => {
    mocks.requireImportAllowed.mockRejectedValueOnce(Object.assign(new Error("Confirm that you hold the rights to this content before it is imported."), { code: "rights_confirmation_required" }))
    const res = await post({ sourceUrl: SOURCE })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("rights_confirmation_required")
    expect(mocks.postProbe).not.toHaveBeenCalled()
    expect(mocks.probe).not.toHaveBeenCalled()
    expect(mocks.guardCalls).toEqual([])
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("any link the service would fetch is held to the gate: any page, a direct file, a platform's page that ends like a file", async () => {
    mocks.probe.mockResolvedValue(60)
    const links = [
      "https://example.com/talks/keynote",
      "https://files.example.com/talk.mp4",
      "https://files.example.com/talk.mp3",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ.mp4",
    ]
    for (const sourceUrl of links) {
      const res = await post({ sourceUrl })
      expect(res.statusCode).toBe(200)
    }
    expect(mocks.requireImportAllowed.mock.calls.map((c) => c[0])).toEqual(links)
    for (const call of mocks.requireImportAllowed.mock.calls) expect(call[1]).toMatchObject({ userId: USER_ID })
  })

  it("a file of our own storage is ours: no gate, and no confirmation in the job", async () => {
    mocks.probe.mockResolvedValue(60)
    const res = await post({ sourceUrl: `${OWN_STORAGE}/uploads/clip-without-an-ending` })
    expect(res.statusCode).toBe(200)
    expect(mocks.requireImportAllowed).not.toHaveBeenCalled()
    expect(queued()).not.toHaveProperty("confirmationId")
  })

  it("a transform of the content network on our host can name a remote source: held to the gate", async () => {
    mocks.probe.mockResolvedValue(60)
    const sourceUrl = `${OWN_STORAGE}/cdn-cgi/media/mode=video/https://example.com/talks/keynote`
    const res = await post({ sourceUrl })
    expect(res.statusCode).toBe(200)
    expect(mocks.requireImportAllowed).toHaveBeenCalledWith(sourceUrl, expect.anything())
  })

  it("a request with no account is a 401 before the link is read or probed", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/dubbing",
      headers: { "x-no-account": "1" },
      payload: { targetLanguage: "fr", sourceUrl: SOURCE },
    })
    expect(res.statusCode).toBe(401)
    expect(mocks.requireImportAllowed).not.toHaveBeenCalled()
    expect(mocks.postProbe).not.toHaveBeenCalled()
    expect(mocks.probe).not.toHaveBeenCalled()
  })

  it("an upload never asks the gate", async () => {
    mocks.probe.mockResolvedValue(60)
    const res = await post({ videoUrl: "https://cdn.example.com/v.mp4" })
    expect(res.statusCode).toBe(200)
    expect(mocks.requireImportAllowed).not.toHaveBeenCalled()
  })

  it("a link two URL parsers would read differently is a 400 before the gate or the probe", async () => {
    for (const sourceUrl of ["https://www.youtube.com/watch?v=ab\ncd", "https://www.youtube.com\\@10.0.0.1/watch?v=abc"]) {
      const res = await post({ sourceUrl })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(mocks.requireImportAllowed).not.toHaveBeenCalled()
    expect(mocks.postProbe).not.toHaveBeenCalled()
    expect(mocks.probe).not.toHaveBeenCalled()
  })

  it("the link the gate judged is the link the probe reads and the job carries (the schema trims its ends)", async () => {
    mocks.postProbe.mockResolvedValue(120)
    const res = await post({ sourceUrl: `${SOURCE}\n` })
    expect(res.statusCode).toBe(200)
    expect(mocks.requireImportAllowed).toHaveBeenCalledWith(SOURCE, expect.anything())
    expect(mocks.postProbe.mock.calls[0]![0]).toBe(SOURCE)
    expect(queued()).toMatchObject({ sourceUrl: SOURCE })
  })

  it("a dub into Hebrew of a link is a 400 before the gate reads it or anything probes it", async () => {
    const res = await post({ targetLanguage: "he", sourceUrl: SOURCE, confirmationId: CONFIRMATION })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: "unsupported_dubbing_settings", message: expect.stringMatching(/uploaded audio or video file/) })
    expect(mocks.requireImportAllowed).not.toHaveBeenCalled()
    expect(mocks.postProbe).not.toHaveBeenCalled()
    expect(mocks.probe).not.toHaveBeenCalled()
  })

  it("a confirmation that is not an id is a 400 before the gate", async () => {
    const res = await post({ sourceUrl: SOURCE, confirmationId: "not-an-id" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(mocks.requireImportAllowed).not.toHaveBeenCalled()
  })
})
