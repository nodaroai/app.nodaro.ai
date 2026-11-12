/**
 * Nodaro Image Upscale (a house model) on `/v1/edit-image`: its image through
 * the copy helper, priced by its OUTPUT's size.
 *
 * The preHandler asks whether the model is served, copies the image to our
 * storage under the lane row's 20 MB limit (or, for a quote, checks it with
 * nothing stored), measures it there, refuses an output past the limits or one
 * the plugin finds no run for, and stamps the tier the guard's CHECK and the
 * handler's DEBIT both price — the guard here runs the REAL resolver on the
 * REAL request, after the preHandler, so CHECK is the value a live guard
 * computes. The stored URL is what is inserted and sent. An unreadable size
 * holds the bare id. Each refusal of the image reads as the helper or the
 * deployment wrote it. Topaz keeps refusing a factor of 8, as the enum did.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), auth: { getUser: vi.fn() } },
}))

vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) },
  redis: {},
}))

// The guard as the real one runs a route's own step: its gates first (a
// refusal there is `refuseBefore`), then `beforePricing` (which may answer the
// request), then the resolver (CHECK).
const guardHarness = vi.hoisted(() => ({ checked: [] as string[], refuseBefore: undefined as { status: number; code: string } | undefined }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (
    resolver: (req: FastifyRequest) => string,
    opts?: { beforePricing?: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> },
  ) => async (req: FastifyRequest, reply: FastifyReply) => {
    if (guardHarness.refuseBefore) {
      return reply.status(guardHarness.refuseBefore.status).send({ error: { code: guardHarness.refuseBefore.code, message: "refused" } })
    }
    if (opts?.beforePricing) {
      await opts.beforePricing(req, reply)
      if (reply.sent) return
    }
    guardHarness.checked.push(resolver(req))
  },
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 5, watermark: false }),
}))

vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

// The image's size: what the copy's `inspect` read (undefined = could not be read).
const probe = vi.hoisted(() => ({ size: undefined as { width: number; height: number } | undefined }))
vi.mock("@/lib/image-source-size.js", () => ({
  probeImageDisplaySize: vi.fn(async () => undefined),
  sourceImageForAutoAspect: vi.fn(async () => undefined),
}))

// The copy helper: a stored copy with its bytes, its size read by `inspect`.
const STORED = "https://storage.example/tmp/provider-input/outside-input-1.png"
const helper = vi.hoisted(() => ({ refusal: undefined as Error | undefined }))
vi.mock("@/lib/outside-input-copy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/outside-input-copy.js")>()
  return {
    ...actual,
    copyOutsideInput: vi.fn(async () => {
      if (helper.refusal) throw helper.refusal
      return { url: "https://storage.example/tmp/provider-input/outside-input-1.png", bytes: 123_456, copied: true, ...(probe.size ? { inspected: probe.size } : {}) }
    }),
    inspectOutsideInput: vi.fn(async () => {
      if (helper.refusal) throw helper.refusal
      return { bytes: 123_456, outside: true, ...(probe.size ? { inspected: probe.size } : {}) }
    }),
  }
})

// The seam: served, and the plugin's plan.
const seam = vi.hoisted(() => ({ served: true, plan: { providerCostUsd: 0.01 } as { providerCostUsd: number } | null }))
vi.mock("@/lib/house-models.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/house-models.js")>()
  return {
    ...actual,
    houseModelServed: vi.fn(() => seam.served),
    planHouseModelRun: vi.fn(() => seam.plan),
  }
})

import { editImageRoutes } from "../edit-image.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import {
  OutsideInputBusyError,
  OutsideInputFailedError,
  OutsideInputInspectRefusedError,
  OutsideInputTimedOutError,
  OutsideInputTooLargeError,
  OutsideInputUnreadableError,
  OutsideInputWrongKindError,
  copyOutsideInput,
  inspectOutsideInput,
} from "../../lib/outside-input-copy.js"
import { LinkImportsDisabledError } from "../../lib/link-imports.js"
import { planHouseModelRun } from "../../lib/house-models.js"

const USER = "00000000-0000-4000-8000-000000000001"
const IMAGE = "https://cdn.example/photo.png"

let app: FastifyInstance

const insert = vi.fn()

beforeEach(async () => {
  vi.clearAllMocks()
  guardHarness.checked = []
  guardHarness.refuseBefore = undefined
  probe.size = { width: 1024, height: 1024 }
  helper.refusal = undefined
  seam.served = true
  seam.plan = { providerCostUsd: 0.01 }
  insert.mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }) }) })
  vi.mocked(supabase.from).mockReturnValue({ insert } as never)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
    if (body?.quoteOnly === true) req.quoteOnly = true
  })
  await app.register(async (instance) => {
    await editImageRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function post(body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/v1/edit-image", payload: { userId: USER, imageUrl: IMAGE, ...body } })
}

const debit = () => vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3]
const check = () => guardHarness.checked.at(-1)
const inserted = () => (insert.mock.calls.at(-1)?.[0] as { input_data?: Record<string, unknown> } | undefined)?.input_data
const enqueued = () => vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined

describe("Nodaro Image Upscale reserves the tier of the output it will make (CHECK === DEBIT)", () => {
  // The docs' worked examples: a 1024 × 1024 picture.
  it.each([
    ["1", "nodaro-image-upscale:2K"],
    ["2", "nodaro-image-upscale:2K"],
    ["4", "nodaro-image-upscale:4K"],
    ["8", "nodaro-image-upscale:8K"],
  ])("1024 × 1024 at %sx → %s", async (factor, creditId) => {
    const res = await post({ provider: "nodaro-image-upscale", upscaleFactor: factor })
    expect(res.statusCode).toBe(200)
    expect(check()).toBe(creditId)
    expect(debit()).toBe(creditId)
    // The stored image, its bytes, its output's size and the id it reserved ride to
    // the worker and onto the job alike, beside the caller's own link, so only a hold is settled.
    const pixels = (1024 * Number(factor)) ** 2
    const stamp = {
      imageUrl: IMAGE,
      nodaroImageUpscaleStoredUrl: STORED,
      nodaroImageUpscaleInputBytes: 123_456,
      nodaroImageUpscaleOutputPixels: pixels,
      nodaroImageUpscaleCreditId: creditId,
    }
    expect(enqueued()).toMatchObject({ provider: "nodaro-image-upscale", upscaleFactor: factor, ...stamp })
    expect(inserted()).toMatchObject(stamp)
    // The plugin was asked for exactly this run.
    expect(planHouseModelRun).toHaveBeenLastCalledWith("nodaro-image-upscale", { imageUrl: STORED, factor, outputPixels: pixels })
  })

  it("no factor: renders and is priced at 2x, and the factor is always sent", async () => {
    const res = await post({ provider: "nodaro-image-upscale" })
    expect(res.statusCode).toBe(200)
    expect(debit()).toBe("nodaro-image-upscale:2K")
    expect(enqueued()?.upscaleFactor).toBe("2")
  })

  it("exactly at a boundary stays in the tier; one pixel over is the next", async () => {
    probe.size = { width: 2048, height: 2048 } // 1x: 4,194,304 px
    await post({ provider: "nodaro-image-upscale", upscaleFactor: "1" })
    expect(debit()).toBe("nodaro-image-upscale:2K")
    probe.size = { width: 2048, height: 2049 } // 1x: 4,196,352 px
    await post({ provider: "nodaro-image-upscale", upscaleFactor: "1" })
    expect(debit()).toBe("nodaro-image-upscale:4K")
  })

  it("a stored tier from another model never prices it", async () => {
    await post({ provider: "nodaro-image-upscale", upscaleFactor: "2", targetResolution: "8K" })
    expect(check()).toBe("nodaro-image-upscale:2K")
    expect(debit()).toBe("nodaro-image-upscale:2K")
  })

  it("an unreadable size holds the bare id, at the check and the reservation", async () => {
    probe.size = undefined
    const res = await post({ provider: "nodaro-image-upscale", upscaleFactor: "4" })
    expect(res.statusCode).toBe(200)
    expect(check()).toBe("nodaro-image-upscale")
    expect(debit()).toBe("nodaro-image-upscale")
    expect(enqueued()?.nodaroImageUpscaleCreditId).toBe("nodaro-image-upscale")
    expect(enqueued()).not.toHaveProperty("nodaroImageUpscaleOutputPixels")
  })
})

describe("the image goes through the copy helper before anything is measured", () => {
  it("copied under the lane row's limit, with its size read from the copy; the stored copy is what runs, the caller's link is kept", async () => {
    await post({ provider: "nodaro-image-upscale", upscaleFactor: "2" })
    expect(copyOutsideInput).toHaveBeenCalledWith(IMAGE, expect.objectContaining({ kind: "image", maxBytes: 20_000_000, userId: USER, inspect: expect.any(Function) }))
    expect(inspectOutsideInput).not.toHaveBeenCalled()
    // Re-runs, the MCP flows and the job's input display read `imageUrl`: the scratch copy is swept.
    expect(enqueued()?.imageUrl).toBe(IMAGE)
    expect(inserted()?.imageUrl).toBe(IMAGE)
    expect(enqueued()?.nodaroImageUpscaleStoredUrl).toBe(STORED)
    expect(inserted()?.nodaroImageUpscaleStoredUrl).toBe(STORED)
  })

  it.each([
    ["an app token without a spending scope", { status: 403, code: "insufficient_scope" }],
    ["a repeated Idempotency-Key (the guard answers the earlier job)", { status: 200, code: "deduped" }],
    ["a model or node the deployment withholds", { status: 403, code: "model_not_available" }],
  ])("%s is answered by the guard's gates before anything is copied", async (_name, refusal) => {
    guardHarness.refuseBefore = refusal
    await post({ provider: "nodaro-image-upscale", upscaleFactor: "2" })
    expect(copyOutsideInput).not.toHaveBeenCalled()
    expect(inspectOutsideInput).not.toHaveBeenCalled()
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("a quote checks the image with nothing stored, on the caller's URL", async () => {
    await post({ provider: "nodaro-image-upscale", upscaleFactor: "2", quoteOnly: true })
    expect(inspectOutsideInput).toHaveBeenCalledWith(IMAGE, expect.objectContaining({ kind: "image", maxBytes: 20_000_000, userId: USER }))
    expect(copyOutsideInput).not.toHaveBeenCalled()
    expect(check()).toBe("nodaro-image-upscale:2K")
  })

  it("a deployment that does not serve the model copies nothing (the guard refuses it as any withheld model)", async () => {
    seam.served = false
    await post({ provider: "nodaro-image-upscale", upscaleFactor: "2" })
    expect(copyOutsideInput).not.toHaveBeenCalled()
    expect(check()).toBe("nodaro-image-upscale")
  })

  it("a run the plugin finds no plan for is refused before anything is reserved", async () => {
    seam.plan = null
    const res = await post({ provider: "nodaro-image-upscale", upscaleFactor: "2" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "validation_error", message: "Nodaro Image Upscale cannot make this run with these settings." })
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it.each([
    ["the deployment turned outside links off: its own refusal, unchanged", () => new LinkImportsDisabledError(), 403, "link_imports_disabled", "Importing media from a link to another site is turned off on this deployment. Upload the file instead."],
    ["too large", () => new OutsideInputTooLargeError(20_000_000), 400, "input_too_large", "The file is larger than the 20 MB this step takes."],
    ["not an image", () => new OutsideInputWrongKindError("image"), 400, "input_wrong_kind", "The file is not an image this step can read."],
    ["unreadable link", () => new OutsideInputUnreadableError(), 400, "input_unreadable", "The file could not be read from its link."],
    ["its size could not be read", () => new OutsideInputInspectRefusedError(new Error("bad")), 400, "input_refused", "Nodaro Image Upscale could not read this image's size. Send a PNG, JPEG or WebP image."],
    ["too many fetches (try again)", () => new OutsideInputBusyError(), 429, "input_busy", "Too many files are being fetched right now. Try again in a moment."],
    ["reading took too long (try again)", () => new OutsideInputTimedOutError(), 503, "input_timed_out", "Reading the file took too long. Try again in a moment."],
    ["storage failed (try again)", () => new OutsideInputFailedError(), 503, "input_failed", "The file could not be prepared. Try again in a moment."],
  ])("%s → %i %s, nothing reserved", async (_name, make, status, code, message) => {
    helper.refusal = make()
    const res = await post({ provider: "nodaro-image-upscale", upscaleFactor: "2" })
    expect(res.statusCode).toBe(status)
    expect(res.json().error).toEqual({ code, message })
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })
})

describe("an output past the limits is refused before anything is reserved", () => {
  it("past 67,108,864 pixels (1100 × 1100 at 8x)", async () => {
    probe.size = { width: 1100, height: 1100 }
    const res = await post({ provider: "nodaro-image-upscale", upscaleFactor: "8" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "image_too_large", message: expect.stringContaining("8,800 × 8,800") })
    expect(guardHarness.checked).toEqual([])
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("past 16,384 a side under the pixel limit (2100 × 400 at 8x)", async () => {
    probe.size = { width: 2100, height: 400 }
    const res = await post({ provider: "nodaro-image-upscale", upscaleFactor: "8" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("image_too_large")
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })
})

describe("each model takes only its own factors", () => {
  it("Topaz still refuses 8 with a validation error, as its enum did", async () => {
    const res = await post({ provider: "topaz-image-upscale", upscaleFactor: "8" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({
      code: "validation_error",
      message: 'upscaleFactor: Invalid option: expected one of "1"|"2"|"4"',
    })
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("Recraft (the default model) refuses 8 too, and keeps 1 / 2 / 4, forwarded to its job as before", async () => {
    expect((await post({ upscaleFactor: "8" })).statusCode).toBe(400)
    expect((await post({ provider: "recraft-upscale", upscaleFactor: "4" })).statusCode).toBe(200)
    expect(enqueued()).toMatchObject({ provider: "recraft-upscale", upscaleFactor: "4" })
  })

  it("a factor no model takes is refused for every model", async () => {
    expect((await post({ provider: "nodaro-image-upscale", upscaleFactor: "3" })).statusCode).toBe(400)
  })

  it("Topaz is unchanged by the size reading: its tier, its factor", async () => {
    const res = await post({ provider: "topaz-image-upscale", upscaleFactor: "4" })
    expect(res.statusCode).toBe(200)
    expect(debit()).toBe("topaz-image-upscale:4K")
    expect(enqueued()).toMatchObject({ provider: "topaz-image-upscale", upscaleFactor: "4" })
    expect(enqueued()).not.toHaveProperty("nodaroImageUpscaleCreditId")
  })
})
