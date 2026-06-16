import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { supabase } from "../../lib/supabase.js"
import { characterTrainingRoutes } from "../character-training.js"

vi.mock("../../lib/supabase.js", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

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
  characterModelDestination: (id: string) => `nodaroai/char-${id}`,
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

vi.mock("../../lib/storage.js", () => ({ deleteFromR2: vi.fn().mockResolvedValue(undefined) }))

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

  /**
   * Mocks for the train happy/race path. The CAS slot-claim is now an atomic
   * RPC (claim_character_lora_training, migration 226) — NOT a supabase-js
   * .update().or().select() chain, which PostgREST mis-compiled to 42703
   * ("column characters.lora_training_status does not exist") and 500'd every
   * request. `rpcMock` returns the character id for the first caller (winner)
   * and null for every subsequent caller (loser), simulating the row-lock
   * race. `fromMock` covers the winner's follow-up writes:
   *   characters: re-load SELECT + post-dispatch UPDATE (.eq().eq(), no or/select)
   *   jobs:       insert + status UPDATE
   */
  function mockClaimRace(): {
    fromMock: ReturnType<typeof vi.fn>
    rpcMock: ReturnType<typeof vi.fn>
  } {
    const claimCallCount = { count: 0 }
    const rpcMock = vi.fn().mockImplementation((fnName: string) => {
      if (fnName === "claim_character_lora_training") {
        claimCallCount.count += 1
        const won = claimCallCount.count === 1
        return Promise.resolve({ data: won ? TEST_CHARACTER_ID : null, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })

    const fromMock = vi.fn().mockImplementation((table: string) => {
      if (table === "characters") {
        return {
          // Re-load SELECT: .select().eq().eq().single()
          select: vi.fn().mockImplementation(() => {
            const single = vi.fn().mockResolvedValue({ data: characterFullRow, error: null })
            const eq2 = vi.fn().mockReturnValue({ single })
            const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
            return { eq: eq1 }
          }),
          // Post-dispatch UPDATE (+ catch-block rollback): .update().eq().eq()
          update: vi.fn().mockImplementation(() => {
            const eq2 = vi.fn().mockResolvedValue({ data: null, error: null })
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
        // Update path: .update().eq().eq()
        const eq2 = vi.fn().mockResolvedValue({ data: null, error: null })
        const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
        const update = vi.fn().mockReturnValue({ eq: eq1 })
        return { insert, update }
      }
      return {} as never
    })

    return { fromMock, rpcMock }
  }

  it("two concurrent POSTs return one 202 + one 409, claiming via the RPC (not a .or() UPDATE)", async () => {
    const { fromMock, rpcMock } = mockClaimRace()
    vi.mocked(supabase.from).mockImplementation(fromMock as never)
    vi.mocked(supabase.rpc).mockImplementation(rpcMock as never)

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
    // Claim goes through the atomic RPC with the documented args — guards
    // against regressing to the .update().or().select() form (PostgREST 42703).
    expect(supabase.rpc).toHaveBeenCalledWith("claim_character_lora_training", {
      p_character_id: TEST_CHARACTER_ID,
      p_user_id: TEST_USER_ID,
    })
  })

  it("claim RPC error → 500 claim_failed, no training dispatched (regression: error must not be swallowed)", async () => {
    // Reproduce the exact PostgREST failure that hid behind "claim_failed".
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: {
        code: "42703",
        message: 'column characters.lora_training_status does not exist',
        details: null,
        hint: null,
      },
    } as never)
    vi.mocked(supabase.from).mockImplementation((() => ({ select: vi.fn(), update: vi.fn() })) as never)
    const replicateTraining = await import("../../providers/replicate/training.js")

    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/train`,
      headers: { "x-user-id": TEST_USER_ID, "content-type": "application/json" },
      payload: {},
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error).toBe("claim_failed")
    // A failed claim must never proceed to job creation / Replicate dispatch.
    expect(replicateTraining.createCharacterTraining).not.toHaveBeenCalled()
  })

  it("dispatch failure (claim OK, Replicate throws) → 502 training_dispatch_failed", async () => {
    const { fromMock, rpcMock } = mockClaimRace()
    vi.mocked(supabase.from).mockImplementation(fromMock as never)
    vi.mocked(supabase.rpc).mockImplementation(rpcMock as never)

    const replicateTraining = await import("../../providers/replicate/training.js")
    // e.g. the missing-destination-model failure this fix addresses.
    vi.mocked(replicateTraining.createCharacterTraining).mockRejectedValue(
      new Error("Replicate 422: destination model does not exist"),
    )

    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/train`,
      headers: { "x-user-id": TEST_USER_ID, "content-type": "application/json" },
      payload: {},
    })

    expect(res.statusCode).toBe(502)
    expect(res.json().error).toBe("training_dispatch_failed")
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
    expect(supabase.rpc).not.toHaveBeenCalled()
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
