import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// The video money path's core invariant: the value we CHECK, the value we
// DEBIT, the value we PERSIST to input_data and the value we SEND on the wire
// are one value. `commit_credits` (migration 176) only ever refunds a surplus
// and never collects a shortfall, so the reservation IS the final charge — a
// route that reserves one tier and renders another cannot be trued up later.
//
// Two gaps pinned here, both "priced one thing, sent another":
//
//  (A) An OMITTED resolution. `buildVideoCreditModelIdentifier` prices an absent
//      `resolution` as a concrete band (LTX → 1080p; a provider with a declared
//      PRICING_DEFAULT_RESOLUTION → its default). The routes used to forward the
//      key unset, so Replicate/KIE applied their own default — undocumented for
//      LTX. The band we priced must be the band we send.
//
//  (B) LTX duration. The LTX ladder is seeded per (band × seconds), so the
//      identifier snaps a 7s request onto the 6s tier. The routes used to send
//      `duration` raw: billed six, rendered seven.
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
    },
  }
})

// Route tests that reach videoQueue.add MUST mock the queue — a real Redis
// connection hangs the suite under CI load.
vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) },
  redis: {},
}))

vi.mock("@/middleware/credit-guard.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../middleware/credit-guard.js")>()
  return {
    ...actual,
    creditGuard: () => async () => {},
    reserveCreditsForJob: vi.fn().mockResolvedValue({
      usageLogId: "usage-1",
      creditsReserved: 1,
      watermark: false,
    }),
  }
})

vi.mock("@/ee/billing/credits.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, getModelCreditBaseCost: vi.fn().mockResolvedValue({ creditCost: 1 }) }
})

vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, probeMediaDuration: vi.fn().mockResolvedValue(5) }
})

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

vi.mock("@/lib/video-schemas.js", async () => {
  const { z } = await import("zod")
  return {
    shotsSchema: z.array(z.object({ prompt: z.string(), duration: z.number() })),
    elementsSchema: z.array(z.object({ name: z.string() })),
  }
})

import { textToVideoRoutes, textToVideoPricing } from "../text-to-video.js"
import { generateVideoRoutes, generateVideoPricing } from "../generate-video.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob, type RoutePricing } from "../../middleware/credit-guard.js"
import { probeMediaDuration } from "../../providers/video/ffmpeg-utils.js"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { resolveVideoRequestNorm } from "../../lib/video-request-norm.js"
import { textToVideoBody } from "../text-to-video.js"
import { generateVideoBody } from "../generate-video.js"

const USER = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()

  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => {
    await textToVideoRoutes(instance)
    await generateVideoRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

/** The payload the route enqueued for the worker. */
function queued(): Record<string, unknown> {
  return vi.mocked(videoQueue.add).mock.calls.at(-1)![1] as Record<string, unknown>
}

/** The `input_data` the route wrote to the jobs row. */
function persisted(): Record<string, unknown> {
  const insert = vi.mocked(supabase.from).mock.results[0]!.value as { insert: ReturnType<typeof vi.fn> }
  return (insert.insert.mock.calls[0][0] as Record<string, unknown>).input_data as Record<string, unknown>
}

/** The identifier the route reserved against. */
function reservedIdentifier(): string {
  return vi.mocked(reserveCreditsForJob).mock.calls.at(-1)![3]
}

const ROUTES = [
  { url: "/v1/text-to-video", nodeType: "text-to-video" as const, extra: {} },
  { url: "/v1/generate-video", nodeType: "image-to-video" as const, extra: { imageUrl: "https://example.com/i.png" } },
]

for (const route of ROUTES) {
  describe(`POST ${route.url} — the priced tier is the tier we send`, () => {
    // (A) ------------------------------------------------------------------
    it("sends the resolution the identifier priced when the request omits one (LTX)", async () => {
      const res = await app.inject({
        method: "POST",
        url: route.url,
        payload: { prompt: "a cat", userId: USER, provider: "ltx-2.3-pro", duration: 6, ...route.extra },
      })
      expect(res.statusCode).toBe(200)

      // The identifier prices an absent resolution as 1080p …
      expect(reservedIdentifier()).toBe("ltx-2.3-pro:1080p:6s")
      // … so 1080p is what the wire and the jobs row carry, instead of the key
      // being unset for Replicate to guess at.
      expect(queued().resolution).toBe("1080p")
      expect(persisted().resolution).toBe("1080p")
    })

    it("sends the declared default band when the request omits one (seedance-2-5)", async () => {
      const res = await app.inject({
        method: "POST",
        url: route.url,
        payload: { prompt: "a cat", userId: USER, provider: "seedance-2-5", duration: 8, ...route.extra },
      })
      expect(res.statusCode).toBe(200)

      expect(reservedIdentifier()).toBe("seedance-2-5:8s:720p")
      expect(queued().resolution).toBe("720p")
      expect(persisted().resolution).toBe("720p")
    })

    it("Seedance Draft: a stale 1080p is priced, persisted and sent at 480p, and the job records the draft", async () => {
      const res = await app.inject({
        method: "POST",
        url: route.url,
        payload: { prompt: "a cat", userId: USER, provider: "seedance-2-5", duration: 8, resolution: "1080p", draft: true, ...route.extra },
      })
      expect(res.statusCode).toBe(200)
      expect(reservedIdentifier()).toBe("seedance-2-5:8s:480p")
      expect(queued()).toMatchObject({ resolution: "480p", draft: true })
      expect(persisted()).toMatchObject({ resolution: "480p", draft: true })
    })

    it("Seedance Draft is ignored (and not recorded) on a model without draft mode", async () => {
      const res = await app.inject({
        method: "POST",
        url: route.url,
        payload: { prompt: "a cat", userId: USER, provider: "ltx-2.3-pro", duration: 6, resolution: "1080p", draft: true, ...route.extra },
      })
      expect(res.statusCode).toBe(200)
      expect(reservedIdentifier()).toBe("ltx-2.3-pro:1080p:6s")
      expect(queued().draft).toBeUndefined()
      expect(persisted().draft).toBeUndefined()
    })

    it("leaves resolution unset for a provider whose priced fallback is only a hedge", async () => {
      // seedance-2 pins 720p KIE-side but has no PRICING_DEFAULT_RESOLUTION row,
      // so the identifier prices 480p. Filling 480p would DOWNGRADE the render
      // to match a price we already know is wrong; that is an identifier bug to
      // fix by seeding the row, not something the wire should paper over.
      const res = await app.inject({
        method: "POST",
        url: route.url,
        payload: { prompt: "a cat", userId: USER, provider: "seedance-2", duration: 8, ...route.extra },
      })
      expect(res.statusCode).toBe(200)
      expect(queued().resolution).toBeUndefined()
    })

    // (B) ------------------------------------------------------------------
    it("sends the seeded LTX duration tier the identifier priced (7s → 6s)", async () => {
      const res = await app.inject({
        method: "POST",
        url: route.url,
        payload: { prompt: "a cat", userId: USER, provider: "ltx-2.3-pro", duration: 7, resolution: "4k", ...route.extra },
      })
      expect(res.statusCode).toBe(200)

      // Priced at the 6s tier …
      expect(reservedIdentifier()).toBe("ltx-2.3-pro:4k:6s")
      // … so 6s is what renders. Sending 7s billed six and rendered seven.
      expect(queued().duration).toBe(6)
      expect(persisted().duration).toBe(6)
    })

    it("snaps an LTX duration that is legal at 1080p but not at the requested band", async () => {
      const res = await app.inject({
        method: "POST",
        url: route.url,
        payload: { prompt: "a cat", userId: USER, provider: "ltx-2.3-fast", duration: 20, resolution: "2k", ...route.extra },
      })
      expect(res.statusCode).toBe(200)
      expect(reservedIdentifier()).toBe("ltx-2.3-fast:2k:10s")
      expect(queued().duration).toBe(10)
    })

    it("leaves duration alone for a non-LTX provider", async () => {
      const res = await app.inject({
        method: "POST",
        url: route.url,
        payload: { prompt: "a cat", userId: USER, provider: "seedance-2-5", duration: 7, ...route.extra },
      })
      expect(res.statusCode).toBe(200)
      expect(queued().duration).toBe(7)
    })

    // The catalog snap, at all three billing sites + the wire ---------------
    it("snaps an off-list resolution to the NEAREST band, never the cheapest", async () => {
      const res = await app.inject({
        method: "POST",
        url: route.url,
        payload: { prompt: "a cat", userId: USER, provider: "seedance-2-5", duration: 8, resolution: "4k", ...route.extra },
      })
      expect(res.statusCode).toBe(200)

      // seedance-2-5 tops out at 1080p — R7: nearest band, not the 480p floor.
      expect(reservedIdentifier()).toBe("seedance-2-5:8s:1080p")
      expect(queued().resolution).toBe("1080p")
      expect(persisted().resolution).toBe("1080p")
    })

    it("canonicalises a case variant before the identifier keys on it", async () => {
      const res = await app.inject({
        method: "POST",
        url: route.url,
        payload: { prompt: "a cat", userId: USER, provider: "ltx-2.3-fast", duration: 6, resolution: "4K", ...route.extra },
      })
      expect(res.statusCode).toBe(200)

      // LTX_DURATION_TIERS keys lowercase bands case-SENSITIVELY: an
      // un-canonicalised "4K" would fall back to the cheapest 1080p tier.
      expect(reservedIdentifier()).toBe("ltx-2.3-fast:4k:6s")
      expect(queued().resolution).toBe("4k")
    })

    it("snaps an off-list aspect ratio to the NEAREST ratio, never landscape-from-portrait", async () => {
      const res = await app.inject({
        method: "POST",
        url: route.url,
        payload: { prompt: "a cat", userId: USER, provider: "seedance-2-5", duration: 8, aspectRatio: "9:21", ...route.extra },
      })
      expect(res.statusCode).toBe(200)
      expect(queued().aspectRatio).toBe("9:16")
      expect(persisted().aspectRatio).toBe("9:16")
    })

    it("passes 'adaptive' through for the provider adapter to resolve", async () => {
      const res = await app.inject({
        method: "POST",
        url: route.url,
        payload: { prompt: "a cat", userId: USER, provider: "seedance-2-5", duration: 8, aspectRatio: "adaptive", ...route.extra },
      })
      expect(res.statusCode).toBe(200)
      expect(queued().aspectRatio).toBe("adaptive")
    })

    it("discloses the snap in the response body", async () => {
      const res = await app.inject({
        method: "POST",
        url: route.url,
        payload: { prompt: "a cat", userId: USER, provider: "seedance-2-5", duration: 8, resolution: "4k", ...route.extra },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      // BOTH routes return the structured `adjustments` the API docs define —
      // the prose message alone drops field/from/to, so a client could not tell
      // WHICH lever moved. gv ADDITIONALLY keeps its `warnings` vocabulary.
      expect(body.adjustments, JSON.stringify(body)).toHaveLength(1)
      expect(body.adjustments[0]).toMatchObject({ field: "resolution", from: "4k", to: "1080p" })
      expect(typeof body.adjustments[0].reason).toBe("string")
      if (route.url === "/v1/generate-video") {
        expect(body.warnings, JSON.stringify(body)).toHaveLength(1)
        expect(body.warnings[0].message).toBe(body.adjustments[0].reason)
      }
    })

    it("says nothing when nothing was adjusted", async () => {
      const res = await app.inject({
        method: "POST",
        url: route.url,
        payload: { prompt: "a cat", userId: USER, provider: "seedance-2-5", duration: 8, resolution: "720p", ...route.extra },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ jobId: "job-1" })
    })

    it("the preHandler and the handler normalize the SAME input", () => {
      // The CHECK site reads the RAW body (creditGuard runs before Zod); the
      // DEBIT/wire site reads `parsed.data`. They agree today only because Zod
      // passes these levers through untouched — a future `.default()` or
      // `.transform()` on provider/resolution/aspectRatio/duration would split
      // the two silently, reserving one tier and rendering another. Pin it.
      const rawBody: Record<string, unknown> = {
        prompt: "a cat",
        userId: USER,
        provider: "ltx-2.3-fast",
        duration: 13,
        resolution: "2K",
        aspectRatio: "9:21",
        ...route.extra,
      }
      const parsed = (route.url === "/v1/text-to-video" ? textToVideoBody : generateVideoBody).safeParse(rawBody)
      expect(parsed.success, JSON.stringify(parsed)).toBe(true)

      const read = (src: Record<string, unknown>) => resolveVideoRequestNorm({
        provider: src.provider as string,
        aspectRatio: src.aspectRatio as string | undefined,
        resolution: src.resolution as string | undefined,
        duration: src.duration as number | undefined,
      })
      expect(read(parsed.data as Record<string, unknown>)).toEqual(read(rawBody))
    })

    it("reserves the identifier built from the SENT values, not the raw body", async () => {
      // The end-to-end statement of the invariant: rebuild the identifier from
      // what the worker actually receives and it must equal what was reserved.
      const res = await app.inject({
        method: "POST",
        url: route.url,
        payload: { prompt: "a cat", userId: USER, provider: "ltx-2.3-fast", duration: 13, resolution: "2K", ...route.extra },
      })
      expect(res.statusCode).toBe(200)

      const wire = queued()
      expect(reservedIdentifier()).toBe(
        buildVideoCreditModelIdentifier(
          "ltx-2.3-fast",
          wire.duration as number,
          undefined,
          route.nodeType,
          undefined,
          wire.resolution as string,
          false,
        ),
      )
    })
  })
}

// ---------------------------------------------------------------------------
// Seedance 2.5 `referenceTaskType`: the declaration is resolved before pricing,
// so the ratio and length it forces are what is checked, reserved, recorded and
// queued — and the job carries the RESOLVED declaration, never `auto`.
// ---------------------------------------------------------------------------

const REF_VIDEO = "https://example.com/ref.mp4"

/** Every reference clip this test's pre-check measures is `sec` long. */
async function withClipsOf<T>(sec: number, run: () => Promise<T>): Promise<T> {
  vi.mocked(probeMediaDuration).mockResolvedValue(sec)
  try {
    return await run()
  } finally {
    vi.mocked(probeMediaDuration).mockResolvedValue(5)
  }
}

/** Runs one request through the route and returns what it queued, recorded and reserved against. */
async function runOnce(url: string, payload: Record<string, unknown>) {
  const res = await app.inject({ method: "POST", url, payload })
  expect(res.statusCode, res.body).toBe(200)
  const insert = vi.mocked(supabase.from).mock.results[0]!.value as { insert: ReturnType<typeof vi.fn> }
  return {
    queued: queued(),
    persisted: (insert.insert.mock.calls.at(-1)![0] as Record<string, unknown>).input_data as Record<string, unknown>,
    identifier: reservedIdentifier(),
  }
}

/**
 * What the credit guard checks and reserves for `payload`: the route's own
 * pre-checks, then its identifier and its amount, in the order the guard and
 * `POST /v1/quote` run them (this file stubs the guard itself out).
 */
async function guardPrice(pricing: RoutePricing, payload: Record<string, unknown>): Promise<{ identifier: string; credits: number | null }> {
  const priceApp = Fastify({ logger: false })
  priceApp.post("/price", { preHandler: [...pricing.prechecks] }, async (req) => {
    const identifier = pricing.modelResolver(req)
    const credits = await pricing.opts?.computeCredits?.(req.body, req)
    return { identifier, credits: credits ?? null }
  })
  await priceApp.ready()
  try {
    const res = await priceApp.inject({ method: "POST", url: "/price", payload })
    expect(res.statusCode, res.body).toBe(200)
    return res.json()
  } finally {
    await priceApp.close()
  }
}

const TASK_TYPE_ROUTES = [
  { url: "/v1/text-to-video", pricing: textToVideoPricing },
  { url: "/v1/generate-video", pricing: generateVideoPricing },
]

for (const route of TASK_TYPE_ROUTES) {
  describe(`POST ${route.url} — Seedance 2.5 referenceTaskType`, () => {
    const base = { prompt: "make it black and white", userId: USER, provider: "seedance-2-5", referenceVideoUrls: [REF_VIDEO] }
    const asked = { ...base, aspectRatio: "16:9", duration: 5 }
    const editShape = { ...base, aspectRatio: "adaptive", duration: -1 }

    it("an edit of a 6 s clip is queued and recorded adaptive at Auto length, with the declaration", async () => {
      await withClipsOf(6, async () => {
        const edit = await runOnce(route.url, { ...asked, referenceTaskType: "edit" })
        expect(edit.queued).toMatchObject({ referenceTaskType: "edit", aspectRatio: "adaptive", duration: -1 })
        expect(edit.persisted).toMatchObject({ referenceTaskType: "edit", aspectRatio: "adaptive", duration: -1 })

        // The run IS the edit-shaped request plus the declaration: nothing else moves.
        const shaped = await runOnce(route.url, editShape)
        expect(edit.queued).toStrictEqual({ ...shaped.queued, referenceTaskType: "edit" })
        expect(edit.persisted).toStrictEqual({ ...shaped.persisted, referenceTaskType: "edit" })
        expect(edit.identifier).toBe(shaped.identifier)
      })
    })

    it("an edit reserves what the same body sent as adaptive at Auto length reserves", async () => {
      await withClipsOf(6, async () => {
        const edit = await guardPrice(route.pricing, { ...asked, referenceTaskType: "edit" })
        const shaped = await guardPrice(route.pricing, editShape)
        expect(edit).toStrictEqual(shaped)
        // …and not what the ratio and length it asked for would have reserved.
        expect(edit).not.toStrictEqual(await guardPrice(route.pricing, asked))
      })
    })

    it("an edit of a 3 s clip declares nothing: its own ratio and length, no declaration", async () => {
      await withClipsOf(3, async () => {
        const run = await runOnce(route.url, { ...asked, referenceTaskType: "edit" })
        expect(run.queued).toMatchObject({ aspectRatio: "16:9", duration: 5 })
        expect(run.persisted).toMatchObject({ aspectRatio: "16:9", duration: 5 })
        expect(run.queued).not.toHaveProperty("referenceTaskType")
        expect(run.persisted).not.toHaveProperty("referenceTaskType")
      })
    })

    it('"auto" is queued and recorded exactly like a body without the field', async () => {
      await withClipsOf(6, async () => {
        const auto = await runOnce(route.url, { ...asked, referenceTaskType: "auto" })
        const none = await runOnce(route.url, asked)
        expect(auto.queued).toStrictEqual(none.queued)
        expect(auto.persisted).toStrictEqual(none.persisted)
        expect(none.queued).not.toHaveProperty("referenceTaskType")
        expect(none.persisted).not.toHaveProperty("referenceTaskType")
        expect(await guardPrice(route.pricing, { ...asked, referenceTaskType: "auto" })).toStrictEqual(await guardPrice(route.pricing, asked))
      })
    })

    // "Auto" (generate-video's spelling) or "auto" with a reference video already
    // runs at "adaptive" — the ratio edit and extend force — so nothing is replaced.
    it("an edit or extend asked at the Auto ratio reports no ratio adjustment; asked at 16:9 it still does", async () => {
      const autoToken = route.url === "/v1/generate-video" ? "Auto" : "auto"
      await withClipsOf(6, async () => {
        for (const [referenceTaskType, duration] of [["edit", -1], ["extend", 8]] as const) {
          const atAuto = await app.inject({ method: "POST", url: route.url, payload: { ...base, aspectRatio: autoToken, duration, referenceTaskType } })
          expect(atAuto.statusCode, atAuto.body).toBe(200)
          expect(atAuto.json(), referenceTaskType).toEqual({ jobId: "job-1" })
          expect(queued()).toMatchObject({ referenceTaskType, aspectRatio: "adaptive", duration })

          const at169 = await app.inject({ method: "POST", url: route.url, payload: { ...base, aspectRatio: "16:9", duration, referenceTaskType } })
          expect(at169.statusCode, at169.body).toBe(200)
          expect(at169.json().adjustments, referenceTaskType).toEqual([expect.objectContaining({ field: "aspectRatio", from: "16:9", to: "adaptive" })])
          expect(queued()).toMatchObject({ referenceTaskType, aspectRatio: "adaptive", duration })
        }
      })
    })

    it("a model other than Seedance 2.5 ignores the field", async () => {
      const other = { ...asked, provider: "seedance-2", duration: 8 }
      const declared = await runOnce(route.url, { ...other, referenceTaskType: "edit" })
      const none = await runOnce(route.url, other)
      expect(declared.queued).toStrictEqual(none.queued)
      expect(declared.persisted).toStrictEqual(none.persisted)
    })
  })
}
