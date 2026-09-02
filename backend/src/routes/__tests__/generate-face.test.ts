/**
 * W1-a minor-age floor — POST /v1/generate-face.
 *
 * The whole-branch review's CRITICAL finding: this route feeds
 * `makeEntityImageHandler("generate-face")` — the SAME entity-image chokepoint
 * the character lanes use — with a prompt the client assembled, and never set
 * `subjectMinor`. So the policy at the handler was the identity and the exact
 * incident wording reached the provider on a face request while the character
 * lane beside it was covered.
 *
 * Harness mirrors `generate-character.test.ts` (mocks hoisted before the route
 * import; `app.inject` against a bare Fastify instance with the auth hook
 * stubbed), minus the character-only mocks this lane never loads.
 */
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
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }),
      },
    },
  }
})

const DEFAULTS = vi.hoisted(() => ({
  reservation: { usageLogId: "log-1", creditsReserved: 6, watermark: false },
  queuedJob: { id: "queue-job-1" },
}))

// Mocked because the real module opens a Redis connection at import time — a
// route test that reaches the live queue hangs under full-suite load.
vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue(DEFAULTS.queuedJob) },
  redis: {},
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => undefined,
  reserveCreditsForJob: vi.fn().mockResolvedValue(DEFAULTS.reservation),
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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateFaceRoutes } from "../generate-face.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { CLOTHED_DEFAULT } from "../../lib/character-prompts.js"
import { MODEST_ATTIRE_CLAUSE, registerMainlinePromptPolicies } from "../../lib/prompt-policies/index.js"
import { applyPromptPolicies, clearPromptPolicies } from "../../lib/prompt-policy.js"

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance

function mockJobsInsertChain() {
  const single = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select })
  return { insert, select, single }
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(reserveCreditsForJob).mockReset()
  vi.mocked(reserveCreditsForJob).mockResolvedValue(DEFAULTS.reservation)
  vi.mocked(videoQueue.add).mockReset()
  vi.mocked(videoQueue.add).mockResolvedValue(DEFAULTS.queuedJob as never)

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await generateFaceRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  clearPromptPolicies()
})

async function post(payload: Record<string, unknown>) {
  const { insert } = mockJobsInsertChain()
  vi.mocked(supabase.from).mockReturnValue({ insert } as never)
  const res = await app.inject({
    method: "POST",
    url: "/v1/generate-face",
    headers: { "x-user-id": TEST_USER_ID },
    payload,
  })
  const enqueued = (vi.mocked(videoQueue.add).mock.calls[0]?.[1] ?? {}) as Record<string, unknown>
  const inserted = (insert.mock.calls[0]?.[0] ?? {}) as { input_data?: Record<string, unknown> }
  return { res, enqueued, inserted }
}

describe("POST /v1/generate-face — subjectMinor (W1-a)", () => {
  // The 2026-07-30 incident wording, arriving here the way it arrives on the
  // character lane: fully assembled by the client, with no structured value of
  // any kind for the server to read.
  const INCIDENT_PROMPT =
    "a young child around 5 years old, the clothing fitted and form-conscious, hugging the contours of the body, " +
    "with lips slightly parted, taking a soft breath"

  it("INCIDENT REPRO: subjectMinor rides the job as true and the handler's policy floors the prompt", async () => {
    const { res, enqueued, inserted } = await post({ name: "Ana", prompt: INCIDENT_PROMPT })

    expect(res.statusCode).toBe(200)
    expect(enqueued.subjectMinor).toBe(true)
    // …and the floored job is auditable from the row alone.
    expect(inserted.input_data?.subjectMinor).toBe(true)

    // What the entity handler then does with it (same call, same args as
    // `makeEntityImageHandler`).
    registerMainlinePromptPolicies()
    const policed = applyPromptPolicies({
      prompt: enqueued.prompt as string,
      negativePrompt: "",
      kind: "image",
      subjectMinor: enqueued.subjectMinor === true,
    }).prompt

    expect(policed).not.toContain("hugging the contours")
    expect(policed).not.toContain("lips slightly parted")
    expect(policed).not.toContain(CLOTHED_DEFAULT)
    expect(policed.split(MODEST_ATTIRE_CLAUSE).length - 1).toBe(1)
    // The subject survives the repair.
    expect(policed).toContain("a young child around 5 years old")
  })

  it("ADULT MIRROR: the same prompt about an adult is byte-identical", async () => {
    const adultPrompt = INCIDENT_PROMPT.replace("a young child around 5 years old", "a woman in her 30s")
    const { res, enqueued, inserted } = await post({ name: "Ana", prompt: adultPrompt })

    expect(res.statusCode).toBe(200)
    expect(enqueued.subjectMinor).toBe(false)
    expect(inserted.input_data?.subjectMinor).toBe(false)
    expect(enqueued.prompt).toBe(adultPrompt)

    registerMainlinePromptPolicies()
    const policed = applyPromptPolicies({
      prompt: enqueued.prompt as string,
      negativePrompt: "",
      kind: "image",
      subjectMinor: enqueued.subjectMinor === true,
    }).prompt
    expect(policed).toBe(adultPrompt)
  })

  it("the age can live in `description` while the client prompt carries none", async () => {
    const { enqueued } = await post({
      name: "Ana",
      description: "aged 12, school portrait",
      prompt: "a close-up headshot, soft light",
    })
    expect(enqueued.subjectMinor).toBe(true)
  })

  it("the server-template branch (no client prompt) is covered too", async () => {
    const { res, enqueued } = await post({ name: "Ana", description: "a 7 year old on a swing" })
    expect(res.statusCode).toBe(200)
    expect(enqueued.subjectMinor).toBe(true)
    expect(enqueued.prompt).toContain("a 7 year old on a swing")
  })

  it("an ordinary adult face request is untouched", async () => {
    const { enqueued } = await post({ name: "Ana", description: "auburn hair, green eyes", prompt: "a close-up headshot" })
    expect(enqueued.subjectMinor).toBe(false)
  })

  // The Zod body has no `subjectMinor` field and z.object strips unknown keys,
  // so a client cannot talk its way OUT of (or into) the floor.
  it("a client-supplied subjectMinor is ignored — the server decides", async () => {
    const { enqueued } = await post({ name: "Ana", prompt: INCIDENT_PROMPT, subjectMinor: false })
    expect(enqueued.subjectMinor).toBe(true)
  })
})
