import { beforeEach, expect, it, vi } from "vitest"
import { markSettingsReadFailed } from "../../../lib/app-settings-read-status.js"

const h = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, plans: [] as unknown[], quoteAvailable: true }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => h.settings }))
vi.mock("@/lib/config.js", () => ({ config: { INTERNAL_ORCHESTRATOR_SECRET: "test-route-quote-secret-32-characters" } }))
const { setPluginServices, _resetPluginServicesForTests } = await import("../../../lib/private-plugins/services-registry.js")
const { rowlessRouteTokenOf } = await import("../../../lib/video-route-decision.js")
const { quoteUgcRoutedClip } = await import("../video-route-ugc.js")

beforeEach(() => {
  _resetPluginServicesForTests()
  h.plans = []
  h.quoteAvailable = true
  h.settings = { cost_markup_percent: 0, video_route_policy: { models: { "seedance-2-5": { route: "default", services: { "ugc-clip": "alternate" } } } } }
  setPluginServices({ alternateRoutes: {
    accepts: () => null, start: async () => ({ taskRef: "unused" }), poll: async () => ({ state: "running" }),
    quotePlan: (plan) => { h.plans.push(plan); return h.quoteAvailable ? { routeId: "test-route", usd: 0.2, billedSeconds: 5 } : null },
  } })
})

const args = { video: { tool: "generate_video", args: { model: "seedance-2-5", duration: 5, resolution: "720p" } }, takes: 2, nonVideoChargedCredits: 30, hasReferenceAudio: true }

it("holds each UGC take on its service override plus signed auxiliary work without inventing prompts", async () => {
  const quote = await quoteUgcRoutedClip(args)
  expect(quote).toMatchObject({ reserveChargedCredits: 230, segmentChargedCredits: [100, 100], feeChargedCredits: 0 })
  expect(rowlessRouteTokenOf(quote?.quote)).toMatchObject({ service: "ugc-clip", feeId: "ugc-clip", nonVideoChargedCreditsMax: 30, reserveChargedCredits: 230 })
  expect(h.plans).toEqual([{ model: "seedance-2-5", service: "ugc-clip", resolution: "720p", outputSec: 5, referenceVideoDurationsSec: [], generateAudio: false }])
})

it("leaves a default-service UGC run on ordinary pricing", async () => {
  h.settings = { video_route_policy: { models: {} } }
  expect(await quoteUgcRoutedClip(args)).toBeUndefined()
  expect(h.plans).toEqual([])
})

it("refuses a selected supplier that cannot quote instead of changing suppliers", async () => {
  h.quoteAvailable = false
  await expect(quoteUgcRoutedClip(args)).rejects.toThrow()
})

it("does not choose a supplier after a failed settings read", async () => {
  h.settings = {}
  markSettingsReadFailed(h.settings)
  await expect(quoteUgcRoutedClip(args)).rejects.toThrow()
  expect(h.plans).toEqual([])
})

it("refuses an unmeasured video reference instead of quoting it as an image-only take", async () => {
  await expect(quoteUgcRoutedClip({ ...args, video: { ...args.video, args: { ...args.video.args, reference_video_urls: ["https://example.test/reference.mp4"] } } })).rejects.toThrow()
})
