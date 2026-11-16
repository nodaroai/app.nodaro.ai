/**
 * RECORDING — a route that reads an input link's length without storing it
 * (POST /v1/media/clip-length, no credit guard). The measurement downloads the
 * clip on our server. Recorded per deployment profile, for a clip on another
 * site and one on this deployment's own storage: the reply, and whether a
 * measurement was asked for or started.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"
import type { ClipJobState } from "../../lib/clip-measure-job.js"
import { clipLengthRoutes } from "../clip-length.js"
import { LEVER_INERT_PROFILES, OUTSIDE_HOST, OWN_STORAGE, REFUSE_PROFILE, REPORT_PROFILE, TODAYS_PROFILES, inputLinkLines, useProfile } from "../../lib/__tests__/helpers/input-link-profiles.js"
import { registerInputLinkJudge } from "../../middleware/input-links.js"

const report = vi.hoisted(() => vi.fn(async (_input: Record<string, unknown>) => true))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: report }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/config.js")>()
  return { ...actual, isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true }
})

const OUTSIDE = `${OUTSIDE_HOST}/clip.mp4`
const OWN = `${OWN_STORAGE}/videos/clip.mp4`
const savedR2 = process.env.R2_PUBLIC_URL

const poll = vi.fn(async (_url: string): Promise<ClipJobState> => ({ status: "none" }))
const start = vi.fn(async (_url: string): Promise<ClipJobState> => ({ status: "running" }))
const startLimit = vi.fn(async (_req: FastifyRequest, _reply: FastifyReply) => undefined)
let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  process.env.R2_PUBLIC_URL = OWN_STORAGE
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = "user-1"
  })
  registerInputLinkJudge(app)
  await app.register(clipLengthRoutes({ videoModeLive: () => true, job: { poll, start }, startLimit }))
  await app.ready()
})

afterEach(async () => {
  await app.close()
  useProfile(undefined)
  if (savedR2 === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = savedR2
})

const measure = (videoUrl: string) => app.inject({ method: "POST", url: "/v1/media/clip-length", payload: { videoUrl } })

async function expectMeasured(videoUrl: string): Promise<void> {
  const res = await measure(videoUrl)
  expect(res.statusCode, res.body).toBe(202)
  expect(res.json()).toEqual({ data: { status: "running", retryAfterMs: 2000 } })
  expect(poll).toHaveBeenCalledWith(videoUrl)
  expect(start).toHaveBeenCalledWith(videoUrl)
}

describe("recording: Clip Length with an input link, before the input-link lever", () => {
  for (const { name, profile } of TODAYS_PROFILES) {
    it(`${name}: a clip on another site is measured`, async () => {
      useProfile(profile)
      await expectMeasured(OUTSIDE)
    })

    it(`${name}: a clip on this deployment's own storage is measured`, async () => {
      useProfile(profile)
      await expectMeasured(OWN)
    })
  }
})

describe("the input-link lever: nothing changes at allow, nor with link imports on", () => {
  for (const { name, profile } of LEVER_INERT_PROFILES) {
    it(`${name}: a clip on another site is measured, nothing reported`, async () => {
      useProfile(profile)
      const warn = vi.spyOn(console, "warn")
      await expectMeasured(OUTSIDE)
      expect(inputLinkLines(warn)).toEqual([])
      warn.mockRestore()
    })
  }
})

describe("inputLinks: report — measured exactly as before, and the link is recorded", () => {
  it("a clip on another site: one line, the host only", async () => {
    useProfile(REPORT_PROFILE.profile)
    const warn = vi.spyOn(console, "warn")
    await expectMeasured(OUTSIDE)
    expect(inputLinkLines(warn)).toEqual(['[input-links] would-refuse route="POST /v1/media/clip-length" field=videoUrl host=cdn.example user=user-1'])
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1))
    warn.mockRestore()
  })

  it("a clip on this deployment's own storage: nothing recorded", async () => {
    useProfile(REPORT_PROFILE.profile)
    const warn = vi.spyOn(console, "warn")
    await expectMeasured(OWN)
    expect(inputLinkLines(warn)).toEqual([])
    warn.mockRestore()
  })
})

describe("inputLinks: refuse — an outside clip is refused before it is measured", () => {
  it("a clip on another site: 403 link_imports_disabled; no measurement asked for or started", async () => {
    useProfile(REFUSE_PROFILE.profile)
    const res = await measure(OUTSIDE)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("link_imports_disabled")
    expect(poll).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it("a clip on this deployment's own storage: measured as before", async () => {
    useProfile(REFUSE_PROFILE.profile)
    await expectMeasured(OWN)
  })
})
