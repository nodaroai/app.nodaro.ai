/**
 * The Suno routes on V4_5PLUS, V4_5ALL and V4_5 under a deployment's model
 * restriction (decided 2026-11-12). Each version has a model-catalog entry
 * (`suno-v4_5plus`, `suno-v4_5all`, `suno-v4_5`), so `models.allow` names it
 * like any other Suno version: a list that leaves one out refuses it with
 * `model_not_available` at the credit guard's door, before the credit check,
 * the job row or the queue; a list that names it, and a deployment with no
 * restriction, run it — a generate, cover or extend under the version's own
 * row, every other operation under its own.
 *
 * The real routes and the real credit guard (Cloud edition). The credit check
 * itself (`ee/lib/credit-guard-impl.ts`) is replaced by spies, so a refusal is
 * proven to come before it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  creditCheck: vi.fn(),
  reserve: vi.fn(),
  insert: vi.fn(),
  queueAdd: vi.fn(),
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
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: h.queueAdd }, redis: {} }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/url-validator.js", async (importOriginal) => {
  const { z } = await import("zod")
  return { ...(await importOriginal<typeof import("../../lib/url-validator.js")>()), safeUrlSchema: z.string().url() }
})
vi.mock("@/ee/lib/credit-guard-impl.js", () => ({
  creditGuardImpl: () => h.creditCheck,
  reserveCreditsForJobImpl: h.reserve,
  checkPayerCanAffordImpl: vi.fn(),
  blockPaygOnConsumerSurface: vi.fn(),
  isWebFreeModeCandidate: vi.fn(() => false),
}))

import { sunoRoutes } from "../suno.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { __resetAvailabilityOverridesForTests, GATEABLE_MODEL_IDS } from "../../lib/availability-override.js"
import { __resetModelSwitchForTests } from "../../lib/model-switch.js"
import { deniedModelRejectionMessage } from "../../lib/surface-deny.js"

const USER = "00000000-0000-4000-8000-000000000001"
const AUDIO = "https://cdn.example.com/track.mp3"
/** Each version and the catalog entry a restriction names it by. */
const VERSIONS = { V4_5PLUS: "suno-v4_5plus", V4_5ALL: "suno-v4_5all", V4_5: "suno-v4_5" } as const
const CURRENT = ["suno-v6", "suno-v6_wild", "suno-v6_mini"]

/** A body each route accepts, the operation's row, and whether the row follows the version. */
const ROUTES: ReadonlyArray<{ op: string; body: Record<string, unknown>; versionPriced: boolean }> = [
  { op: "generate", body: { prompt: "an upbeat song about the sea" }, versionPriced: true },
  { op: "cover", body: { prompt: "a slow acoustic cover", uploadUrl: AUDIO }, versionPriced: true },
  { op: "extend", body: { audioId: "track-1", prompt: "keep going", continueAt: 30 }, versionPriced: true },
  { op: "mashup", body: { uploadUrlList: [AUDIO, "https://cdn.example.com/track-2.mp3"] }, versionPriced: false },
  { op: "upload-extend", body: { uploadUrl: AUDIO, continueAt: 30 }, versionPriced: false },
]

function setProfile(json: unknown): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(json)
  __resetSurfaceProfileCacheForTests()
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.creditCheck.mockResolvedValue(undefined)
  h.reserve.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 33, watermark: false })
  h.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) })
  h.queueAdd.mockResolvedValue({ id: "queue-job-1" })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
  })
  await app.register(async (instance) => sunoRoutes(instance))
  await app.ready()
})

afterEach(async () => {
  await app.close()
  setProfile(null)
  __resetAvailabilityOverridesForTests()
  __resetModelSwitchForTests()
})

const run = (op: string, body: Record<string, unknown>) => app.inject({ method: "POST", url: `/v1/suno/${op}`, payload: body })

function expectNothingStarted(): void {
  expect(h.creditCheck).not.toHaveBeenCalled()
  expect(h.insert).not.toHaveBeenCalled()
  expect(h.reserve).not.toHaveBeenCalled()
  expect(h.queueAdd).not.toHaveBeenCalled()
}

describe("the Suno routes on V4_5PLUS, V4_5ALL and V4_5 under models.allow", () => {
  for (const [version, catalogId] of Object.entries(VERSIONS)) {
    for (const route of ROUTES) {
      const row = route.versionPriced ? catalogId : `suno-${route.op}`
      it(`${route.op} @ ${version}: an allow list that does not name ${catalogId} refuses it with model_not_available, before anything starts`, async () => {
        setProfile({ models: { allow: CURRENT } })
        const res = await run(route.op, { ...route.body, model: version })
        expect(res.statusCode).toBe(403)
        expect(res.json()).toEqual({ error: { code: "model_not_available", message: deniedModelRejectionMessage([catalogId]) } })
        expectNothingStarted()
      })

      it(`${route.op} @ ${version}: an allow list that names it runs it under ${row}`, async () => {
        setProfile({ models: { allow: [...CURRENT, catalogId] } })
        const res = await run(route.op, { ...route.body, model: version })
        expect(res.statusCode, res.body).toBe(200)
        expect(h.reserve).toHaveBeenCalledTimes(1)
        expect(h.reserve.mock.calls[0]![3]).toBe(row)
        expect(h.queueAdd.mock.calls[0]![1]).toMatchObject({ model: version })
      })
    }
  }

  it("add-instrumental and add-vocals on V4_5PLUS: refused when the list leaves it out, run under their own row when it names it", async () => {
    for (const op of ["add-instrumental", "add-vocals"]) {
      setProfile({ models: { allow: CURRENT } })
      const refused = await run(op, { taskId: "task-1", audioId: "track-1", model: "V4_5PLUS" })
      expect(refused.statusCode, op).toBe(403)
      expect(refused.json().error.code, op).toBe("model_not_available")
      expectNothingStarted()
      setProfile({ models: { allow: [...CURRENT, "suno-v4_5plus"] } })
      const ran = await run(op, { taskId: "task-1", audioId: "track-1", model: "V4_5PLUS" })
      expect(ran.statusCode, op).toBe(200)
      expect(h.reserve.mock.calls.at(-1)![3], op).toBe(`suno-${op}`)
      vi.clearAllMocks()
      h.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) })
      h.reserve.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 33, watermark: false })
    }
  })

  it("the same allow list runs the current versions (the refusal is the unlisted version's alone)", async () => {
    setProfile({ models: { allow: CURRENT } })
    const res = await run("generate", { prompt: "an upbeat song about the sea", model: "V6_MINI" })
    expect(res.statusCode).toBe(200)
    expect(h.reserve.mock.calls[0]![3]).toBe("suno-v6_mini")
  })

  it("an Admin → Availability models override saved before they were listed withholds them", async () => {
    __resetAvailabilityOverridesForTests({ models: new Set([...GATEABLE_MODEL_IDS].filter((id) => !(Object.values(VERSIONS) as string[]).includes(id))) })
    for (const version of Object.keys(VERSIONS)) {
      const res = await run("generate", { prompt: "an upbeat song about the sea", model: version })
      expect(res.statusCode, version).toBe(403)
      expect(res.json().error.code, version).toBe("model_not_available")
    }
    expectNothingStarted()
  })
})
