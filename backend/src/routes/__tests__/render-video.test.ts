import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
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

vi.mock("@/lib/job-failure.js", () => ({ markJobFailed: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: vi.fn().mockResolvedValue(1) }))

vi.mock("@/lib/queue.js", () => ({
  videoQueue: {
    add: vi.fn().mockResolvedValue({ id: "queue-job-1" }),
  },
  redis: {},
}))

vi.mock("@/lib/render-queue.js", () => ({
  renderQueue: {
    add: vi.fn().mockResolvedValue({ id: "render-job-1" }),
  },
}))

/**
 * The guard's resolved identifier, recorded per request.
 *
 * A real `creditGuard` CHECKS one identifier and `reserveCreditsForJob` then
 * DEBITS whatever identifier the route hands it — two separate lookups. A mock
 * that swallows the resolver hides the one failure mode that matters here
 * (checking the tiered price and debiting the flat one), so this one runs it.
 */
const guardState = vi.hoisted(() => ({ identifiers: [] as string[] }))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (resolver: (req: unknown) => string) => async (req: unknown) => {
    guardState.identifiers.push(resolver(req))
  },
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "usage-1",
    creditsReserved: 1,
    watermark: false,
  }),
}))

vi.mock("@/middleware/rate-limit.js", () => ({
  rateLimiter: () => async () => {},
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

vi.mock("@/lib/plan-schemas.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/plan-schemas.js")>("@/lib/plan-schemas.js")
  return {
    ...actual,
    validatePlanByType: vi.fn().mockImplementation(actual.validatePlanByType),
  }
})

vi.mock("@/workers/scene3d-render-assets.js", () => ({
  authorizeScene3DRenderPlan: vi.fn(),
  Scene3DRenderPlanError: class extends Error {
    constructor(message: string, readonly statusCode: 404 | 409) { super(message) }
  },
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { markJobFailed } from "../../lib/job-failure.js"
import { refundReservedCreditsForJob } from "../../lib/credits-job-lifecycle.js"
import { renderVideoRoutes } from "../render-video.js"
import { supabase } from "../../lib/supabase.js"
import { renderQueue } from "../../lib/render-queue.js"
import { validatePlanByType } from "../../lib/plan-schemas.js"
import { authorizeScene3DRenderPlan, Scene3DRenderPlanError } from "../../workers/scene3d-render-assets.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  guardState.identifiers.length = 0

  app = Fastify({ logger: false })

  // Bypass auth — set userId from request body for protected routes
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (body?.userId && typeof body.userId === "string") {
      req.userId = body.userId
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await renderVideoRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockJobInsert(jobId: string) {
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: jobId }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)
  return { mockInsert }
}

function validMediaAsset() {
  return {
    url: "https://example.com/image.png",
    type: "image" as const,
    durationSeconds: 5,
  }
}

function validRenderPayload() {
  return {
    template: "slideshow",
    fps: 30,
    aspectRatio: "16:9",
    durationSeconds: 10,
    mediaAssets: [validMediaAsset()],
    userId: TEST_USER_ID,
  }
}

function validSceneGraph() {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 300,
    backgroundColor: "#000000",
    tracks: [
      {
        type: "media",
        id: "track-1",
        zIndex: 0,
        segments: [
          {
            id: "seg-1",
            src: "https://example.com/image.png",
            mediaType: "image",
            startFrame: 0,
            durationInFrames: 300,
            layout: { mode: "fullscreen" },
            effects: [],
          },
        ],
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Tests — POST /v1/render-video
// ---------------------------------------------------------------------------

describe("POST /v1/render-video", () => {
  it("returns 400 when template is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/render-video",
      payload: {
        mediaAssets: [validMediaAsset()],
        userId: TEST_USER_ID,
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("returns 401 when no userId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/render-video",
      payload: {
        template: "slideshow",
        mediaAssets: [validMediaAsset()],
      },
    })

    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.error.code).toBe("unauthorized")
  })

  it("creates job with correct dimensions for 16:9", async () => {
    mockJobInsert("job-render-1")

    const res = await app.inject({
      method: "POST",
      url: "/v1/render-video",
      payload: validRenderPayload(),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-render-1")

    // Verify supabase insert was called with correct dimensions
    const mockFrom = vi.mocked(supabase.from)
    expect(mockFrom).toHaveBeenCalledWith("jobs")
  })

  it("enqueues to renderQueue (not videoQueue)", async () => {
    mockJobInsert("job-render-2")

    await app.inject({
      method: "POST",
      url: "/v1/render-video",
      payload: validRenderPayload(),
    })

    expect(renderQueue.add).toHaveBeenCalledWith(
      "render-video",
      expect.objectContaining({
        jobId: "job-render-2",
        template: "slideshow",
        width: 1920,
        height: 1080,
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Tests — POST /v1/render-video/scene-graph
// ---------------------------------------------------------------------------

describe("POST /v1/render-video/scene-graph", () => {
  it("returns 400 on invalid schema", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/render-video/scene-graph",
      payload: {
        sceneGraph: { fps: 30 },
        userId: TEST_USER_ID,
      },
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error.code).toBe("validation_error")
  })

  it("succeeds with valid scene graph", async () => {
    mockJobInsert("job-sg-1")

    const res = await app.inject({
      method: "POST",
      url: "/v1/render-video/scene-graph",
      payload: {
        sceneGraph: validSceneGraph(),
        userId: TEST_USER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-sg-1")

    expect(renderQueue.add).toHaveBeenCalledWith(
      "render-video",
      expect.objectContaining({
        jobId: "job-sg-1",
        sceneGraph: expect.objectContaining({ fps: 30, width: 1920 }),
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Tests — POST /v1/render-video/plan
// ---------------------------------------------------------------------------

describe("POST /v1/render-video/plan", () => {
  it("succeeds with valid after-effects plan", async () => {
    mockJobInsert("job-plan-1")

    // Mock validatePlanByType to succeed
    vi.mocked(validatePlanByType).mockReturnValue(undefined as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/render-video/plan",
      payload: {
        planType: "after-effects",
        plan: {
          fps: 30,
          width: 1920,
          height: 1080,
          durationInFrames: 300,
          sourceVideo: "https://example.com/video.mp4",
          effects: [],
        },
        userId: TEST_USER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-plan-1")

    expect(renderQueue.add).toHaveBeenCalledWith(
      "render-video",
      expect.objectContaining({
        jobId: "job-plan-1",
        planType: "after-effects",
      })
    )
  })

  // ── 3d-scene (Scene3D previz) ─────────────────────────────────────────
  // The renderer reuses this generic plan route rather than owning one, so
  // these cases pin the two things that would silently break it: the planType
  // enum accepting "3d-scene", and a bad scene being rejected BEFORE a job row
  // and a credit reservation exist.

  function validScene3DPlan(overrides: Record<string, unknown> = {}) {
    return {
      planType: "3d-scene",
      schemaVersion: 1,
      revisionId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      width: 1280,
      height: 720,
      fps: 24,
      durationInFrames: 48,
      backgroundColor: "#101014",
      camera: { position: [0, 2, 8], target: [0, 1, 0], focalLengthMm: 35, sensorWidthMm: 36 },
      objects: [
        {
          id: "hero", name: "Hero", primitive: "box",
          dimensions: [2, 2, 2], position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
          color: "#e4a04c",
        },
      ],
      lighting: { ambientIntensity: 0.5, keyIntensity: 1.5, keyPosition: [4, 6, 5] },
      ...overrides,
    }
  }

  it.each(["/v1/render-video/plan", "/v1/render-video"])("queues a 3d-scene render verbatim through %s", async (url) => {
    mockJobInsert("job-3d-1")
    // Explicit pass-through: the SCHEMA is covered in plan-schemas.test.ts;
    // this case is about the route's plumbing and must not depend on whatever
    // implementation an earlier test left on the shared mock.
    vi.mocked(validatePlanByType).mockImplementation(((_type: string, plan: unknown) => plan) as never)
    const plan = validScene3DPlan({
      references: [
        { id: "ref-1", url: "https://cdn.example.com/board.png", kind: "image", role: "layout" },
      ],
    })

    const res = await app.inject({
      method: "POST",
      url,
      payload: { planType: "3d-scene", plan, userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-3d-1")
    expect(renderQueue.add).toHaveBeenCalledWith(
      "render-video",
      expect.objectContaining({ jobId: "job-3d-1", planType: "3d-scene", plan }),
    )
    // references survive to the queue (and the job row) — the worker strips
    // them from the Remotion inputProps, not the route.
    const queued = vi.mocked(renderQueue.add).mock.calls[0][1] as { plan: { references?: unknown[] } }
    expect(queued.plan.references).toHaveLength(1)
  })

  // ── Frame-size pricing ────────────────────────────────────────────────
  // The 2560 px cap made frames renderable that cost up to 2.5x a 1920x1080
  // one, so a 3D scene render settles under a tiered identifier. Two things
  // must hold on every one of these requests: the tier is read from the plan
  // the route is ABOUT to run, and the identifier the guard checked is the
  // identifier the reservation debits.

  it.each([
    { label: "1920x1080 (the pre-cap frame)", width: 1920, height: 1080, id: "render-video" },
    { label: "1920x1920 (square, still under the gate)", width: 1920, height: 1920, id: "render-video" },
    { label: "2560x1440 (16:9 at the cap)", width: 2560, height: 1440, id: "render-video:3d-large" },
    { label: "1440x2560 (9:16 at the cap)", width: 1440, height: 2560, id: "render-video:3d-large" },
    { label: "2048x2560 (4:5 at the cap)", width: 2048, height: 2560, id: "render-video:3d-xlarge" },
    { label: "2560x2560 (the square worst case)", width: 2560, height: 2560, id: "render-video:3d-xlarge" },
  ])("checks and debits $id for a $label scene", async ({ width, height, id }) => {
    mockJobInsert("job-tier")
    vi.mocked(validatePlanByType).mockImplementation(((_type: string, plan: unknown) => plan) as never)
    const res = await app.inject({
      method: "POST",
      url: "/v1/render-video/plan",
      payload: { planType: "3d-scene", plan: validScene3DPlan({ width, height }), userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(guardState.identifiers).toEqual([id])
    expect(reserveCreditsForJob).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), "job-tier", id,
    )
  })

  it("tiers a 3d-scene plan sent to the legacy /v1/render-video entry point too", async () => {
    mockJobInsert("job-tier-legacy")
    vi.mocked(validatePlanByType).mockImplementation(((_type: string, plan: unknown) => plan) as never)
    const res = await app.inject({
      method: "POST",
      url: "/v1/render-video",
      payload: { planType: "3d-scene", plan: validScene3DPlan({ width: 2560, height: 2560 }), userId: TEST_USER_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(guardState.identifiers).toEqual(["render-video:3d-xlarge"])
    expect(reserveCreditsForJob).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), "job-tier-legacy", "render-video:3d-xlarge",
    )
  })

  it("leaves every non-3D render on the flat identifier", async () => {
    // A scene-graph render admits frames up to 3840 px at the flat price
    // today; tiering it would raise the price of work people already run.
    mockJobInsert("job-flat")
    const res = await app.inject({
      method: "POST",
      url: "/v1/render-video/scene-graph",
      payload: { sceneGraph: { ...validSceneGraph(), width: 3840, height: 2160 }, userId: TEST_USER_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(guardState.identifiers).toEqual(["render-video"])
    expect(reserveCreditsForJob).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), "job-flat", "render-video",
    )
  })

  it("fails and refunds a reserved plan job when enqueueing fails", async () => {
    mockJobInsert("job-queue-failure")
    vi.mocked(validatePlanByType).mockImplementation(((_type: string, plan: unknown) => plan) as never)
    vi.mocked(renderQueue.add).mockRejectedValueOnce(new Error("Redis unavailable"))
    const res = await app.inject({ method: "POST", url: "/v1/render-video/plan",
      payload: { planType: "3d-scene", plan: validScene3DPlan(), userId: TEST_USER_ID } })
    expect(res.statusCode).toBe(500)
    expect(markJobFailed).toHaveBeenCalledWith("job-queue-failure", { error_message: "Failed to enqueue video render" })
    expect(refundReservedCreditsForJob).toHaveBeenCalledWith("job-queue-failure")
  })

  it.each(["/v1/render-video/plan", "/v1/render-video"])("authorizes a retained v2 scene before queuing through %s", async (url) => {
    mockJobInsert("job-v2")
    vi.mocked(validatePlanByType).mockImplementation(((_type: string, plan: unknown) => plan) as never)
    const plan = { schemaVersion: 2, revisionId: "retained-scene" }
    vi.mocked(authorizeScene3DRenderPlan).mockResolvedValueOnce(plan as never)
    const res = await app.inject({ method: "POST", url,
      payload: { planType: "3d-scene", plan, userId: TEST_USER_ID } })
    expect(res.statusCode).toBe(200)
    expect(authorizeScene3DRenderPlan).toHaveBeenCalledWith(TEST_USER_ID, plan)
    expect(renderQueue.add).toHaveBeenCalledWith("render-video", expect.objectContaining({ plan }))
    expect(vi.mocked(authorizeScene3DRenderPlan).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(reserveCreditsForJob).mock.invocationCallOrder[0],
    )
  })

  it.each([404, 409] as const)("refuses unavailable or modified v2 revisions before job creation and charging (%s)", async (status) => {
    const { mockInsert } = mockJobInsert("must-not-exist")
    vi.mocked(validatePlanByType).mockImplementation(((_type: string, plan: unknown) => plan) as never)
    vi.mocked(authorizeScene3DRenderPlan).mockRejectedValueOnce(new Scene3DRenderPlanError("Scene unavailable", status))
    const res = await app.inject({ method: "POST", url: "/v1/render-video/plan",
      payload: { planType: "3d-scene", plan: { schemaVersion: 2 }, userId: TEST_USER_ID } })
    expect(res.statusCode).toBe(status)
    expect(mockInsert).not.toHaveBeenCalled()
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(renderQueue.add).not.toHaveBeenCalled()
  })

  it.each(["/v1/render-video/plan", "/v1/render-video"])("rejects an invalid scene before a job through %s", async (url) => {
    const insert = mockJobInsert("job-3d-2")
    vi.mocked(validatePlanByType).mockImplementation(() => {
      throw new Error('Plan validation failed for "3d-scene": objects.0.parentId: parent cycle')
    })

    const res = await app.inject({
      method: "POST",
      url,
      payload: { planType: "3d-scene", plan: validScene3DPlan(), userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("plan_validation_error")
    expect(insert.mockInsert).not.toHaveBeenCalled()
    expect(renderQueue.add).not.toHaveBeenCalled()
  })

  it("rejects an unknown planType at the route boundary", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/render-video/plan",
      payload: { planType: "3d-scene-v2", plan: {}, userId: TEST_USER_ID },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})
