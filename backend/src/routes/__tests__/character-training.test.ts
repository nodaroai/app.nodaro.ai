import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { supabase } from "../../lib/supabase.js"
import { characterTrainingRoutes } from "../character-training.js"
import { clearJobPolicies, registerJobPolicy } from "../../lib/job-policy.js"

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

// The credit guard's preHandler, observable: a refused caller must never reach it.
const { creditGuardHandler } = vi.hoisted(() => ({ creditGuardHandler: vi.fn(async () => {}) }))
vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => creditGuardHandler,
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

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_CHARACTER_ID = "00000000-0000-4000-8000-000000000002"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
    // An OAuth app token: the auth hook sets `appAuthorization` with the
    // scopes the user granted. Absent = a session JWT or a personal API key.
    const scopes = req.headers["x-app-scopes"]
    if (typeof scopes === "string") {
      req.appAuthorization = { appId: "app-1", authorizationId: "auth-1", scopes: scopes.split(",").filter(Boolean) }
    }
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
    jobUpdates: Array<Record<string, unknown>>
  } {
    const jobUpdates: Array<Record<string, unknown>> = []
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
        // Update path: .update().eq().eq() — the catch's failure write ends in
        // `.then(ok, err)`, so the terminal value is a real promise.
        const eq2 = vi.fn().mockResolvedValue({ data: null, error: null })
        const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
        const update = vi.fn().mockImplementation((patch: Record<string, unknown>) => {
          jobUpdates.push(patch)
          return { eq: eq1 }
        })
        return { insert, update }
      }
      return {} as never
    })

    return { fromMock, rpcMock, jobUpdates }
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

  // The raw failure is a provider's or a library's own text (it can name
  // models, hosts, internals). It is logged; what the caller and the job row's
  // user-visible message carry is a fixed sentence.
  it("dispatch failure never echoes the raw error: generic reply + job message, raw only in error_detail", async () => {
    const { fromMock, rpcMock, jobUpdates } = mockClaimRace()
    vi.mocked(supabase.from).mockImplementation(fromMock as never)
    vi.mocked(supabase.rpc).mockImplementation(rpcMock as never)
    const replicateTraining = await import("../../providers/replicate/training.js")
    const raw = "Replicate 422: destination model nodaroai/char-x does not exist at https://api.replicate.com/v1/models?token=abc"
    vi.mocked(replicateTraining.createCharacterTraining).mockRejectedValue(new Error(raw))

    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/train`,
      headers: { "x-user-id": TEST_USER_ID, "content-type": "application/json" },
      payload: {},
    })

    expect(res.statusCode).toBe(502)
    const body = res.json() as { error: string; message: string }
    expect(body.error).toBe("training_dispatch_failed")
    expect(body.message).toBeTruthy()
    expect(body.message).not.toContain("Replicate 422")
    expect(body.message).not.toContain("api.replicate.com")

    const failed = jobUpdates.find((p) => p.status === "failed")
    expect(failed).toBeDefined()
    expect(failed!.error_message).toBe(body.message)
    expect(String(failed!.error_detail)).toContain("Replicate 422")
    // The detail is redacted like every provider detail: no full URL, no token.
    expect(String(failed!.error_detail)).not.toContain("token=abc")
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

// ─────────────────────────────────────────────────────────────────────────────
// OAuth scopes — the same gate as the character writes in routes/characters.ts
// ─────────────────────────────────────────────────────────────────────────────
//
// A developer app the user authorized for a narrow scope (say `jobs:read`) must
// not start a paid training or destroy a trained model: train and DELETE lora
// need `assets:write`, like creating or deleting the character itself. The
// scope is checked FIRST, so a refused app never reaches the credit guard (no
// reservation, no storage read). The status read needs no scope, like the
// character reads. A session JWT or a personal API key carries no
// `appAuthorization`, so the gate is a no-op for them (the suites above).

describe("training routes enforce assets:write for OAuth app tokens", () => {
  const trainAs = (scopes: string) =>
    app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/train`,
      headers: { "x-user-id": TEST_USER_ID, "x-app-scopes": scopes, "content-type": "application/json" },
      payload: {},
    })
  const deleteLoraAs = (scopes: string) =>
    app.inject({
      method: "DELETE",
      url: `/v1/characters/${TEST_CHARACTER_ID}/lora`,
      headers: { "x-user-id": TEST_USER_ID, "x-app-scopes": scopes },
    })

  /** `characters` read for the status / delete routes: .select().eq().eq().is().single(). */
  function mockCharacterRow(row: Record<string, unknown>) {
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table !== "characters") return {} as never
      return {
        select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ single: async () => ({ data: row, error: null }) }) }) }) }),
        update: () => ({ eq: () => ({ eq: async () => ({ data: null, error: null }) }) }),
      }
    }) as never)
  }

  it("POST train → 403 insufficient_scope without assets:write, before the credit guard and any DB call", async () => {
    const res = await trainAs("jobs:read,workflows:execute")
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({
      error: { code: "insufficient_scope", message: "Missing required scope: assets:write", missingScope: "assets:write" },
    })
    expect(creditGuardHandler).not.toHaveBeenCalled()
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("POST train with assets:write passes the gate and reaches the credit guard and the claim", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never)
    const res = await trainAs("assets:write")
    // The claim is lost (mocked) — a 409, i.e. NOT an insufficient_scope refusal.
    expect(res.statusCode).toBe(409)
    expect(creditGuardHandler).toHaveBeenCalledTimes(1)
    expect(supabase.rpc).toHaveBeenCalledWith("claim_character_lora_training", expect.anything())
  })

  it("DELETE lora → 403 insufficient_scope without assets:write; nothing is read, cancelled or deleted", async () => {
    const res = await deleteLoraAs("jobs:read")
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("insufficient_scope")
    expect(res.json().error.missingScope).toBe("assets:write")
    expect(supabase.from).not.toHaveBeenCalled()
    const replicateTraining = await import("../../providers/replicate/training.js")
    expect(replicateTraining.deleteCharacterLora).not.toHaveBeenCalled()
  })

  it("DELETE lora with assets:write removes the trained model", async () => {
    mockCharacterRow({ id: TEST_CHARACTER_ID, lora_training_status: "succeeded", lora_training_replicate_id: "rep-1" })
    const res = await deleteLoraAs("assets:write")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    const replicateTraining = await import("../../providers/replicate/training.js")
    expect(replicateTraining.deleteCharacterLora).toHaveBeenCalledWith(`nodaroai/char-${TEST_CHARACTER_ID}`)
  })

  it("GET training needs no scope, like the character reads", async () => {
    mockCharacterRow({
      id: TEST_CHARACTER_ID,
      lora_training_status: "training",
      lora_training_replicate_id: "rep-1",
      lora_training_error: null,
      lora_trained_at: null,
      lora_replicate_version: null,
      lora_trigger_word: "TOK_kira_a1b2c3",
      lora_training_image_count: 12,
    })
    const res = await app.inject({
      method: "GET",
      url: `/v1/characters/${TEST_CHARACTER_ID}/training`,
      headers: { "x-user-id": TEST_USER_ID, "x-app-scopes": "jobs:read" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe("training")
  })
})

/**
 * F10 — the training lane turned a request-gate block into `502
 * training_dispatch_failed`, because the insert error arm threw a plain
 * `Error("job_create_failed")` and the catch replies 502 unconditionally. The
 * catch's cleanup (CAS rollback of `lora_training_status`, orphan-zip delete)
 * is exactly what a block should run — only the reply is wrong, so the throw
 * stays and the catch's TAIL learns about blocks.
 */
describe("POST /v1/characters/:id/train — request-gate block (F10)", () => {
  afterEach(() => clearJobPolicies())

  it("answers 422 job_blocked (not 502), still rolls the slot back and deletes the orphan zip", async () => {
    const characterFullRow = {
      id: TEST_CHARACTER_ID,
      name: "Kira",
      source_image_url: "https://r2/source.jpg",
      reference_photos: [], expressions: [], poses: [], angles: [],
      body_angles: [], lighting_variations: [],
    }
    const characterUpdates: Array<Record<string, unknown>> = []
    vi.mocked(supabase.rpc).mockResolvedValue({ data: TEST_CHARACTER_ID, error: null } as never)
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "characters") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: characterFullRow, error: null }) }) }) }),
          update: (patch: Record<string, unknown>) => {
            characterUpdates.push(patch)
            return { eq: () => ({ eq: async () => ({ data: null, error: null }) }) }
          },
        }
      }
      return { insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }) }
    }) as never)

    registerJobPolicy({
      id: "test-deny-all",
      checkRequest: () => ({ verdict: "block", reason: "test:denied", userMessage: "Not allowed here" }),
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/characters/${TEST_CHARACTER_ID}/train`,
      headers: { "x-user-id": TEST_USER_ID, "content-type": "application/json" },
      payload: {},
    })

    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ error: { code: "job_blocked", message: "Not allowed here" } })

    const replicateTraining = await import("../../providers/replicate/training.js")
    expect(replicateTraining.createCharacterTraining).not.toHaveBeenCalled()
    // The catch's cleanup still runs: the CAS-claimed slot is released…
    expect(characterUpdates).toContainEqual({ lora_training_status: null })
    // …and the zip that was uploaded before the gate refused is deleted.
    const storage = await import("../../lib/storage.js")
    expect(storage.deleteFromR2).toHaveBeenCalledWith("character-training/test/123.zip")
  })
})
