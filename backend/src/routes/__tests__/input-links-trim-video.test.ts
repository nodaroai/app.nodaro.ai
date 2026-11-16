/**
 * RECORDING — what a processing route does with an input link (Trim Video,
 * Cloud edition, the real credit guard). The clip is measured before the
 * charge, so an outside link here is read by our server before anything is
 * held. Recorded per deployment profile, for a clip on another site and one on
 * this deployment's own storage: the reply, the measurement, the row, the
 * reservation and the queue.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { LEVER_INERT_PROFILES, OUTSIDE_HOST, OWN_STORAGE, REFUSE_PROFILE, REPORT_PROFILE, TODAYS_PROFILES, inputLinkLines, useProfile } from "../../lib/__tests__/helpers/input-link-profiles.js"

const h = vi.hoisted(() => ({
  probe: vi.fn(async (_url: string) => ({ width: 640, height: 360, durationSeconds: 12, fps: 24 })),
  reserve: vi.fn(async () => ({ usageLogId: "log-1", creditsReserved: 0, watermark: false })),
  insert: vi.fn((_row: Record<string, unknown>) => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "job-1" }, error: null }) }) })),
  queueAdd: vi.fn(async (_name: string, _payload: Record<string, unknown>) => ({ id: "queue-1" })),
  report: vi.fn(async (_input: Record<string, unknown>) => true),
}))

vi.mock("../../lib/config.js", () => ({ hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, isCloud: () => true, hasAdmin: () => true }))
vi.mock("../../lib/app-reports.js", () => ({ insertAppReport: h.report }))
vi.mock("../../lib/admin-check.js", () => ({ warmAdminCache: vi.fn() }))
vi.mock("../../lib/app-settings.js", () => ({ getAppSettings: vi.fn(() => Promise.resolve({ cost_markup_percent: 0 })) }))
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        const profile = { role: "user", tier: "standard", subscription_tier: "standard", subscription_credits: 1000, topup_credits: 0, daily_spent_credits: 0, last_daily_reset: null, storage_used_bytes: 0, storage_limit_bytes: 1e10 }
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: profile, error: null }) }) }) }
      }
      if (table === "jobs") return { insert: h.insert, update: vi.fn(() => ({ eq: () => Promise.resolve({ data: null, error: null }) })) }
      return {}
    }),
  },
}))
vi.mock("../../ee/billing/credits.js", () => ({
  CreditsService: {
    checkStorageLimitWithProfile: () => ({ allowed: true, usedBytes: 0, limitBytes: 1e10 }),
    checkCreditsWithProfile: vi.fn(() => Promise.resolve({ allowed: true, watermark: false })),
    reserveCredits: h.reserve,
  },
  getModelCreditBaseCost: vi.fn(async (_id: string) => ({ creditCost: 10, isEnabled: true, tierRestriction: null })),
}))
vi.mock("../../lib/queue.js", () => ({ videoQueue: { add: h.queueAdd } }))
vi.mock("../../lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({ probeVideoSource: h.probe, assertSafeProbeSource: async () => undefined }))
vi.mock("../../lib/video-utility-probe.js", () => ({
  probeClipLengthSec: async (src: string) => (await h.probe(src)).durationSeconds,
  probeClipReading: async (src: string) => {
    const p = await h.probe(src)
    return { sec: p.durationSeconds, fps: p.fps }
  },
  ClipUnreadableError: class ClipUnreadableError extends Error {},
}))

const OUTSIDE = `${OUTSIDE_HOST}/clip.mp4`
const OWN = `${OWN_STORAGE}/videos/clip.mp4`
const savedR2 = process.env.R2_PUBLIC_URL

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    ;(req as unknown as { userId: string }).userId = "u-1"
  })
  // The input-link judge, registered as app.ts registers it: after the auth hook, before every route.
  ;(await import("../../middleware/input-links.js")).registerInputLinkJudge(app)
  await (await import("../trim-video.js")).trimVideoRoutes(app)
  await app.ready()
  return app
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  process.env.R2_PUBLIC_URL = OWN_STORAGE
  app = await buildApp()
})

afterEach(async () => {
  await app.close()
  useProfile(undefined)
  if (savedR2 === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = savedR2
})

const trim = (videoUrl: string) => app.inject({ method: "POST", url: "/v1/trim-video", payload: { videoUrl, trimMode: "time", startTime: 0, endTime: 4 } })

/** The run started as it always has: measured, a row, a reservation, a queued job. */
function expectRan(res: Awaited<ReturnType<typeof trim>>, videoUrl: string): void {
  expect(res.statusCode, res.body).toBe(200)
  expect(res.json()).toEqual({ jobId: "job-1" })
  expect(h.probe).toHaveBeenCalledWith(videoUrl)
  expect(h.insert).toHaveBeenCalledTimes(1)
  expect(h.reserve).toHaveBeenCalledTimes(1)
  expect(h.queueAdd).toHaveBeenCalledTimes(1)
  expect(h.queueAdd.mock.calls[0]![1]).toMatchObject({ videoUrl })
}

describe("recording: Trim Video with an input link, before the input-link lever", () => {
  for (const { name, profile } of TODAYS_PROFILES) {
    it(`${name}: a clip on another site is measured and runs`, async () => {
      useProfile(profile)
      expectRan(await trim(OUTSIDE), OUTSIDE)
    })

    it(`${name}: a clip on this deployment's own storage is measured and runs`, async () => {
      useProfile(profile)
      expectRan(await trim(OWN), OWN)
    })
  }
})

describe("the input-link lever: nothing changes at allow, nor with link imports on", () => {
  for (const { name, profile } of LEVER_INERT_PROFILES) {
    it(`${name}: a clip on another site is measured and runs, and nothing is reported`, async () => {
      useProfile(profile)
      const warn = vi.spyOn(console, "warn")
      expectRan(await trim(OUTSIDE), OUTSIDE)
      expect(inputLinkLines(warn)).toEqual([])
      expect(h.report).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  }
})

describe("inputLinks: report — the request runs exactly as before, and the link is recorded", () => {
  it("a clip on another site: measured and run as before, one line naming the route, the field and the host", async () => {
    useProfile(REPORT_PROFILE.profile)
    const warn = vi.spyOn(console, "warn")
    expectRan(await trim(`${OUTSIDE}?token=secret`), `${OUTSIDE}?token=secret`)
    const lines = inputLinkLines(warn)
    expect(lines).toEqual(['[input-links] would-refuse route="POST /v1/trim-video" field=videoUrl host=cdn.example user=u-1'])
    expect(lines.join("\n")).not.toMatch(/clip\.mp4|secret/)
    // The admin's counter: one report, the host only.
    await vi.waitFor(() => expect(h.report).toHaveBeenCalledTimes(1))
    expect(h.report.mock.calls[0]![0]).toMatchObject({ kind: "input-link-report", userId: "u-1", payload: { mode: "report", name: "POST /v1/trim-video", field: "videoUrl", host: "cdn.example", count: 1 } })
    expect(JSON.stringify(h.report.mock.calls[0]![0])).not.toMatch(/clip\.mp4|secret/)
    warn.mockRestore()
  })

  it("a clip on this deployment's own storage: run as before, nothing recorded", async () => {
    useProfile(REPORT_PROFILE.profile)
    const warn = vi.spyOn(console, "warn")
    expectRan(await trim(OWN), OWN)
    expect(inputLinkLines(warn)).toEqual([])
    expect(h.report).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe("inputLinks: refuse — an outside clip is refused before anything is measured, created, held or queued", () => {
  it("a clip on another site: 403 link_imports_disabled, the switch's own message; nothing measured, no row, no reservation, no job", async () => {
    useProfile(REFUSE_PROFILE.profile)
    const warn = vi.spyOn(console, "warn")
    const res = await trim(OUTSIDE)
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: { code: "link_imports_disabled", message: "Importing media from a link to another site is turned off on this deployment. Upload the file instead." } })
    expect(h.probe).not.toHaveBeenCalled()
    expect(h.insert).not.toHaveBeenCalled()
    expect(h.reserve).not.toHaveBeenCalled()
    expect(h.queueAdd).not.toHaveBeenCalled()
    expect(inputLinkLines(warn)).toEqual(['[input-links] refused route="POST /v1/trim-video" field=videoUrl host=cdn.example user=u-1'])
    await vi.waitFor(() => expect(h.report).toHaveBeenCalledTimes(1))
    expect(h.report.mock.calls[0]![0]).toMatchObject({ kind: "input-link-refused", payload: { mode: "refuse", host: "cdn.example" } })
    warn.mockRestore()
  })

  it("an upload — a clip on this deployment's own storage: measured and run as before", async () => {
    useProfile(REFUSE_PROFILE.profile)
    expectRan(await trim(OWN), OWN)
  })
})
