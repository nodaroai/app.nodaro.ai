/**
 * RECORDING — an entity write that stores a reference picture given as a link
 * (POST /v1/objects, no credit guard). Nothing is fetched here: the link is
 * stored on the object and read by the generations that use it later.
 * Recorded per deployment profile, for pictures on another site and on this
 * deployment's own storage: the reply and the row written.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { LEVER_INERT_PROFILES, OUTSIDE_HOST, OWN_STORAGE, REFUSE_PROFILE, REPORT_PROFILE, TODAYS_PROFILES, inputLinkLines, useProfile } from "../../lib/__tests__/helpers/input-link-profiles.js"

const h = vi.hoisted(() => ({ insert: vi.fn(), report: vi.fn(async (_input: Record<string, unknown>) => true) }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: h.report }))

vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/config.js")>()
  return { ...actual, isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true }
})
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(() => ({ insert: h.insert })) } }))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { objectRoutes } from "../objects.js"
import { registerInputLinkJudge } from "../../middleware/input-links.js"

const savedR2 = process.env.R2_PUBLIC_URL
let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  process.env.R2_PUBLIC_URL = OWN_STORAGE
  h.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "obj-1" }, error: null }) }) })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = "00000000-0000-4000-8000-000000000001"
  })
  registerInputLinkJudge(app)
  await app.register(async (instance) => objectRoutes(instance))
  await app.ready()
})

afterEach(async () => {
  await app.close()
  useProfile(undefined)
  if (savedR2 === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = savedR2
})

const create = (host: string) =>
  app.inject({
    method: "POST",
    url: "/v1/objects",
    payload: {
      nodeId: "node-1",
      name: "Lamp",
      sourceImageUrl: `${host}/images/lamp.png`,
      referencePhotos: [{ kind: "front", url: `${host}/images/lamp-front.png` }],
    },
  })

async function expectStored(host: string): Promise<void> {
  const res = await create(host)
  expect(res.statusCode, res.body).toBe(200)
  expect(res.json()).toEqual({ id: "obj-1" })
  expect(h.insert).toHaveBeenCalledTimes(1)
  expect(h.insert.mock.calls[0]![0]).toMatchObject({
    source_image_url: `${host}/images/lamp.png`,
    reference_photos: [{ kind: "front", url: `${host}/images/lamp-front.png` }],
  })
}

describe("recording: saving an object with reference pictures given as links, before the input-link lever", () => {
  for (const { name, profile } of TODAYS_PROFILES) {
    it(`${name}: pictures on another site are stored as given`, async () => {
      useProfile(profile)
      await expectStored(OUTSIDE_HOST)
    })

    it(`${name}: pictures on this deployment's own storage are stored as given`, async () => {
      useProfile(profile)
      await expectStored(OWN_STORAGE)
    })
  }
})

describe("the input-link lever: nothing changes at allow, nor with link imports on", () => {
  for (const { name, profile } of LEVER_INERT_PROFILES) {
    it(`${name}: pictures on another site are stored as given, nothing reported`, async () => {
      useProfile(profile)
      const warn = vi.spyOn(console, "warn")
      await expectStored(OUTSIDE_HOST)
      expect(inputLinkLines(warn)).toEqual([])
      warn.mockRestore()
    })
  }
})

describe("inputLinks: report — stored exactly as before, and each link is recorded", () => {
  it("pictures on another site: one line per field, the host only", async () => {
    useProfile(REPORT_PROFILE.profile)
    const warn = vi.spyOn(console, "warn")
    await expectStored(OUTSIDE_HOST)
    expect(inputLinkLines(warn).sort()).toEqual([
      '[input-links] would-refuse route="POST /v1/objects" field=referencePhotos[].url host=cdn.example user=00000000-0000-4000-8000-000000000001',
      '[input-links] would-refuse route="POST /v1/objects" field=sourceImageUrl host=cdn.example user=00000000-0000-4000-8000-000000000001',
    ])
    warn.mockRestore()
  })

  it("pictures on this deployment's own storage: nothing recorded", async () => {
    useProfile(REPORT_PROFILE.profile)
    const warn = vi.spyOn(console, "warn")
    await expectStored(OWN_STORAGE)
    expect(inputLinkLines(warn)).toEqual([])
    warn.mockRestore()
  })
})

describe("inputLinks: refuse — an object is not saved with pictures from another site", () => {
  it("pictures on another site: 403 link_imports_disabled; nothing written", async () => {
    useProfile(REFUSE_PROFILE.profile)
    const res = await create(OUTSIDE_HOST)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("link_imports_disabled")
    expect(h.insert).not.toHaveBeenCalled()
  })

  it("pictures on this deployment's own storage: stored as before", async () => {
    useProfile(REFUSE_PROFILE.profile)
    await expectStored(OWN_STORAGE)
  })
})
