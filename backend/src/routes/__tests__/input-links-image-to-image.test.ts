/**
 * RECORDING — what a generation route does with a reference picture given as
 * a link (/v1/image-to-image on FLUX Fill Pro, Cloud edition, the real credit
 * guard, the credit check replaced by spies). The picture and the mask are
 * handed to the provider, which fetches them. Recorded per deployment profile,
 * for pictures on another site and on this deployment's own storage: the
 * reply, the credit check, the row, the reservation and the queue.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { LEVER_INERT_PROFILES, OUTSIDE_HOST, OWN_STORAGE, REFUSE_PROFILE, REPORT_PROFILE, TODAYS_PROFILES, inputLinkLines, useProfile } from "../../lib/__tests__/helpers/input-link-profiles.js"

const h = vi.hoisted(() => ({
  creditCheck: vi.fn(),
  reserve: vi.fn(),
  insert: vi.fn(),
  queueAdd: vi.fn(),
  report: vi.fn(async (_input: Record<string, unknown>) => true),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", CHARACTER_LORA_ROUTING_ENABLED: true },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({ insert: h.insert, update: () => ({ eq: async () => ({ error: null }) }) })),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
  },
}))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: h.report }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: h.queueAdd }, redis: {} }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/llm-client.js", () => ({ llmComplete: vi.fn() }))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/ee/lib/credit-guard-impl.js", () => ({
  creditGuardImpl: () => h.creditCheck,
  reserveCreditsForJobImpl: h.reserve,
  checkPayerCanAffordImpl: vi.fn(),
  blockPaygOnConsumerSurface: vi.fn(),
  isWebFreeModeCandidate: vi.fn(() => false),
}))

import { imageToImageRoutes } from "../image-to-image.js"
import { registerInputLinkJudge } from "../../middleware/input-links.js"
import { __resetAvailabilityOverridesForTests } from "../../lib/availability-override.js"
import { __resetModelSwitchForTests } from "../../lib/model-switch.js"

const USER = "00000000-0000-4000-8000-000000000001"
const savedR2 = process.env.R2_PUBLIC_URL
const bodyOn = (host: string) => ({ imageUrl: `${host}/images/src.png`, prompt: "a red scarf", maskUrl: `${host}/images/mask.png`, provider: "flux-fill" })

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  process.env.R2_PUBLIC_URL = OWN_STORAGE
  h.creditCheck.mockResolvedValue(undefined)
  h.reserve.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 33, watermark: false })
  h.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) })
  h.queueAdd.mockResolvedValue({ id: "queue-job-1" })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
  })
  registerInputLinkJudge(app)
  await app.register(async (instance) => imageToImageRoutes(instance))
  await app.ready()
})

afterEach(async () => {
  await app.close()
  useProfile(undefined)
  __resetAvailabilityOverridesForTests()
  __resetModelSwitchForTests()
  if (savedR2 === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = savedR2
})

const run = (host: string) => app.inject({ method: "POST", url: "/v1/image-to-image", payload: bodyOn(host) })

/** The generation started as it always has, with the pictures handed on as sent. */
async function expectRan(host: string): Promise<void> {
  const res = await run(host)
  expect(res.statusCode, res.body).toBe(200)
  expect(h.creditCheck).toHaveBeenCalledTimes(1)
  expect(h.insert).toHaveBeenCalledTimes(1)
  expect(h.reserve).toHaveBeenCalledTimes(1)
  expect(h.queueAdd).toHaveBeenCalledTimes(1)
  const body = bodyOn(host)
  expect(h.queueAdd.mock.calls[0]![1]).toMatchObject({ provider: "flux-fill", maskUrl: body.maskUrl })
}

describe("recording: Image to Image with reference pictures given as links, before the input-link lever", () => {
  for (const { name, profile } of TODAYS_PROFILES) {
    it(`${name}: pictures on another site reach the provider`, async () => {
      useProfile(profile)
      await expectRan(OUTSIDE_HOST)
    })

    it(`${name}: pictures on this deployment's own storage reach the provider`, async () => {
      useProfile(profile)
      await expectRan(OWN_STORAGE)
    })
  }
})

describe("the input-link lever: nothing changes at allow, nor with link imports on", () => {
  for (const { name, profile } of LEVER_INERT_PROFILES) {
    it(`${name}: pictures on another site reach the provider, nothing reported`, async () => {
      useProfile(profile)
      const warn = vi.spyOn(console, "warn")
      await expectRan(OUTSIDE_HOST)
      expect(inputLinkLines(warn)).toEqual([])
      expect(h.report).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  }
})

describe("inputLinks: report — the generation runs exactly as before, and each link is recorded", () => {
  it("pictures on another site: one line per field, the host only", async () => {
    useProfile(REPORT_PROFILE.profile)
    const warn = vi.spyOn(console, "warn")
    await expectRan(OUTSIDE_HOST)
    expect(inputLinkLines(warn).sort()).toEqual([
      `[input-links] would-refuse route="POST /v1/image-to-image" field=imageUrl host=cdn.example user=${USER}`,
      `[input-links] would-refuse route="POST /v1/image-to-image" field=maskUrl host=cdn.example user=${USER}`,
    ])
    await vi.waitFor(() => expect(h.report.mock.calls.map((c) => (c[0] as { payload: { field: string } }).payload.field).sort()).toEqual(["imageUrl", "maskUrl"]))
    warn.mockRestore()
  })

  it("pictures on this deployment's own storage: nothing recorded", async () => {
    useProfile(REPORT_PROFILE.profile)
    const warn = vi.spyOn(console, "warn")
    await expectRan(OWN_STORAGE)
    expect(inputLinkLines(warn)).toEqual([])
    warn.mockRestore()
  })
})

describe("inputLinks: refuse — outside pictures are refused before the credit check, the row, the reservation or the provider", () => {
  it("pictures on another site: 403 link_imports_disabled; nothing checked, created, held or queued", async () => {
    useProfile(REFUSE_PROFILE.profile)
    const res = await run(OUTSIDE_HOST)
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: { code: "link_imports_disabled", message: "Importing media from a link to another site is turned off on this deployment. Upload the file instead." } })
    expect(h.creditCheck).not.toHaveBeenCalled()
    expect(h.insert).not.toHaveBeenCalled()
    expect(h.reserve).not.toHaveBeenCalled()
    expect(h.queueAdd).not.toHaveBeenCalled()
  })

  it("one picture outside is enough: a mask on another site refuses a picture on this deployment's storage", async () => {
    useProfile(REFUSE_PROFILE.profile)
    const res = await app.inject({ method: "POST", url: "/v1/image-to-image", payload: { ...bodyOn(OWN_STORAGE), maskUrl: `${OUTSIDE_HOST}/m.png` } })
    expect(res.statusCode).toBe(403)
    expect(h.queueAdd).not.toHaveBeenCalled()
  })

  it("pictures on this deployment's own storage (an upload, a generated result): run as before", async () => {
    useProfile(REFUSE_PROFILE.profile)
    await expectRan(OWN_STORAGE)
  })
})
