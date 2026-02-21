/**
 * Shared test utilities for backend tests.
 *
 * Each test file still declares its own vi.mock() calls (Vitest hoisting requires this),
 * but references these constants/helpers to avoid repetition.
 */

import { vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VALID_UUID = "00000000-0000-4000-8000-000000000001"
export const ADMIN_UUID = "00000000-0000-4000-8000-000000000002"

// ---------------------------------------------------------------------------
// Route test app factory
// ---------------------------------------------------------------------------

/**
 * Creates a Fastify instance with:
 * - Auth bypass preHandler (sets req.userId from body.userId)
 * - The provided route plugin registered
 * - app.ready() called
 */
export async function createRouteTestApp(
  routePlugin: (app: FastifyInstance) => Promise<void>
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  // Bypass real auth — set userId from request body or query for protected routes
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    const query = req.query as Record<string, unknown> | undefined
    const userId = body?.userId ?? query?.userId
    if (userId && typeof userId === "string") {
      req.userId = userId
      req.userRole = (body?.userRole as string) ?? undefined
    }
  })

  await app.register(async (instance) => {
    await routePlugin(instance)
  })

  await app.ready()
  return app
}

// ---------------------------------------------------------------------------
// Supabase mock chain helper
// ---------------------------------------------------------------------------

/**
 * Creates a mock Supabase chain for `.from().select().eq().single()` patterns.
 * Returns mutable fns so tests can override return values per test.
 */
export function mockSupabaseChain() {
  const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockLimit = vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockMaybeSingle })
  const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit, single: mockSingle, maybeSingle: mockMaybeSingle, data: [], error: null })
  const mockLte = vi.fn().mockReturnThis()
  const mockLt = vi.fn().mockReturnThis()
  const mockGte = vi.fn().mockReturnThis()
  const mockGt = vi.fn().mockReturnThis()
  const mockNeq = vi.fn().mockReturnThis()
  const mockIn = vi.fn().mockReturnThis()
  const mockIs = vi.fn().mockReturnThis()
  const mockIlike = vi.fn().mockReturnThis()
  const mockContains = vi.fn().mockReturnThis()
  const mockRange = vi.fn().mockReturnThis()
  const mockEq = vi.fn().mockReturnValue({
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
    eq: vi.fn().mockReturnValue({ single: mockSingle, maybeSingle: mockMaybeSingle }),
    order: mockOrder,
    limit: mockLimit,
    lte: mockLte,
    lt: mockLt,
    gte: mockGte,
    gt: mockGt,
    neq: mockNeq,
    in: mockIn,
    is: mockIs,
    ilike: mockIlike,
    contains: mockContains,
    range: mockRange,
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
  })

  const mockSelect = vi.fn().mockReturnValue({
    eq: mockEq,
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
    order: mockOrder,
    limit: mockLimit,
    lte: mockLte,
    lt: mockLt,
    gte: mockGte,
    gt: mockGt,
    neq: mockNeq,
    in: mockIn,
    is: mockIs,
    ilike: mockIlike,
    contains: mockContains,
    range: mockRange,
  })

  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect, single: mockSingle })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq, select: mockSelect, single: mockSingle })
  const mockDelete = vi.fn().mockReturnValue({ eq: mockEq })
  const mockUpsert = vi.fn().mockReturnValue({ select: mockSelect, single: mockSingle })

  const mockFrom = vi.fn().mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    upsert: mockUpsert,
  })

  return {
    mockFrom,
    mockSingle,
    mockMaybeSingle,
    mockInsert,
    mockSelect,
    mockUpdate,
    mockDelete,
    mockUpsert,
    mockEq,
    mockOrder,
    mockLimit,
  }
}

// ---------------------------------------------------------------------------
// Common mock factories
// ---------------------------------------------------------------------------

/** Standard config mock for cloud edition */
export const CLOUD_CONFIG_MOCK = {
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
    REDIS_URL: "redis://localhost:6379",
    R2_PUBLIC_URL: "https://r2.example.com",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}

/** Standard credit guard mock that passes through */
export const PASSTHROUGH_CREDIT_GUARD_MOCK = {
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "usage-1",
    creditsReserved: 1,
    watermark: false,
  }),
}

/** Standard queue mock */
export const QUEUE_MOCK = {
  videoQueue: {
    add: vi.fn().mockResolvedValue({ id: "queue-job-1" }),
    getJob: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  renderQueue: {
    add: vi.fn().mockResolvedValue({ id: "render-queue-job-1" }),
  },
  redis: {},
}

/** Standard admin check mock */
export const ADMIN_CHECK_MOCK = {
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}

/** URL validator mock */
export const URL_VALIDATOR_MOCK_FACTORY = async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
}
