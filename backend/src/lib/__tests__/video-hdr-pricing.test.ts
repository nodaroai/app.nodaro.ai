// @test-always pure pre-checks and a pricing wrapper — reads no files
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { FastifyReply, FastifyRequest } from "fastify"

const addon = vi.hoisted(() => ({ base: vi.fn(async (_a: Record<string, unknown>) => 0) }))
vi.mock("../video-hdr-addon.js", () => ({ videoHdrAddonBaseCredits: addon.base }))
const scope = vi.hoisted(() => ({ parent: undefined as string | undefined }))
vi.mock("../job-submission-context.js", () => ({ trustedPluginParentJobId: () => scope.parent }))

import { dropHdrFromPluginChildPreHandler, refuseHdrAtUnsupportedResolutionPreHandler, withVideoHdrAddon } from "../video-hdr-pricing.js"
import { generateVideoPricing } from "../../routes/generate-video.js"
import { textToVideoPricing } from "../../routes/text-to-video.js"

function fakeReply() {
  const sent: { status?: number; body?: unknown } = {}
  const reply = {
    status(code: number) { sent.status = code; return reply },
    send(body: unknown) { sent.body = body; return reply },
  }
  return { reply: reply as unknown as FastifyReply, sent }
}
const reqOf = (body: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ body, ...extra }) as unknown as FastifyRequest

beforeEach(() => {
  addon.base.mockReset()
  addon.base.mockResolvedValue(0)
  scope.parent = undefined
})

describe("720p + HDR is refused before anything is held (both video routes, so a quote too)", () => {
  it("runs first among both routes' pre-checks, after the plugin-child strip", () => {
    for (const pricing of [generateVideoPricing, textToVideoPricing]) {
      const i = pricing.prechecks.indexOf(refuseHdrAtUnsupportedResolutionPreHandler)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(pricing.prechecks.indexOf(dropHdrFromPluginChildPreHandler)).toBe(i - 1)
    }
  })

  it("answers 400 for HDR at 720p, at an unlisted size and with no size (it renders 720p)", async () => {
    for (const resolution of ["720p", "720P", undefined, "480p"]) {
      const { reply, sent } = fakeReply()
      await refuseHdrAtUnsupportedResolutionPreHandler(reqOf({ provider: "kling-4", resolution, dynamicRange: "hdr" }), reply)
      expect(sent.status, String(resolution)).toBe(400)
      expect(sent.body).toEqual({ error: { code: "hdr_resolution_unsupported", message: "Kling 4.0 renders HDR at 1080p or 4k only, not 720p. Choose 1080p or 4k, or turn HDR off. Nothing was charged." } })
    }
  })

  it("lets HDR at 1080p / 4K, SDR at 720p and a model without HDR through", async () => {
    for (const body of [
      { provider: "kling-4", resolution: "1080p", dynamicRange: "hdr" },
      { provider: "kling-4-keyframes", resolution: "4k", dynamicRange: "hdr" },
      { provider: "kling-4", resolution: "720p", dynamicRange: "sdr" },
      { provider: "kling-4-flash", dynamicRange: "hdr" },
      { provider: "seedance-2-5", resolution: "720p", dynamicRange: "hdr" },
    ]) {
      const { reply, sent } = fakeReply()
      await refuseHdrAtUnsupportedResolutionPreHandler(reqOf(body), reply)
      expect(sent.status, JSON.stringify(body)).toBeUndefined()
    }
  })
})

describe("a plugin's own child never renders HDR (Generate Video Pro included)", () => {
  it("removes the field from a trusted plugin child's body", async () => {
    scope.parent = "parent-job"
    const req = reqOf({ provider: "kling-4", resolution: "4k", dynamicRange: "hdr" })
    await dropHdrFromPluginChildPreHandler(req)
    expect(req.body).toEqual({ provider: "kling-4", resolution: "4k" })
  })

  it("leaves every other caller's body as it came", async () => {
    const body = { provider: "kling-4", resolution: "4k", dynamicRange: "hdr" }
    const req = reqOf(body)
    await dropHdrFromPluginChildPreHandler(req)
    expect(req.body).toBe(body)
  })
})

describe("withVideoHdrAddon", () => {
  it("adds the add-on's base to whatever base the route priced, at the normalized size and length", async () => {
    addon.base.mockResolvedValue(180)
    const priced = withVideoHdrAddon(async () => 1240)
    const req = reqOf({}, { videoNorm: { resolution: "4k", duration: undefined, adjustments: [] } })
    await expect(priced({ provider: "kling-4", duration: 5, resolution: "4K", dynamicRange: "hdr" }, req)).resolves.toBe(1240 + 180)
    expect(addon.base).toHaveBeenCalledWith({ provider: "kling-4", duration: 5, resolution: "4k", dynamicRange: "hdr" })
  })

  it("an SDR run prices exactly as before", async () => {
    const priced = withVideoHdrAddon(async () => 540)
    await expect(priced({ provider: "kling-4", duration: 5, resolution: "1080p" }, reqOf({}))).resolves.toBe(540)
  })

  it("a quote notes the add-on and carries it in the expected cost", async () => {
    addon.base.mockResolvedValue(110)
    const priced = withVideoHdrAddon(async (_b, r) => {
      r.priceNotes = { ...r.priceNotes!, expectedBase: 400 }
      return 500
    })
    const req = reqOf({}, { priceNotes: { adjustments: [], warnings: [] } })
    await expect(priced({ provider: "kling-4", duration: 5, resolution: "1080p", dynamicRange: "hdr" }, req)).resolves.toBe(610)
    expect(req.priceNotes?.expectedBase).toBe(510)
    expect(req.priceNotes?.adjustments).toEqual([expect.objectContaining({ code: "hdr_addon", baseCredits: 110 })])
  })
})
