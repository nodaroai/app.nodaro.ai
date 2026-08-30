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

import { generateVideoRoutes } from "../generate-video.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import {
  getStylePromptHint,
  getStyleTerm,
  getTransitionPromptHint,
  getTransitionTerm,
  buildAtmosphereHints,
  buildPhotographerHints,
} from "@nodaro/prompts"

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
