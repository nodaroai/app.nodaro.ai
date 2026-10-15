/**
 * POST /v1/generate-image with the caller's own palette / moodboard as a
 * direction (`colorLook: "palette:<id>"`, `style: "moodboard:<id>"`).
 *
 * What must hold:
 *   - the palette's clause and the moodboard's description land in the
 *     prompt's [style] section; the moodboard's images go to the provider as
 *     style references AFTER the caller's own, never past the model's limit,
 *     and the response + the job say when some did not fit;
 *   - the job records the ids AS SENT (a re-run resolves them again);
 *   - a malformed id is a 400 and someone else's (or a gone) one a 404
 *     `direction_not_found` — before any job row or charge;
 *   - the price CHECKED (creditGuard's identifier) and the price RESERVED come
 *     from the same resolution: moodboard images are references, and
 *     references move the model (T2I→I2I) and the per-reference price.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import { argOf, type QueryResult, type RecordedQuery } from "../../lib/__tests__/fake-supabase-query.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))

vi.mock("@/lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../lib/__tests__/fake-supabase-query.js")
  return {
    supabase: {
      from: makeFakeFrom(db.log, (q) => db.respond!(q)),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
    },
  }
})

vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) },
  redis: {},
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false }),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
    CHARACTER_LORA_ROUTING_ENABLED: true,
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

import { generateImageRoutes, resolveImageCreditIdentifier } from "../generate-image.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { userDirectionOf, userDirectionPreHandler } from "../../lib/user-direction.js"
import { renderPaletteClause } from "@nodaro/prompts/prompt-builder"
import { imageReferenceLimit } from "@nodaro/shared/models"

const USER = "00000000-0000-4000-8000-000000000001"
const PID = "0f9e8d7c-6b5a-4c3d-9e2f-1a2b3c4d5e6f"
const MID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
const PALETTE = `palette:${PID}`
const MOODBOARD = `moodboard:${MID}`
const COLORS = ["#0F4C5C", "#E3B23C"]
const boardImages = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://cdn.test/mood-${i + 1}.png` }))

let palette: Record<string, unknown> | null
let moodboard: Record<string, unknown> | null

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  db.log.length = 0
  palette = { id: PID, name: "Harbour", colors: COLORS }
  moodboard = { id: MID, name: "Nordic calm", description: "Moody Nordic interiors", images: boardImages(2) }
  db.respond = (q) => {
    if (q.table === "color_palettes") return { data: palette, error: null }
    if (q.table === "moodboards") return { data: moodboard, error: null }
    if (q.table === "jobs") return { data: { id: "job-1" }, error: null }
    return { data: null, error: null }
  }

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => {
    await generateImageRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function queued(): Record<string, unknown> {
  const call = vi.mocked(videoQueue.add).mock.calls[0]
  return call[1] as Record<string, unknown>
}

function insertedJob(): Record<string, unknown> {
  const insert = db.log.find((q) => q.table === "jobs" && argOf(q, "insert"))
  return argOf(insert!, "insert")![0] as Record<string, unknown>
}

describe("a palette as direction.colorLook", () => {
  it("names its colours on the [style] film line and keeps the id on the job", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/generate-image",
      payload: { userId: USER, prompt: "a lighthouse at dusk", provider: "nano-banana-pro", direction: { colorLook: PALETTE } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(queued().prompt).toContain(`[style]:\n${renderPaletteClause(COLORS)}`)
    // The job keeps the id where the request had it (a re-run resolves it
    // again); `prompt` is, as for every structured run, what was sent.
    const input = insertedJob().input_data as Record<string, unknown>
    expect(input.direction).toEqual({ colorLook: PALETTE })
    expect(input.userPrompt).toBe("a lighthouse at dusk")
    expect(input.prompt).toBe(queued().prompt)
    const lookup = db.log.find((q) => q.table === "color_palettes")!
    expect(argOf(lookup, "in")).toEqual(["user_id", [USER]])
  })

  it("is a 404 direction_not_found naming the key when the palette is not the caller's — nothing created or charged", async () => {
    palette = null
    const res = await app.inject({
      method: "POST", url: "/v1/generate-image",
      payload: { userId: USER, prompt: "a lighthouse", direction: { colorLook: PALETTE } },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toMatchObject({ code: "direction_not_found", field: "direction.colorLook" })
    expect(db.log.some((q) => q.table === "jobs")).toBe(false)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("is a 400 for a palette that is not followed by an id", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/generate-image",
      payload: { userId: USER, prompt: "a lighthouse", direction: { colorLook: "palette:warm" } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: "validation_error", field: "direction.colorLook" })
    expect(db.log).toHaveLength(0)
  })

  it("leaves a catalog colorLook exactly as tolerant as before (no lookup, unknown id folds nothing)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/generate-image",
      payload: { userId: USER, prompt: "a lighthouse", provider: "nano-banana-pro", direction: { colorLook: "no-such-look" } },
    })
    expect(res.statusCode).toBe(200)
    expect(db.log.some((q) => q.table === "color_palettes")).toBe(false)
  })
})

describe("a moodboard as direction.style", () => {
  it("puts its description in the prompt and its images after the caller's own references", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/generate-image",
      payload: {
        userId: USER, prompt: "a cabin", provider: "nano-banana-pro",
        referenceImageUrls: ["https://cdn.test/own.png"],
        direction: { style: MOODBOARD },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    const payload = queued()
    expect(payload.prompt).toContain("Moody Nordic interiors")
    expect(payload.referenceImageUrls).toEqual(["https://cdn.test/own.png", "https://cdn.test/mood-1.png", "https://cdn.test/mood-2.png"])
    expect(((insertedJob().input_data as Record<string, unknown>).direction)).toEqual({ style: MOODBOARD })
  })

  it("sends no more than the model takes, and says so in the response and on the job", async () => {
    const cap = imageReferenceLimit("nano-banana-pro")
    moodboard = { ...moodboard!, images: boardImages(cap + 2) }
    const res = await app.inject({
      method: "POST", url: "/v1/generate-image",
      payload: { userId: USER, prompt: "a cabin", provider: "nano-banana-pro", referenceImageUrls: ["https://cdn.test/own.png"], direction: { style: MOODBOARD } },
    })
    expect(res.statusCode).toBe(200)
    expect((queued().referenceImageUrls as string[]).length).toBe(cap)
    const warnings = res.json().warnings as Array<{ code: string; message: string }>
    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe("moodboard_images_not_sent")
    expect(warnings[0].message).toContain(`3 of the ${cap + 2} images`)
    expect((insertedJob().input_data as Record<string, unknown>).warnings).toEqual(warnings)
  })

  it("prices on the references actually sent: the credit check and the reservation agree", async () => {
    // flux-2-max is priced per reference image, so a moodboard moves its price.
    const body = { userId: USER, prompt: "a cabin", provider: "flux-2-max", direction: { style: MOODBOARD } }
    const res = await app.inject({ method: "POST", url: "/v1/generate-image", payload: body })
    expect(res.statusCode).toBe(200)
    const debit = vi.mocked(reserveCreditsForJob).mock.calls[0][3]

    // The CHECK the live creditGuard runs, on the same body after the same pre-step.
    const req = { body, userId: USER } as unknown as FastifyRequest
    const reply = { status: () => ({ send: () => undefined }) } as never
    await userDirectionPreHandler(req, reply)
    expect(userDirectionOf(req)?.styleReferences).toHaveLength(2)
    expect(resolveImageCreditIdentifier(req)).toBe(debit)

    // …and without the moodboard both would have priced a different run.
    const plain = { body: { ...body, direction: undefined }, userId: USER } as unknown as FastifyRequest
    expect(resolveImageCreditIdentifier(plain)).not.toBe(debit)
  })

  it("is a 404 when the moodboard is gone", async () => {
    moodboard = null
    const res = await app.inject({
      method: "POST", url: "/v1/generate-image",
      payload: { userId: USER, prompt: "a cabin", direction: { style: MOODBOARD } },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toMatchObject({ code: "direction_not_found", field: "direction.style" })
    expect(videoQueue.add).not.toHaveBeenCalled()
  })
})

describe("with a preset (presetId)", () => {
  // A preset call folds its direction in one synchronous build that cannot read
  // the caller's rows: a palette or moodboard there is refused, never folded as
  // nothing — before any palette read, job row or charge.
  const noRunAndNoRead = () => {
    expect(videoQueue.add).not.toHaveBeenCalled()
    expect(db.log.some((q) => q.table === "jobs" && argOf(q, "insert"))).toBe(false)
    expect(db.log.some((q) => q.table === "color_palettes" || q.table === "moodboards")).toBe(false)
  }

  it("refuses the caller's palette beside a preset, naming the key", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/generate-image",
      payload: { userId: USER, presetId: "generate-image/location-board", prompt: "a lighthouse", direction: { colorLook: PALETTE } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: "validation_error", field: "direction.colorLook" })
    expect(res.json().error.message).toContain("without presetId")
    noRunAndNoRead()
  })

  it("refuses a saved preset whose own direction names a moodboard", async () => {
    const respond = db.respond!
    db.respond = (q) => q.table === "node_presets"
      ? { data: { id: "p-mine", name: "Mine", description: null, data: { prompt: "a cabin", direction: { style: MOODBOARD } } }, error: null }
      : respond(q)
    const res = await app.inject({
      method: "POST", url: "/v1/generate-image",
      payload: { userId: USER, presetId: "p-mine" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: "validation_error", field: "direction.style" })
    expect(res.json().error.message).toContain("This preset's direction.style")
    noRunAndNoRead()
  })

  it("still runs a preset that names none", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/generate-image",
      payload: { userId: USER, presetId: "generate-image/location-board", prompt: "a lighthouse" },
    })
    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
    expect(db.log.some((q) => q.table === "color_palettes" || q.table === "moodboards")).toBe(false)
  })
})

describe("the model a moodboard's references are counted against", () => {
  // The pricing pre-check, the handler and the assembly must count free
  // reference seats against ONE model: with no provider, the one the aspect
  // ratio picks (4:5 picks a model with fewer seats than the bare default).
  it("defaults by aspect ratio, as the credit check and the handler do", async () => {
    const { buildAssembleInput } = await import("../generate-image.js")
    const { defaultImageModel } = await import("@nodaro/shared/model-catalog")
    const { assembleImageInput } = await import("@nodaro/prompts/assembly")
    const byRatio = defaultImageModel("general", "4:5")
    expect(byRatio).not.toBe(defaultImageModel("general"))
    expect(buildAssembleInput({ prompt: "a cabin", aspectRatio: "4:5" }, false, undefined).provider).toBe(byRatio)

    const resolved = { refs: new Map<string, string>(), styleReferences: boardImages(14), moodboard: { id: MID, name: "Big" } }
    const sent = assembleImageInput(buildAssembleInput({ prompt: "a cabin", aspectRatio: "4:5", direction: { style: MOODBOARD } }, false, resolved))
    expect(sent.referenceImageUrls?.length ?? 0).toBeLessThanOrEqual(imageReferenceLimit(byRatio))
  })
})
