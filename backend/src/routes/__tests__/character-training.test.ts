import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { supabase } from "../../lib/supabase.js"
import { characterTrainingRoutes } from "../character-training.js"

vi.mock("../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

// Lazy-getter for PUBLIC_URL so the missing-env test can flip it for one
// assertion without re-mocking the module + rebuilding the Fastify app.
let publicUrlValue = "https://app.test.local"
vi.mock("../../lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    get PUBLIC_URL() {
      return publicUrlValue
    },
    REPLICATE_API_TOKEN: "test-key",
    REPLICATE_WEBHOOK_SECRET: "test-secret",
    R2_BUCKET_NAME: "test-bucket",
    CHARACTER_LORA_ROUTING_ENABLED: true,
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "test-usage-log-id",
  }),
}))

vi.mock("../../providers/replicate/training.js", () => ({
  createCharacterTraining: vi.fn(),
  cancelCharacterTraining: vi.fn(),
  deleteCharacterLora: vi.fn(),
}))

vi.mock("../../lib/character-lora.js", () => ({
  collectTrainingImages: vi.fn().mockReturnValue([
    { url: "https://r2/1.jpg", label: "source" },
    { url: "https://r2/2.jpg", label: "expr_smile" },
    { url: "https://r2/3.jpg", label: "expr_frown" },
    { url: "https://r2/4.jpg", label: "expr_angry" },
  ]),
  zipImagesToR2Buffer: vi.fn().mockResolvedValue({
    key: "character-training/test/123.zip",
    url: "https://r2.example.com/character-training/test/123.zip",
  }),
  buildTriggerWord: vi.fn().mockReturnValue("TOK_kira_a1b2c3"),
  refundReservedCreditsForJob: vi.fn().mockResolvedValue(undefined),
  InsufficientImagesError: class extends Error {
    readonly code = "insufficient_training_images"
    constructor(public readonly count: number) {
      super(`Need at least 4 (have ${count})`)
    }
  },
}))

vi.mock("../../lib/storage.js", () => ({ deleteFromR2: vi.fn() }))

const TEST_USER_ID = "00000000-0000-0000-0000-000000000001"
const TEST_CHARACTER_ID = "00000000-0000-0000-0000-000000000002"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (i) => {
    await characterTrainingRoutes(i)
  })
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/characters/:id/train — atomic CAS slot claim
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /v1/characters/:id/train — atomic CAS slot claim", () => {
  /**
   * Build a chainable mock for the CAS slot-claim UPDATE:
   *   supabase.from("characters").update({...}).eq().eq().is().or().select()
   * Returns `data: [{id}]` on the first call (winner) and `data: []` on the
   * second call (loser) — simulating the atomic race where exactly one
   * caller's UPDATE matches a row.
   */
  function mockCasRace(): { fromMock: ReturnType<typeof vi.fn>; updateCallCount: { count: number } } {
    const updateCallCount = { count: 0 }

    const characterFullRow = {
      id: TEST_CHARACTER_ID,
      name: "Kira",
      source_image_url: "https://r2/source.jpg",
      reference_photos: [],
      expressions: [],
      poses: [],
      angles: [],
      body_angles: [],
      lighting_variations: [],
    }

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === "characters") {
        // The route does TWO different operations on `characters`:
        //   1. CAS UPDATE (.update().eq().eq().is().or().select())
        //   2. Re-load SELECT (.select().eq().eq().single())
        // Distinguish by which method the test caller invokes first.
        return {
          update: vi.fn().mockImplementation(() => {
            updateCallCount.count += 1
            // First caller wins (data: [{id}]), all subsequent lose (data: []).
            const won = updateCallCount.count === 1
            const select = vi
              .fn()
              .mockResolvedValue({ data: won ? [{ id: TEST_CHARACTER_ID }] : [], error: null })
            const or = vi.fn().mockReturnValue({ select })
            const is = vi.fn().mockReturnValue({ or })
            const eq2 = vi.fn().mockReturnValue({ is })
            const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
            return { eq: eq1 }
          }),
          select: vi.fn().mockImplementation(() => {
            const single = vi.fn().mockResolvedValue({ data: characterFullRow, error: null })
            const eq2 = vi.fn().mockReturnValue({ single })
            const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
            return { eq: eq1 }
          }),
        }
      }
      if (table === "jobs") {
        // Insert path: .insert().select("id").single()
        const single = vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null })
        const select = vi.fn().mockReturnValue({ single })
        const insert = vi.fn().mockReturnValue({ select })
        // Update path on the same `jobs` from() — returns chainable.
        const eq2 = vi.fn().mockResolvedValue({ data: null, error: null })
        const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
        const update = vi.fn().mockReturnValue({ eq: eq1 })
        return { insert, update }
      }
      return {} as never
    })

    return { fromMock, updateCallCount }
  }

  it("two concurrent POSTs return one 202 + one 409 with code 'already_training_or_not_found'", async () => {
    const { fromMock } = mockCasRace()
    vi.mocked(supabase.from).mockImplementation(fromMock as never)

    const replicateTraining = await import("../../providers/replicate/training.js")
    vi.mocked(replicateTraining.createCharacterTraining).mockResolvedValue({
      trainingId: "test-replicate-id",
    })

    const trainPayload = {
      method: "POST" as const,
      url: `/v1/characters/${TEST_CHARACTER_ID}/train`,
      headers: { "x-user-id": TEST_USER_ID, "content-type": "application/json" },
      payload: {},
    }
    const [r1, r2] = await Promise.all([app.inject(trainPayload), app.inject(trainPayload)])

    const codes = [r1.statusCode, r2.statusCode].sort()
    expect(codes).toEqual([202, 409])
    // Replicate's training dispatched exactly once — the winner only.
    expect(replicateTraining.createCharacterTraining).toHaveBeenCalledTimes(1)
    // Loser carries the documented error code.
    const loser = r1.statusCode === 409 ? r1 : r2
    expect(loser.json().error).toBe("already_training_or_not_found")
  })

  it("missing req.userId returns 401 before any DB call", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/train`,
      headers: { "content-type": "application/json" },
      payload: {},
    })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe("unauthorized")
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("returns 503 public_url_not_configured when config.PUBLIC_URL is empty", async () => {
    publicUrlValue = ""
    try {
      const res = await app.inject({
        method: "POST",
        url: `/v1/characters/${TEST_CHARACTER_ID}/train`,
        headers: { "x-user-id": TEST_USER_ID, "content-type": "application/json" },
        payload: {},
      })
      expect(res.statusCode).toBe(503)
      expect(res.json().error).toBe("public_url_not_configured")
    } finally {
      publicUrlValue = "https://app.test.local"
    }
  })
})
