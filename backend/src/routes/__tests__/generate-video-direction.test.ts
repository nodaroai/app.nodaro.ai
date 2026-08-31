import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import (mirrors generate-video.test.ts)
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    },
  }
})

vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) },
  redis: {},
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "usage-1",
    creditsReserved: 1,
    watermark: false,
  }),
}))

vi.mock("@/ee/billing/credits.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, getModelCreditBaseCost: vi.fn().mockResolvedValue({ creditCost: 4 }) }
})

vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, probeMediaDuration: vi.fn() }
})

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateVideoRoutes, assembleVideoConnectedReferences } from "../generate-video.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import {
  getStylePromptHint,
  getStyleTerm,
  getTransitionPromptHint,
  getTransitionTerm,
  buildAtmosphereHints,
  buildPhotographerHints,
  composeVideoPromptText,
  renderDirectionHints,
  VIDEO_HINT_MODE_DEFAULT,
} from "@nodaro/prompts"
import { getMaxVideoPromptChars } from "@nodaro/shared"

/**
 * `/v1/generate-video`'s cinematic `direction` channel, end to end.
 *
 * The composer's own semantics are pinned in
 * `packages/prompts/src/__tests__/assemble-video-input.test.ts`; what is proved
 * HERE is everything the route owns and the composer cannot know about:
 *
 *  - the fold reaches the queued payload AND `jobs.input_data`,
 *  - `input_data.userPrompt` keeps the user's SOURCE words while
 *    `input_data.prompt` carries the render (including the direction-only run
 *    with no submitted prompt at all, where the naive path would record the
 *    render as the user's own words),
 *  - the fold SITE — the hints land inside the body the reference resolver
 *    frames, in BOTH reference formats (legacy prepends its character block,
 *    hybrid appends role phrases), and reference numbering is untouched,
 *  - the wire is tolerant: image-only dimensions, unknown ids and over-cap
 *    arrays all degrade to a 200,
 *  - and, above all, a request with NO direction is byte-identical.
 *
 * `NODE_ENV=test` forces the LEGACY reference format (`backendHybridRoles()`),
 * so every assertion here is a legacy assertion unless the case says otherwise.
 */

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })
  await app.register(async (instance) => {
    await generateVideoRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function mockJobInsert(result: { data: unknown; error: unknown }) {
  const mockSingle = vi.fn().mockResolvedValue(result)
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)
  return { mockInsert }
}

const USER = "00000000-0000-4000-8000-000000000001"
const STYLE = "cinematic"
const TRANSITION = "cross-dissolve"
const PHOTOGRAPHER = "tim-walker"

async function post(payload: Record<string, unknown>) {
  const { mockInsert } = mockJobInsert({ data: { id: "job-dir" }, error: null })
  const res = await app.inject({ method: "POST", url: "/v1/generate-video", payload })
  const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as
    | Record<string, unknown>
    | undefined
  const inputData = mockInsert.mock.calls.at(-1)?.[0]?.input_data as
    | Record<string, unknown>
    | undefined
  return { res, queued, inputData }
}

const BASE = {
  userId: USER,
  provider: "seedance-2",
  imageUrl: "https://cdn.example/frame.png",
}

describe("POST /v1/generate-video — the direction channel", () => {
  it("folds the direction ids into the queued prompt and into input_data.prompt", async () => {
    const { res, queued, inputData } = await post({
      ...BASE,
      prompt: "a knight rides",
      direction: { style: STYLE },
    })
    expect(res.statusCode).toBe(200)
    expect(queued!.prompt).toBe(`a knight rides. ${getStylePromptHint(STYLE)}`)
    expect(inputData!.prompt).toBe(`a knight rides. ${getStylePromptHint(STYLE)}`)
  })

  it("is byte-identical when `direction` is absent (the parity oracle, restated)", async () => {
    const { queued, inputData } = await post({ ...BASE, prompt: "a knight rides" })
    expect(queued!.prompt).toBe("a knight rides")
    expect(inputData!.prompt).toBe("a knight rides")
    expect(inputData!.userPrompt).toBe("a knight rides")
  })

  it("records the SOURCE prompt in userPrompt and the RENDER in prompt", async () => {
    const { inputData } = await post({
      ...BASE,
      prompt: "a knight rides",
      direction: { style: STYLE },
    })
    expect(inputData!.userPrompt).toBe("a knight rides")
    expect(inputData!.prompt).toBe(`a knight rides. ${getStylePromptHint(STYLE)}`)
  })

  it("keeps userPrompt empty on a direction-only run with no submitted prompt", async () => {
    // Without the route's `?? ""`, buildJobInputData would mirror the RENDER
    // into userPrompt and the channel would forge words the user never typed.
    const { queued, inputData } = await post({ ...BASE, direction: { style: STYLE } })
    expect(queued!.prompt).toBe(getStylePromptHint(STYLE))
    expect(inputData!.prompt).toBe(getStylePromptHint(STYLE))
    expect(inputData!.userPrompt).toBe("")
  })

  it("records the submitted IDS verbatim in input_data.direction (source, not render)", async () => {
    const { inputData } = await post({
      ...BASE,
      prompt: "a knight rides",
      direction: { style: STYLE, transition: TRANSITION },
    })
    expect(inputData!.direction).toEqual({ style: STYLE, transition: TRANSITION })
  })

  it("applies the verbosity policy: look full, motion compact", async () => {
    const { queued } = await post({
      ...BASE,
      prompt: "a knight rides",
      direction: { style: STYLE, transition: TRANSITION },
    })
    const prompt = queued!.prompt as string
    expect(prompt).toContain(getStylePromptHint(STYLE))
    expect(prompt).toContain(getTransitionTerm(TRANSITION))
    expect(prompt).not.toContain(getTransitionPromptHint(TRANSITION))
  })
})

describe("POST /v1/generate-video — the fold SITE relative to reference assembly", () => {
  it("LEGACY: the character block still PRECEDES the folded hints", async () => {
    const { queued } = await post({
      ...BASE,
      prompt: "she walks",
      direction: { style: STYLE },
      connectedReferences: [
        {
          id: "r1",
          defaultName: "Kira",
          source: "wired-character",
          url: "https://cdn.example/kira.png",
          characterSlug: "kira",
          characterCanonicalDescription: "auburn hair, hazel eyes",
        },
      ],
    })
    const prompt = queued!.prompt as string
    const hint = getStylePromptHint(STYLE)
    expect(prompt).toContain("Use these characters:")
    expect(prompt).toContain(hint)
    // The fold ran on the BODY, so the resolver's framing wraps it.
    expect(prompt.indexOf("Use these characters:")).toBeLessThan(prompt.indexOf(hint))
  })

  it("HYBRID: the hints sit in the body, before the trailing role phrases", async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevFmt = process.env.IMAGE_REFERENCE_FORMAT
    try {
      process.env.NODE_ENV = "development"
      process.env.IMAGE_REFERENCE_FORMAT = "hybrid"
      const { queued } = await post({
        ...BASE,
        prompt: "she walks",
        direction: { style: STYLE },
        connectedReferences: [
          {
            id: "r1",
            defaultName: "Kira",
            source: "wired-character",
            url: "https://cdn.example/kira.png",
            characterSlug: "kira",
            characterCanonicalDescription: "auburn hair, hazel eyes",
          },
        ],
      })
      const prompt = queued!.prompt as string
      const hint = getStylePromptHint(STYLE)
      expect(prompt).toContain(hint)
      expect(prompt).not.toContain("Use these characters:")
      // The canonical role phrase (`the person from @image_1`) is APPENDED by
      // the resolver, so it must come after the folded body — the whole reason
      // the fold runs first.
      const roleAt = prompt.search(/the \w+ from @image_\d/)
      expect(roleAt).toBeGreaterThan(-1)
      expect(prompt.indexOf(hint)).toBeLessThan(roleAt)
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevFmt === undefined) delete process.env.IMAGE_REFERENCE_FORMAT
      else process.env.IMAGE_REFERENCE_FORMAT = prevFmt
    }
  })

  it("does not perturb reference numbering or the assembled reference list", async () => {
    const refs = [
      {
        id: "r1",
        defaultName: "object",
        source: "wired-image",
        url: "https://cdn.example/car.png",
        description: "a red car",
      },
    ]
    const withOut = await post({
      ...BASE,
      prompt: "drive {image:1:car} fast",
      connectedReferences: refs,
    })
    const withDir = await post({
      ...BASE,
      prompt: "drive {image:1:car} fast",
      direction: { style: STYLE },
      connectedReferences: refs,
    })
    expect(withDir.queued!.prompt).toContain("the car from @image_1")
    // The billed quantity — the assembled reference count — cannot move.
    expect(withDir.queued!.referenceImageUrls).toEqual(withOut.queued!.referenceImageUrls)
  })

  it("appends the injected character context AFTER the folded body", async () => {
    vi.mocked(supabase.from).mockImplementation(
      ((table: string) => {
        if (table === "characters") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  is: () => ({
                    single: vi.fn().mockResolvedValue({
                      data: { canonical_description: "auburn hair, hazel eyes", name: "Kira" },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-inj" }, error: null })
        return { insert: () => ({ select: () => ({ single: mockSingle }) }) }
      }) as never,
    )
    await app.inject({
      method: "POST",
      url: "/v1/generate-video",
      payload: {
        ...BASE,
        prompt: "she walks",
        direction: { style: STYLE },
        injectCharacterContext: true,
        attachToCharacterId: "00000000-0000-4000-8000-0000000000aa",
      },
    })
    const prompt = vi.mocked(videoQueue.add).mock.calls.at(-1)![1].prompt as string
    const hint = getStylePromptHint(STYLE)
    expect(prompt).toContain(hint)
    expect(prompt.indexOf(hint)).toBeLessThan(prompt.indexOf("auburn hair, hazel eyes"))
  })
})

describe("POST /v1/generate-video — wire tolerance", () => {
  it("accepts an image-only dimension and folds nothing from it", async () => {
    // Surface is a render concern, not a wire concern.
    expect(buildPhotographerHints(PHOTOGRAPHER, "full").length).toBeGreaterThan(0)
    const { res, queued } = await post({
      ...BASE,
      prompt: "a knight rides",
      direction: { photographer: PHOTOGRAPHER },
    })
    expect(res.statusCode).toBe(200)
    expect(queued!.prompt).toBe("a knight rides")
  })

  it("slices an over-cap array to the dimension's maxPicks instead of 400ing", async () => {
    const { res, queued } = await post({
      ...BASE,
      prompt: "a knight rides",
      direction: { atmosphere: ["clear", "cloudy", "overcast"] },
    })
    expect(res.statusCode).toBe(200)
    const kept = buildAtmosphereHints(["clear", "cloudy"], "full")
    expect(queued!.prompt).toBe(`a knight rides. ${kept.join(". ")}`)
    expect(queued!.prompt).not.toContain(buildAtmosphereHints("overcast", "full")[0])
  })

  it("skips an unknown id and leaves the prompt unchanged", async () => {
    const { res, queued } = await post({
      ...BASE,
      prompt: "a knight rides",
      direction: { style: "__no_such_id__" },
    })
    expect(res.statusCode).toBe(200)
    expect(queued!.prompt).toBe("a knight rides")
  })

  it("strips an unknown dimension key (non-strict schema) rather than 400ing", async () => {
    const { res, queued, inputData } = await post({
      ...BASE,
      prompt: "a knight rides",
      direction: { __not_a_dimension__: "x", style: STYLE },
    })
    expect(res.statusCode).toBe(200)
    expect(queued!.prompt).toBe(`a knight rides. ${getStylePromptHint(STYLE)}`)
    expect(inputData!.direction).toEqual({ style: STYLE })
  })

  it("rejects a direction value that is not a string or string array", async () => {
    const { res } = await post({
      ...BASE,
      prompt: "a knight rides",
      direction: { style: 42 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("honors the compact term when the whole fold is a motion dimension", async () => {
    const { queued } = await post({
      ...BASE,
      prompt: "a knight rides",
      direction: { transition: TRANSITION },
    })
    expect(queued!.prompt).toBe(`a knight rides. ${getTransitionTerm(TRANSITION)}`)
    // …and the look family is NOT compacted along with it.
    expect(getStyleTerm(STYLE)).not.toBe(getStylePromptHint(STYLE))
  })
})

/**
 * TRUNCATION ORDERING, at the route. The composer's shed arithmetic is pinned in
 * `packages/prompts/src/__tests__/assemble-video-input-cap.test.ts`; what is
 * proved HERE is the WIRING — that the route actually hands the composer the
 * EFFECTIVE ceiling AND the reference framing. Both package suites can pass
 * while the route forgets one of the two, and the failure would be invisible
 * (a silently clamped prompt), so it gets its own end-to-end assertion.
 *
 * Provider choice is forced by the catalog: the shed only matters where the
 * body is FRAMED, so the test needs a provider that both carries image
 * references and has a low prompt cap. `grok-i2v` is the tightest such pair
 * (5000 chars, 7 image refs) — kling's 1000 cap looks like the sharper test but
 * kling carries no image references at all, so nothing frames the body there.
 */
describe("POST /v1/generate-video — over-cap direction sheds hints, never bindings", () => {
  // Broad but ordinary direction — the kind a "set every picker" UI emits.
  const BIG_DIRECTION = {
    cameraMotion: "handheld",
    shotSize: "wide-shot",
    angle: "low-angle",
    timeOfDay: "golden-hour",
    lightingStyle: "rembrandt",
    colorLook: "teal-orange",
    atmosphere: ["fog"],
    style: "cinematic",
    mood: ["happy", "joyful"],
    setting: "forest",
  }
  // 219 is TUNED, not arbitrary: it puts the shed decision inside the window
  // where the resolver's appended role phrases are what tips the prompt over the
  // ceiling. Drop the frame from the route wiring and this case really does
  // overflow (and severs the trailing binding) rather than passing by luck.
  const TAIL = "The waves are loud. ".repeat(219)
  const PROSE = `@kira:1 walks the seawall at dusk. ${TAIL}`
  const REFS = [
    {
      id: "r1",
      defaultName: "Kira",
      source: "wired-character",
      url: "https://cdn.example/kira.png",
      characterSlug: "kira",
      characterCanonicalDescription: "auburn hair, hazel eyes",
    },
    {
      id: "r2",
      defaultName: "Ray",
      source: "wired-character",
      url: "https://cdn.example/ray.png",
      characterSlug: "ray",
      characterCanonicalDescription: "a grizzled dockworker",
    },
  ]
  const CAP = getMaxVideoPromptChars("grok-i2v")
  const HINTS = renderDirectionHints(BIG_DIRECTION, {
    surface: "video",
    mode: VIDEO_HINT_MODE_DEFAULT,
  })

  // The resolver reads the format env at CALL time, so anything that has to see
  // the same framing the route saw must run inside this window — the arithmetic
  // guards below included, not just the request.
  async function inHybrid<T>(fn: () => T | Promise<T>): Promise<T> {
    const prevNodeEnv = process.env.NODE_ENV
    const prevFmt = process.env.IMAGE_REFERENCE_FORMAT
    try {
      process.env.NODE_ENV = "development"
      process.env.IMAGE_REFERENCE_FORMAT = "hybrid"
      return await fn()
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevFmt === undefined) delete process.env.IMAGE_REFERENCE_FORMAT
      else process.env.IMAGE_REFERENCE_FORMAT = prevFmt
    }
  }

  const postHybrid = (payload: Record<string, unknown>) => inHybrid(() => post(payload))

  /**
   * The route's own `frame`, rebuilt. Used only to prove the guards below are
   * not vacuous: how much a frame-BLIND shed would still overflow by is the
   * entire signal that `frame` (as opposed to `cap` alone) is wired at all.
   *
   * On this provider that margin is THIN — 40 characters in the plain hybrid
   * case and 1 in the `Avoid` one (hybrid framing appends only short role
   * phrases, ~21 chars each, and `TAIL`'s repeat count is tuned to land inside
   * that window). Thin is fine as long as it is ASSERTED: a catalog wording
   * change that closes it now fails here, loudly, instead of quietly
   * downgrading these cases to "proves shedding happens" while the `frame`
   * wiring goes untested. If one does go red, retune `TAIL` — do not delete the
   * guard. `text-to-video.test.ts` covers the same wiring with a much wider
   * margin (the legacy character block is worth hundreds of characters).
   */
  const frameHybrid = (body: string | undefined) =>
    inHybrid(
      () =>
        assembleVideoConnectedReferences({
          prompt: body,
          provider: "grok-i2v",
          connectedReferences: REFS as never,
          referenceVideoCount: 0,
          referenceAudioCount: 0,
        }).prompt!,
    )

  it("HYBRID: the queued prompt fits the cap with every binding and the prose intact", async () => {
    const { res, queued } = await postHybrid({
      ...BASE,
      provider: "grok-i2v",
      prompt: PROSE,
      direction: BIG_DIRECTION,
      connectedReferences: REFS,
    })
    expect(res.statusCode).toBe(200)
    const prompt = queued!.prompt as string

    // NON-VACUITY (1): the unshed fold really would have overflowed, so the
    // provider clamp really would have cut this prompt's tail.
    expect((composeVideoPromptText(PROSE, BIG_DIRECTION) as string).length).toBeGreaterThan(CAP)

    // NON-VACUITY (2) — the half that pins `frame` rather than `cap`: a shed
    // that budgeted the BARE body is still over the ceiling once the resolver's
    // appended role phrases are counted. Without this the case would pass on
    // `cap` alone and the missing `frame` would be invisible.
    const frameBlind = composeVideoPromptText(PROSE, BIG_DIRECTION, undefined, { cap: CAP })
    expect((await frameHybrid(frameBlind)).length).toBeGreaterThan(CAP)

    // The route shed enough that the clamp is never reached.
    expect(prompt.length).toBeLessThanOrEqual(CAP)

    // Both bindings survive — the mention resolved INLINE and Ray's
    // canonical-fallback role phrase, which the resolver APPENDS last and which
    // an order-blind tail cut destroys first.
    expect(prompt).toContain("@image_1")
    expect(prompt).toContain("@image_2")
    expect(prompt.lastIndexOf("@image_2")).toBeGreaterThan(prompt.indexOf(HINTS[0]))
    expect(queued!.referenceImageUrls).toEqual([
      "https://cdn.example/kira.png",
      "https://cdn.example/ray.png",
    ])

    // The user's prose survives in full.
    expect(prompt).toContain(TAIL.trim())

    // Trailing hints went; the first-folded one stayed.
    expect(prompt).not.toContain(HINTS[HINTS.length - 1])
    expect(prompt).toContain(HINTS[0])
  })

  it("an under-cap run on the same direction is byte-identical to the capless fold", async () => {
    // A high-cap provider takes the whole fold, so the shed leg stays dark and
    // the wiring costs nothing on the overwhelming majority of runs.
    const { queued } = await post({
      ...BASE,
      provider: "seedance-2",
      prompt: "a knight rides",
      direction: BIG_DIRECTION,
    })
    expect(queued!.prompt).toBe(composeVideoPromptText("a knight rides", BIG_DIRECTION))
  })

  it("sheds against the ceiling the Avoid suffix leaves, not the raw model cap", async () => {
    // `grok-i2v` is OUTSIDE NATIVE_NEGATIVE_VIDEO_PROVIDERS, so the clamp folds
    // the negative in as "\nAvoid: …" and reserves its room FIRST. Budgeting on
    // the raw cap would shed too little and let the clamp cut after all. This is
    // the leg a native-negative provider structurally cannot cover, and it is
    // the reason the route passes `effectiveVideoPromptCeiling` rather than
    // letting the composer read `getMaxVideoPromptChars` itself.
    const negativePrompt = "blurry, low quality, distorted faces, watermark, text overlay, jitter"
    const reserved = CAP - `\nAvoid: ${negativePrompt}`.length
    const withNeg = await postHybrid({
      ...BASE,
      provider: "grok-i2v",
      prompt: PROSE,
      direction: BIG_DIRECTION,
      connectedReferences: REFS,
      negativePrompt,
    })
    const withoutNeg = await postHybrid({
      ...BASE,
      provider: "grok-i2v",
      prompt: PROSE,
      direction: BIG_DIRECTION,
      connectedReferences: REFS,
    })
    const prompt = withNeg.queued!.prompt as string

    expect(reserved).toBeLessThan(CAP) // the assertion below has teeth
    // …and so does the framing, at the reserved ceiling too: a frame-blind shed
    // budgeted on `reserved` still overflows it once the resolver's text lands.
    const frameBlind = composeVideoPromptText(PROSE, BIG_DIRECTION, undefined, { cap: reserved })
    expect((await frameHybrid(frameBlind)).length).toBeGreaterThan(reserved)
    expect(prompt.length).toBeLessThanOrEqual(reserved)
    // Strictly more shedding than the same request without a negative — proof
    // the reservation, not just the cap, drove the decision.
    expect(prompt.length).toBeLessThan((withoutNeg.queued!.prompt as string).length)
    // …and the prose is still untouched: only hints paid for the suffix.
    expect(prompt).toContain(TAIL.trim())
  })
})
