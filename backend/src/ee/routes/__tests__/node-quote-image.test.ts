// @test-units-by-name prices the two image run routes it names (edit-image and the split-into-layers unit)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { z } from "zod"

// POST /v1/quote against the REAL credit guard, the REAL /v1/edit-image route
// and the REAL Split into Layers unit route, priced from the real static rows
// (each id its own price). Only the edges are stubbed: the DB, the reservation
// RPC, the queue, the picture's size and the outside-input copy helper. Each
// case sends ONE body twice — to the quote, then to the run — and the quote
// must name the id the run reserved and state the credits it reserved.

vi.mock("../../../lib/config.js", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/config.js")>("../../../lib/config.js")
  return { ...actual, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, isCloud: () => true, hasAdmin: () => true }
})
vi.mock("../../../lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn(async () => false) }))
vi.mock("../../../lib/app-settings.js", () => ({
  // A real markup, so the quote has to mark up exactly as the reservation does.
  getAppSettings: vi.fn(() => Promise.resolve({ cost_markup_percent: 10 })),
}))
vi.mock("../../../lib/url-validator.js", () => ({ safeUrlSchema: z.string().url() }))

// The picture: what the copy's `inspect` reads from a downloaded copy, and what
// a header read finds (a file already on our storage, Topaz). undefined = unreadable.
const img = vi.hoisted(() => ({
  inspected: undefined as { width: number; height: number } | undefined,
  header: undefined as { width: number; height: number } | undefined,
}))
vi.mock("../../../lib/image-source-size.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/image-source-size.js")>()),
  probeImageDisplaySize: vi.fn(async () => img.header),
  sourceImageForAutoAspect: vi.fn(async () => undefined),
}))

// The copy helper: a run copies (and stores), a quote inspects (and stores
// nothing). `real` sends both to the real helper (the link-import switch).
const STORED = "https://storage.example/tmp/provider-input/outside-input-1.png"
const helper = vi.hoisted(() => ({ real: false }))
vi.mock("../../../lib/outside-input-copy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/outside-input-copy.js")>()
  return {
    ...actual,
    copyOutsideInput: vi.fn(async (url: string, opts: Parameters<typeof actual.copyOutsideInput>[1]) => {
      if (helper.real) return actual.copyOutsideInput(url, opts)
      return { url: STORED, bytes: 123_456, copied: true, ...(img.inspected ? { inspected: img.inspected } : {}) }
    }),
    inspectOutsideInput: vi.fn(async (url: string, opts: Parameters<typeof actual.inspectOutsideInput>[1]) => {
      if (helper.real) return actual.inspectOutsideInput(url, opts)
      return { bytes: 123_456, outside: true, ...(img.inspected ? { inspected: img.inspected } : {}) }
    }),
  }
})

// An outside link that never answers: its download ends only when its signal
// does (a quote's deadline, the client hanging up). Records each signal.
const dl = vi.hoisted(() => ({ signals: [] as AbortSignal[] }))
vi.mock("../../../lib/safe-fetch-bytes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/safe-fetch-bytes.js")>()),
  boundedPublicChunks: vi.fn((_url: string, opts: { signal?: AbortSignal }) => (async function* () {
    const signal = opts.signal!
    dl.signals.push(signal)
    await new Promise((_resolve, reject) => {
      if (signal.aborted) return reject(signal.reason)
      signal.addEventListener("abort", () => reject(signal.reason), { once: true })
    })
    yield Buffer.alloc(0)
  })()),
}))
// What a copy stores: nothing, for a quote.
vi.mock("../../../lib/job-scratch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/job-scratch.js")>()
  return { ...actual, uploadJobScratchFile: vi.fn(actual.uploadJobScratchFile) }
})
// The quote's read deadline, shortened where a test waits for it.
const readMs = vi.hoisted(() => ({ ms: 15_000 }))
vi.mock("../../../lib/nodaro-image-upscale-lane.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/nodaro-image-upscale-lane.js")>()),
  get NODARO_IMAGE_UPSCALE_QUOTE_READ_MS() { return readMs.ms },
}))

const fakeProfile = {
  role: "user", tier: "standard", subscription_tier: "standard",
  subscription_credits: 100000, topup_credits: 0,
  daily_spent_credits: 0, last_daily_reset: null,
  storage_used_bytes: 0, storage_limit_bytes: 1e10,
}
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: fakeProfile, error: null }) }) }) }
      }
      if (table === "jobs") {
        return {
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "job-1" }, error: null }) }) }),
          update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
        }
      }
      // No model_pricing row: every id is priced by its own static row.
      if (table === "model_pricing") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: { message: "no row" } }) }) }) }
      }
      return {}
    }),
  },
}))

const reserveSpy = vi.fn((..._args: unknown[]) => Promise.resolve({ usageLogId: "log-1", creditsReserved: 1, watermark: false }))
vi.mock("../../billing/credits.js", async () => {
  const actual = await vi.importActual<typeof import("../../billing/credits.js")>("../../billing/credits.js")
  return {
    ...actual,
    CreditsService: {
      checkStorageLimitWithProfile: () => ({ allowed: true, usedBytes: 0, limitBytes: 1e10 }),
      checkCreditsWithProfile: vi.fn(() => Promise.resolve({ allowed: true, watermark: false })),
      reserveCredits: reserveSpy,
    },
  }
})
vi.mock("../../../lib/queue.js", () => ({
  videoQueue: { add: vi.fn(() => Promise.resolve({ id: "queue-1" })) },
}))

import http from "node:http"
import type { AddressInfo } from "node:net"
import { setPluginServices } from "../../../lib/private-plugins/services-registry.js"
import { copyOutsideInput, inspectOutsideInput, outsideInputSlotsHeld, OutsideInputTimedOutError } from "../../../lib/outside-input-copy.js"
import { boundedPublicChunks } from "../../../lib/safe-fetch-bytes.js"
import { uploadJobScratchFile } from "../../../lib/job-scratch.js"

/** The plugin serves Nodaro Image Upscale and plans every run. */
function serveHouseModel(): void {
  setPluginServices({
    houseModels: { ids: () => ["nodaro-image-upscale"], plan: () => ({ providerCostUsd: 0.01 }), start: async () => ({ taskRef: "r" }), poll: async () => ({ state: "running" }) },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  img.inspected = { width: 1024, height: 1024 }
  img.header = { width: 1024, height: 1024 }
  helper.real = false
  dl.signals = []
  readMs.ms = 15_000
  serveHouseModel()
})
afterEach(() => {
  setPluginServices({})
})

const USER = "00000000-0000-4000-8000-000000000001"

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req) => {
    ;(req as unknown as { userId: string }).userId = USER
  })
  const { editImageRoutes } = await import("../../../routes/edit-image.js")
  const { route: splitIntoLayersRoute } = await import("../../../nodes/split-into-layers/route.js")
  const { registerNodeQuote } = await import("../node-quote.js")
  await editImageRoutes(app)
  await app.register(splitIntoLayersRoute)
  registerNodeQuote(app)
  return app
}

/** BASE credits marked up 10%, the platform's integer rounding. */
const mk = (base: number) => Math.ceil((base * 110) / 100)

interface Quote { identifier: string; reserve: number; expected?: number; adjustments: { code: string; message: string }[]; warnings: { code: string; message: string }[] }

/** Quote the body, then run it: the quote, the id the run reserved and the credits it reserved. */
async function quoteThenRun(type: string, params: Record<string, unknown>) {
  const app = await buildApp()
  try {
    const q = await app.inject({ method: "POST", url: "/v1/quote", payload: { type, params } })
    expect(q.statusCode, q.body).toBe(200)
    const quote = (q.json() as { data: Quote }).data
    expect(reserveSpy).not.toHaveBeenCalled()

    const run = await app.inject({ method: "POST", url: `/v1/${type}`, payload: params })
    expect(run.statusCode, run.body).toBe(200)
    expect(reserveSpy).toHaveBeenCalledTimes(1)
    const [, , identifier, , , options] = reserveSpy.mock.calls[0]! as [string, string, string, number, number, { creditOverride?: number }]
    const { getModelCreditCostFromDB } = await import("../../billing/credits.js")
    const reserved = options?.creditOverride ?? (await getModelCreditCostFromDB(identifier)).creditCost
    expect(quote.identifier).toBe(identifier)
    expect(quote.reserve).toBe(reserved)
    return { quote, identifier, reserved }
  } finally {
    await app.close()
  }
}

/** Send one body to the quote and to the run: both refuse it alike, with nothing reserved. */
async function bothRefuse(type: string, params: Record<string, unknown>) {
  const app = await buildApp()
  try {
    const q = await app.inject({ method: "POST", url: "/v1/quote", payload: { type, params } })
    const run = await app.inject({ method: "POST", url: `/v1/${type}`, payload: params })
    expect(q.statusCode, q.body).toBe(run.statusCode)
    expect(q.json(), "the quote's refusal is the run's").toEqual(run.json())
    expect(reserveSpy).not.toHaveBeenCalled()
    return { status: q.statusCode, body: q.json() as { error: { code: string; message: string } } }
  } finally {
    await app.close()
  }
}

const IMAGE = "https://cdn.example/photo.png"
const upscale = (extra: Record<string, unknown>) => ({ provider: "nodaro-image-upscale", imageUrl: IMAGE, ...extra })

describe("Nodaro Image Upscale: the quote is the exact tier the run reserves, measured from the picture", () => {
  it.each([
    // [width, height, factor, the tier] — every boundary, both sides of it.
    [1024, 1024, "2", "nodaro-image-upscale:2K"], // 2048² = 4,194,304: the 2K limit exactly
    [1025, 1024, "2", "nodaro-image-upscale:4K"], // one column over
    [1025, 1025, "2", "nodaro-image-upscale:4K"], // the node page's worked example
    [2048, 2048, "2", "nodaro-image-upscale:4K"], // 4096² = 16,777,216: the 4K limit exactly
    [2049, 2048, "2", "nodaro-image-upscale:8K"],
    [4096, 4096, "2", "nodaro-image-upscale:8K"], // 8192²: the largest output
    // 4x
    [512, 512, "4", "nodaro-image-upscale:2K"],
    [513, 512, "4", "nodaro-image-upscale:4K"],
    [1024, 1024, "4", "nodaro-image-upscale:4K"],
    [1025, 1024, "4", "nodaro-image-upscale:8K"],
    [2048, 2048, "4", "nodaro-image-upscale:8K"],
    // 8x
    [256, 256, "8", "nodaro-image-upscale:2K"],
    [257, 256, "8", "nodaro-image-upscale:4K"],
    [512, 512, "8", "nodaro-image-upscale:4K"],
    [513, 512, "8", "nodaro-image-upscale:8K"],
    [1024, 1024, "8", "nodaro-image-upscale:8K"],
    // 1x: priced by the picture's own size
    [2048, 2048, "1", "nodaro-image-upscale:2K"],
    [2049, 2048, "1", "nodaro-image-upscale:4K"],
    [4096, 4096, "1", "nodaro-image-upscale:4K"],
    [4097, 4096, "1", "nodaro-image-upscale:8K"],
    [1024, 1024, undefined, "nodaro-image-upscale:2K"], // no factor: the default, 2
  ] as const)("%i × %i at %sx is %s", async (width, height, factor, tier) => {
    img.inspected = { width, height }
    const { quote, identifier } = await quoteThenRun("edit-image", upscale(factor === undefined ? {} : { upscaleFactor: factor }))
    expect(identifier).toBe(tier)
    const { STATIC_CREDIT_COSTS } = await import("../../billing/credits.js")
    expect(quote.reserve).toBe(mk(STATIC_CREDIT_COSTS[tier]!))
    // Exact: no hold, nothing settles.
    expect(quote.expected).toBeUndefined()
    expect(quote.warnings).toEqual([])
    expect(quote.adjustments.map((a) => a.code)).toEqual(["output_size"])
    // The quote checked the picture with nothing stored; only the run copied it.
    expect(inspectOutsideInput).toHaveBeenCalledTimes(1)
    expect(copyOutsideInput).toHaveBeenCalledTimes(1)
  })

  it("the tiers are three prices, smallest first", async () => {
    const { STATIC_CREDIT_COSTS } = await import("../../billing/credits.js")
    const [a, b, c] = ["2K", "4K", "8K"].map((t) => STATIC_CREDIT_COSTS[`nodaro-image-upscale:${t}`]!)
    expect(a).toBeLessThan(b!)
    expect(b).toBeLessThan(c!)
  })

  it("names the output it priced", async () => {
    img.inspected = { width: 1000, height: 500 }
    const { quote } = await quoteThenRun("edit-image", upscale({ upscaleFactor: "4" }))
    expect(quote.adjustments[0]!.message).toBe("Priced by the output's size: 4,000 × 2,000 (8,000,000 pixels).")
  })

  it.each([
    [4097, 4096, "2"], // past the largest output in pixels
    [2049, 2048, "4"],
    [1025, 1024, "8"],
    [2049, 1, "8"], // past the longest side
    [1100, 1100, "8"], // the node page's examples
    [2100, 400, "8"],
  ] as const)("%i × %i at %sx is refused by both before anything is held", async (width, height, factor) => {
    img.inspected = { width, height }
    const { status, body } = await bothRefuse("edit-image", upscale({ upscaleFactor: factor }))
    expect(status).toBe(400)
    expect(body.error.code).toBe("image_too_large")
  })

  it("a picture whose size cannot be read: the quote is the hold, stated as the most the run can cost", async () => {
    img.inspected = undefined
    img.header = undefined
    const { quote, identifier } = await quoteThenRun("edit-image", upscale({ upscaleFactor: "4" }))
    expect(identifier).toBe("nodaro-image-upscale")
    expect(quote.warnings.map((w) => w.code)).toEqual(["image_size_unmeasured", "settles_to_actual"])
    expect(quote.adjustments).toEqual([])
  })

  it("a plan the plugin refuses is refused by both", async () => {
    setPluginServices({
      houseModels: { ids: () => ["nodaro-image-upscale"], plan: () => null as never, start: async () => ({ taskRef: "r" }), poll: async () => ({ state: "running" }) },
    })
    const { status, body } = await bothRefuse("edit-image", upscale({ upscaleFactor: "2" }))
    expect(status).toBe(400)
    expect(body.error.code).toBe("validation_error")
  })
})

describe("Nodaro Image Upscale where it is not served: the quote answers as the run does", () => {
  it("403 model_not_available, the same body, before the picture is read or anything held", async () => {
    setPluginServices({})
    const { status, body } = await bothRefuse("edit-image", upscale({ upscaleFactor: "4" }))
    expect(status).toBe(403)
    expect(body.error.code).toBe("model_not_available")
    expect(inspectOutsideInput).not.toHaveBeenCalled()
    expect(copyOutsideInput).not.toHaveBeenCalled()
  })
})

describe("a quote of an outside link follows the deployment's link-import switch", () => {
  it("links off: the quote is refused as the run is, and nothing is downloaded or stored", async () => {
    const { __resetSurfaceProfileCacheForTests } = await import("../../../lib/surface-profile.js")
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ imports: { links: false } })
    __resetSurfaceProfileCacheForTests()
    helper.real = true
    try {
      const { status, body } = await bothRefuse("edit-image", upscale({ upscaleFactor: "2" }))
      expect(status).toBe(403)
      expect(body.error.code).toBe("link_imports_disabled")
      // Both were asked; neither fetched a byte or stored anything.
      expect(inspectOutsideInput).toHaveBeenCalledTimes(1)
      expect(copyOutsideInput).toHaveBeenCalledTimes(1)
      expect(boundedPublicChunks).not.toHaveBeenCalled()
      expect(uploadJobScratchFile).not.toHaveBeenCalled()
      // Topaz reads the picture's header: the switch is asked first there too.
      const topaz = await bothRefuse("edit-image", { provider: "topaz-image-upscale", imageUrl: IMAGE, upscaleFactor: "2" })
      expect(topaz.status).toBe(403)
      expect(topaz.body.error.code).toBe("link_imports_disabled")
      const { probeImageDisplaySize } = await import("../../../lib/image-source-size.js")
      expect(probeImageDisplaySize).not.toHaveBeenCalled()
    } finally {
      delete process.env.NODARO_SURFACE_PROFILE
      __resetSurfaceProfileCacheForTests()
    }
  })
})

describe("a quote reads an outside picture under its own deadline, and stops when the client leaves", () => {
  it("is 15 seconds", async () => {
    const actual = await vi.importActual<typeof import("../../../lib/nodaro-image-upscale-lane.js")>("../../../lib/nodaro-image-upscale-lane.js")
    expect(actual.NODARO_IMAGE_UPSCALE_QUOTE_READ_MS).toBe(15_000)
  })

  it("a link that does not answer in time: 503 input_timed_out, its slot given back, nothing priced or stored", async () => {
    helper.real = true
    readMs.ms = 100
    const app = await buildApp()
    try {
      const q = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "edit-image", params: upscale({ upscaleFactor: "2" }) } })
      expect(q.statusCode, q.body).toBe(503)
      expect(q.json().error.code).toBe("input_timed_out")
      expect(dl.signals).toHaveLength(1)
      expect(dl.signals[0]!.reason).toBeInstanceOf(OutsideInputTimedOutError)
      expect(outsideInputSlotsHeld("quote")).toBe(0)
      expect(uploadJobScratchFile).not.toHaveBeenCalled()
      expect(reserveSpy).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it("a client that hangs up: the read stops at once and its slot is given back", async () => {
    helper.real = true
    const app = await buildApp()
    await app.listen({ port: 0, host: "127.0.0.1" })
    try {
      const { port } = app.server.address() as AddressInfo
      const body = JSON.stringify({ type: "edit-image", params: upscale({ upscaleFactor: "2" }) })
      const req = http.request({ host: "127.0.0.1", port, path: "/v1/quote", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } })
      req.on("error", () => undefined)
      req.end(body)
      await vi.waitFor(() => expect(dl.signals).toHaveLength(1), { timeout: 5_000 })
      expect(outsideInputSlotsHeld("quote")).toBe(1)
      req.destroy()
      await vi.waitFor(() => expect(dl.signals[0]!.aborted).toBe(true), { timeout: 5_000 })
      // The client's leaving, long before the 15-second deadline.
      expect(dl.signals[0]!.reason).not.toBeInstanceOf(OutsideInputTimedOutError)
      await vi.waitFor(() => expect(outsideInputSlotsHeld("quote")).toBe(0), { timeout: 5_000 })
      expect(reserveSpy).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })
})

describe("every other edit-image model keeps its own price", () => {
  it.each([
    ["recraft-upscale", { imageUrl: IMAGE }],
    ["recraft-remove-bg", { imageUrl: IMAGE }],
    ["nano-banana-edit", { imageUrl: IMAGE, prompt: "make it night" }],
    ["grok-2-edit", { taskId: "task-1", prompt: "make it night" }],
    ["grok-2-segment", { taskId: "task-1" }],
  ] as const)("%s", async (provider, body) => {
    const { quote, identifier } = await quoteThenRun("edit-image", { provider, ...body })
    expect(identifier).toBe(provider)
    // Its own row, marked up: a figure the quote's lookup did not produce.
    const { STATIC_CREDIT_COSTS } = await import("../../billing/credits.js")
    expect(quote.reserve).toBe(mk(STATIC_CREDIT_COSTS[provider]!))
    expect(quote.warnings).toEqual([])
  })

  it("no model named: the default upscaler", async () => {
    const { quote, identifier } = await quoteThenRun("edit-image", { imageUrl: IMAGE })
    expect(identifier).toBe("recraft-upscale")
    const { STATIC_CREDIT_COSTS } = await import("../../billing/credits.js")
    expect(quote.reserve).toBe(mk(STATIC_CREDIT_COSTS["recraft-upscale"]!))
  })

  it("a retired model: the quote gives the run's own sentence, before its body is checked", async () => {
    const { status, body } = await bothRefuse("edit-image", { provider: "grok-upscale", imageUrl: IMAGE })
    expect(status).toBe(400)
    expect(body.error.message).toMatch(/^grok-upscale was retired/)
  })

  it("a model the deployment withholds, in a body the run refuses first: both answer what the run answers first", async () => {
    const { __resetSurfaceProfileCacheForTests } = await import("../../../lib/surface-profile.js")
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["nano-banana-edit"] } })
    __resetSurfaceProfileCacheForTests()
    try {
      // No prompt: the run's prompt check answers before its guard's model door.
      const first = await bothRefuse("edit-image", { provider: "nano-banana-edit", imageUrl: IMAGE })
      expect(first.status).toBe(400)
      // With a prompt, the model door.
      const second = await bothRefuse("edit-image", { provider: "nano-banana-edit", imageUrl: IMAGE, prompt: "make it night" })
      expect(second.status).toBe(403)
      expect(second.body.error.code).toBe("model_not_available")
    } finally {
      delete process.env.NODARO_SURFACE_PROFILE
      __resetSurfaceProfileCacheForTests()
    }
  })

  it("a prompt edit with no prompt is refused by both before anything is held", async () => {
    const { status, body } = await bothRefuse("edit-image", { provider: "nano-banana-edit", imageUrl: IMAGE })
    expect(status).toBe(400)
    expect(body.error.message).toBe("Prompt is required for nano-banana-edit provider")
  })
})

describe("Topaz image upscale: the factor's tier, or more for a large output", () => {
  it.each([
    [512, 512, "2", "topaz-image-upscale"],
    [512, 512, "4", "topaz-image-upscale:4K"],
  ] as const)("%i × %i at %sx: the factor's tier, %s", async (width, height, factor, tier) => {
    img.header = { width, height }
    const { quote, identifier } = await quoteThenRun("edit-image", { provider: "topaz-image-upscale", imageUrl: IMAGE, upscaleFactor: factor })
    expect(identifier).toBe(tier)
    const { STATIC_CREDIT_COSTS } = await import("../../billing/credits.js")
    expect(quote.reserve).toBe(mk(STATIC_CREDIT_COSTS[tier]!))
    expect(quote.adjustments).toEqual([])
    expect(quote.warnings).toEqual([])
  })

  it.each([
    [4000, 3000, "2", 2], // 48 MP: two units
    [3000, 2000, "4", 4], // 96 MP: four units
  ] as const)("%i × %i at %sx: priced by its size (%i units), and the quote says so", async (width, height, factor, units) => {
    img.header = { width, height }
    const { quote, reserved } = await quoteThenRun("edit-image", { provider: "topaz-image-upscale", imageUrl: IMAGE, upscaleFactor: factor })
    const { STATIC_CREDIT_COSTS } = await import("../../billing/credits.js")
    expect(reserved).toBe(mk(STATIC_CREDIT_COSTS["topaz-image-upscale"]! * units))
    expect(quote.adjustments.map((a) => a.code)).toEqual(["output_size"])
  })

  it("an output past the largest size is refused by both", async () => {
    img.header = { width: 6000, height: 6000 }
    const { status, body } = await bothRefuse("edit-image", { provider: "topaz-image-upscale", imageUrl: IMAGE, upscaleFactor: "4" })
    expect(status).toBe(400)
    expect(body.error.code).toBe("image_too_large")
  })

  it("a size its header does not give: the factor's tier, and the quote says it could not measure", async () => {
    img.header = undefined
    const { quote } = await quoteThenRun("edit-image", { provider: "topaz-image-upscale", imageUrl: IMAGE, upscaleFactor: "2" })
    const { STATIC_CREDIT_COSTS } = await import("../../billing/credits.js")
    expect(quote.reserve).toBe(mk(STATIC_CREDIT_COSTS["topaz-image-upscale"]!))
    expect(quote.warnings.map((w) => w.code)).toEqual(["image_size_unmeasured"])
  })
})

describe("Split into Layers: the quote is the hold — the most the run can cost — at every size and Max layers", () => {
  const sizes = ["1K", "1.5K", "2K", "auto"] as const
  // 5 is the docs' worked example (Max layers 5 at 1K holds split-into-layers:1k:6).
  const cases = sizes.flatMap((size) => ([1, 5, undefined, 99] as const).map((maxLayers) => [size, maxLayers] as const))

  it.each(cases)("size %s, Max layers %s", async (size, maxLayers) => {
    const params = { imageUrl: IMAGE, size, ...(maxLayers === undefined ? {} : { maxLayers }) }
    const { quote, identifier } = await quoteThenRun("split-into-layers", params)
    const images = (maxLayers ?? 9) + 1
    const tier = size === "2K" || size === "auto" ? "2k" : "1k"
    expect(identifier).toBe(`split-into-layers:${tier}:${images}`)
    const { STATIC_CREDIT_COSTS } = await import("../../billing/credits.js")
    expect(quote.reserve).toBe(mk(STATIC_CREDIT_COSTS[identifier]!))
    expect(quote.expected).toBeUndefined()
    expect(quote.warnings.map((w) => w.code)).toEqual(["settles_to_actual"])
    expect(quote.adjustments.map((a) => a.code)).toEqual(["max_images"])
    expect(quote.adjustments[0]!.message).toContain(`${images} (${maxLayers ?? 9} layers and the base)`)
  })

  it("no size named: 1K", async () => {
    const { identifier } = await quoteThenRun("split-into-layers", { imageUrl: IMAGE })
    expect(identifier).toBe("split-into-layers:1k:10")
  })

  it("an invalid body is refused by both with the run's 400", async () => {
    const app = await buildApp()
    try {
      const params = { imageUrl: IMAGE, maxLayers: 100 }
      const q = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "split-into-layers", params } })
      const run = await app.inject({ method: "POST", url: "/v1/split-into-layers", payload: params })
      expect(q.statusCode).toBe(400)
      expect(run.statusCode).toBe(400)
      expect(q.json().error.code).toBe(run.json().error.code)
      expect(reserveSpy).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it("a deployment that withholds the node refuses the quote as it refuses the run", async () => {
    const { __resetSurfaceProfileCacheForTests } = await import("../../../lib/surface-profile.js")
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { deny: ["split-into-layers"] } })
    __resetSurfaceProfileCacheForTests()
    try {
      const { status, body } = await bothRefuse("split-into-layers", { imageUrl: IMAGE })
      expect(status).toBe(403)
      expect(body.error.code).toBe("node_not_available")
      // A malformed body: the run's validation answers first, and so does the quote's.
      const malformed = await bothRefuse("split-into-layers", { imageUrl: IMAGE, maxLayers: 0 })
      expect(malformed.status).toBe(400)
    } finally {
      delete process.env.NODARO_SURFACE_PROFILE
      __resetSurfaceProfileCacheForTests()
    }
  })
})
