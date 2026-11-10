import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * Nodaro Motion's steps through the REAL auth hook and the REAL credit guard
 * at each step route's REAL path (decided 2026-11-10): a step the engine's job
 * sends — `tk.http.workerRequest`, internal auth plus a parent job in the
 * server-only scope — is gated as `cast-swap`, the node the user ran, so a
 * `nodes.allow` deployment that allows Motion runs it whether or not it lists
 * the step's own node. A direct call to the same route is gated by its own
 * node, as before.
 *
 * The edition here has no credits, so past the availability checks the guard
 * is a no-op and a 200 means exactly "the guard let it through".
 */

const db = vi.hoisted(() => ({ parents: new Map<string, { user_id: string; job_type: string; status: string }>(), reads: 0 }))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      const filters: Record<string, unknown> = {}
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value
          return chain
        },
        update: () => chain,
        single: async () => ({ data: null, error: { code: "PGRST116" } }),
        maybeSingle: async () => {
          if (table !== "jobs") return { data: null, error: null }
          db.reads += 1
          const row = db.parents.get(String(filters.id))
          return { data: row && row.user_id === filters.user_id ? row : null, error: null }
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
      }
      return chain
    },
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("Invalid token") }) },
  },
}))

vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => false }))

vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/config.js")>()),
  hasCredits: () => false,
  isCloud: () => false,
  isBusiness: () => true,
  isCommunity: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "generate-image", category: "ai-image" },
    { type: "video-depth", category: "processing" },
    { type: "mask-composite", category: "processing" },
    { type: "video-mask", category: "processing" },
    { type: "audio-separation", category: "audio" },
  ],
}))

import { registerAuthHook } from "../auth.js"
import { creditGuard } from "../credit-guard.js"
import { withJobSubmissionContext } from "../../lib/job-submission-context.js"
import { __availabilityUniverseReadyForTests, __resetAvailabilityOverridesForTests } from "../../lib/availability-override.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const USER = "00000000-0000-4000-8000-000000000001"
const PARENT = "00000000-0000-4000-8000-0000000000aa"
const SECRET = process.env.INTERNAL_ORCHESTRATOR_SECRET as string

/** The four routes Nodaro Motion's job sends its steps to, each with the node it is its own run of. */
const STEP_ROUTES = [
  { url: "/v1/video-depth", node: "video-depth" },
  { url: "/v1/mask-composite", node: "mask-composite" },
  { url: "/v1/video-mask", node: "video-mask" },
  { url: "/v1/audio-separation", node: "audio-separation" },
] as const

let app: FastifyInstance

function useProfile(profile: unknown): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

beforeAll(async () => {
  await __availabilityUniverseReadyForTests()
  __resetAvailabilityOverridesForTests()
  app = Fastify({ logger: false })
  registerAuthHook(app)
  for (const { url } of STEP_ROUTES) {
    app.post(url, { preHandler: creditGuard(() => "ffmpeg") }, async (req) => ({ ranAs: req.userId ?? null }))
  }
  await app.ready()
})

beforeEach(() => {
  db.parents.clear()
  db.reads = 0
  db.parents.set(PARENT, { user_id: USER, job_type: "cast-swap", status: "processing" })
})

afterEach(() => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

afterAll(async () => {
  await app?.close()
})

const internalHeaders = { "x-internal-orchestrator-secret": SECRET, "x-internal-user-id": USER }

/** A step of the Motion job `parentJobId`, as `tk.http.workerRequest` sends it. */
const step = (url: string, parentJobId = PARENT) =>
  withJobSubmissionContext({ userId: USER, method: "POST", url, parentJobId, trustedPluginCaller: true }, () =>
    app.inject({ method: "POST", url, headers: internalHeaders, payload: {} }),
  )

/** The same route reached without a parent job (an internal hop, or a body naming a user). */
const direct = (url: string) => app.inject({ method: "POST", url, headers: internalHeaders, payload: {} })

describe("a Nodaro Motion step is gated as cast-swap", () => {
  it("has a secret to test with", () => {
    expect(SECRET?.length).toBeGreaterThanOrEqual(32)
  })

  it.each(STEP_ROUTES)("$url: a step of a Motion job runs where the deployment allows cast-swap and not $node", async ({ url }) => {
    useProfile({ nodes: { allow: ["cast-swap"] } })
    const res = await step(url)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ranAs: USER })
  })

  it.each(STEP_ROUTES)("$url: a direct call is still gated by $node", async ({ url, node }) => {
    useProfile({ nodes: { allow: ["cast-swap"] } })
    const res = await direct(url)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("node_not_available")
    expect(res.json().error.message).toContain(node)
  })

  it.each(STEP_ROUTES)("$url: a step is refused as cast-swap where the deployment does not allow Motion, whatever else it lists", async ({ url, node }) => {
    useProfile({ nodes: { allow: [node] } })
    const res = await step(url)
    expect(res.statusCode).toBe(403)
    expect(res.json().error.message).toContain("cast-swap")
  })

  it("a step of another user's job, or of a finished job, is gated by its own node", async () => {
    useProfile({ nodes: { allow: ["cast-swap"] } })
    db.parents.set(PARENT, { user_id: "00000000-0000-4000-8000-000000000002", job_type: "cast-swap", status: "processing" })
    expect((await step("/v1/video-depth")).statusCode).toBe(403)
    db.parents.set(PARENT, { user_id: USER, job_type: "cast-swap", status: "completed" })
    expect((await step("/v1/video-depth")).statusCode).toBe(403)
  })

  it("a deployment that does not list its nodes runs every call exactly as before, and reads no job", async () => {
    for (const { url } of STEP_ROUTES) {
      expect((await step(url)).statusCode, url).toBe(200)
      expect((await direct(url)).statusCode, url).toBe(200)
    }
    useProfile({ nodes: { deny: ["video-depth"] } })
    expect((await step("/v1/video-depth")).statusCode).toBe(403)
    expect(db.reads).toBe(0)
  })
})
