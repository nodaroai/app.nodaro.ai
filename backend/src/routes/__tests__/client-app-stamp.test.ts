import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Server-side origin stamping (migration 253/256 + client-app-stamp.ts):
// a workflow/project created by a client app must be classified with its
// app_slug so the dashboard can hide unlisted apps. Clients rarely send the
// slug, but they DO write their settings marker (vcp -> `settings.vcp`), which
// client_apps.settings_key maps back to the slug.
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

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

import { workflowRoutes } from "../workflows.js"
import { projectRoutes } from "../projects.js"
import { supabase } from "../../lib/supabase.js"
import {
  _resetClientAppStampCacheForTests,
  clientAppVisibilityFilter,
  getListedAppSlugs,
} from "../../lib/client-app-stamp.js"

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const PROJECT_ID = "00000000-0000-4000-8000-000000000002"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000003"

/** Thenable supabase stub — every builder method returns the same object. */
function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {}
  for (const m of [
    "select", "eq", "is", "order", "limit", "not", "in", "or", "insert", "update", "single", "maybeSingle",
  ]) {
    obj[m] = vi.fn(() => obj)
  }
  obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return obj as Record<string, ReturnType<typeof vi.fn>> & { then: unknown }
}

/** The registry as migration 256 seeds it: (slug, settings_key) list for inference. */
function registryChain() {
  return chain({
    data: [
      { slug: "voice-changer-pro", settings_key: "vcp" },
      { slug: "studio", settings_key: "studio" },
    ],
    error: null,
  })
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  _resetClientAppStampCacheForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") {
      ;(req as unknown as { userId?: string }).userId = header
    }
  })
  await app.register(async (instance) => {
    await workflowRoutes(instance)
    await projectRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ── workflow create ────────────────────────────────────────────────────────

describe("POST /v1/workflows — settings-marker stamping", () => {
  it("stamps app_slug from a vcp settings marker when no appSlug is sent", async () => {
    const workflowsChain = chain({
      data: { id: WORKFLOW_ID, project_id: PROJECT_ID, user_id: TEST_USER_ID, name: "c", app_slug: "voice-changer-pro", settings: {}, nodes: [], edges: [] },
      error: null,
    })
    const projectsChain = chain({ data: { id: PROJECT_ID, app_slug: null }, error: null })
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "client_apps") return registryChain()
      if (table === "projects") return projectsChain
      return workflowsChain
    }) as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "c", projectId: PROJECT_ID, settings: { vcp: { version: 1 } } },
    })

    expect(res.statusCode).toBe(201)
    expect(workflowsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ app_slug: "voice-changer-pro" }),
    )
  })

  it("leaves app_slug NULL for an unregistered settings marker", async () => {
    const workflowsChain = chain({
      data: { id: WORKFLOW_ID, project_id: PROJECT_ID, user_id: TEST_USER_ID, name: "n", app_slug: null, settings: {}, nodes: [], edges: [] },
      error: null,
    })
    const projectsChain = chain({ data: { id: PROJECT_ID, app_slug: null }, error: null })
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "client_apps") return registryChain()
      if (table === "projects") return projectsChain
      return workflowsChain
    }) as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "n", projectId: PROJECT_ID, settings: { somethingElse: true } },
    })

    expect(res.statusCode).toBe(201)
    expect(workflowsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ app_slug: null }),
    )
  })

  it("an explicit appSlug wins over a conflicting settings marker", async () => {
    // appSlug present -> clientAppExists (maybeSingle -> object); inference is
    // short-circuited, so client_apps returns the single-row lookup shape.
    const workflowsChain = chain({
      data: { id: WORKFLOW_ID, project_id: PROJECT_ID, user_id: TEST_USER_ID, name: "s", app_slug: "studio", settings: {}, nodes: [], edges: [] },
      error: null,
    })
    const projectsChain = chain({ data: { id: PROJECT_ID, app_slug: null }, error: null })
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "client_apps") return chain({ data: { slug: "studio" }, error: null })
      if (table === "projects") return projectsChain
      return workflowsChain
    }) as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "s", projectId: PROJECT_ID, appSlug: "studio", settings: { vcp: { version: 1 } } },
    })

    expect(res.statusCode).toBe(201)
    expect(workflowsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ app_slug: "studio" }),
    )
  })

  it("inherits the project's slug on a bare project-scoped create (no settings)", async () => {
    const workflowsChain = chain({
      data: { id: WORKFLOW_ID, project_id: PROJECT_ID, user_id: TEST_USER_ID, name: "conv", app_slug: "voice-changer-pro", settings: {}, nodes: [], edges: [] },
      error: null,
    })
    // Project already classified (vcp) — a bare conversion created inside it is vcp.
    const projectsChain = chain({ data: { app_slug: "voice-changer-pro" }, error: null })
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "client_apps") return registryChain()
      if (table === "projects") return projectsChain
      return workflowsChain
    }) as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/workflows`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "conv" },
    })

    expect(res.statusCode).toBe(201)
    expect(workflowsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ app_slug: "voice-changer-pro" }),
    )
  })
})

// ── workflow update (late stamping) ──────────────────────────────────────────

describe("PATCH /v1/workflows/:id — late settings-marker stamping", () => {
  it("stamps a still-native row when a vcp marker appears on update", async () => {
    // Main update returns the row with app_slug still NULL; the guarded stamp
    // then flips it. One chain records both `update` calls.
    const workflowsChain = chain({
      data: { id: WORKFLOW_ID, project_id: PROJECT_ID, user_id: TEST_USER_ID, name: "c", app_slug: null, settings: { vcp: { version: 1 } }, nodes: [], edges: [] },
      error: null,
    })
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "client_apps") return registryChain()
      return workflowsChain
    }) as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { settings: { vcp: { version: 1 } } },
    })

    expect(res.statusCode).toBe(200)
    // The guarded stamp update: only app_slug, filtered on app_slug IS NULL.
    expect(workflowsChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ app_slug: "voice-changer-pro" }),
    )
    expect(workflowsChain.is).toHaveBeenCalledWith("app_slug", null)
    // Response reflects the stamp.
    expect(res.json().data.appSlug).toBe("voice-changer-pro")
  })

  it("does not stamp when the settings carry no registered marker", async () => {
    const workflowsChain = chain({
      data: { id: WORKFLOW_ID, project_id: PROJECT_ID, user_id: TEST_USER_ID, name: "c", app_slug: null, settings: { foo: 1 }, nodes: [], edges: [] },
      error: null,
    })
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "client_apps") return registryChain()
      return workflowsChain
    }) as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WORKFLOW_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { settings: { foo: 1 } },
    })

    expect(res.statusCode).toBe(200)
    expect(workflowsChain.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ app_slug: expect.anything() }),
    )
    expect(res.json().data.appSlug).toBeNull()
  })
})

// ── visibility helpers (admin viewAll default exclusion) ────────────────────

describe("client-app visibility helpers", () => {
  it("clientAppVisibilityFilter: empty listed set → bare app_slug.is.null", () => {
    // An `in.()` with no values is a PostgREST syntax error, not an empty match.
    expect(clientAppVisibilityFilter([])).toBe("app_slug.is.null")
  })

  it("clientAppVisibilityFilter: ORs native with the listed slugs", () => {
    expect(clientAppVisibilityFilter(["studio"])).toBe("app_slug.is.null,app_slug.in.(studio)")
    expect(clientAppVisibilityFilter(["studio", "acme"])).toBe(
      "app_slug.is.null,app_slug.in.(studio,acme)",
    )
  })

  it("clientAppVisibilityFilter: drops unsafe slugs (no filter injection)", () => {
    expect(clientAppVisibilityFilter(["studio", "a,b", "bad slug"])).toBe(
      "app_slug.is.null,app_slug.in.(studio)",
    )
  })

  it("getListedAppSlugs: returns only workflows_listed=true slugs", async () => {
    _resetClientAppStampCacheForTests()
    vi.mocked(supabase.from).mockReturnValue(
      chain({
        data: [
          { slug: "studio", settings_key: "studio", workflows_listed: true },
          { slug: "voice-changer-pro", settings_key: "vcp", workflows_listed: false },
        ],
        error: null,
      }) as never,
    )
    expect(await getListedAppSlugs()).toEqual(["studio"])
  })

  it("getListedAppSlugs: fails safe to [] when the registry is unreachable", async () => {
    _resetClientAppStampCacheForTests()
    vi.mocked(supabase.from).mockReturnValue(
      chain({ data: null, error: { message: "registry down" } }) as never,
    )
    expect(await getListedAppSlugs()).toEqual([])
  })
})

// ── project create / update ─────────────────────────────────────────────────

describe("projects — settings-marker stamping", () => {
  it("stamps a new project's app_slug from its vcp marker", async () => {
    const projectsChain = chain({
      data: { id: PROJECT_ID, user_id: TEST_USER_ID, name: "Voice Changer Pro", settings: { vcp: { version: 1 } }, is_default: false },
      error: null,
    })
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "client_apps") return registryChain()
      return projectsChain
    }) as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Voice Changer Pro", settings: { vcp: { version: 1 } } },
    })

    expect(res.statusCode).toBe(201)
    expect(projectsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ app_slug: "voice-changer-pro" }),
    )
  })

  it("late-stamps a still-native project when a vcp marker appears on update", async () => {
    const projectsChain = chain({
      data: { id: PROJECT_ID, user_id: TEST_USER_ID, name: "VCP", settings: { vcp: { version: 1 } }, is_default: false },
      error: null,
    })
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "client_apps") return registryChain()
      return projectsChain
    }) as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${PROJECT_ID}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { settings: { vcp: { version: 1 } } },
    })

    expect(res.statusCode).toBe(200)
    expect(projectsChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ app_slug: "voice-changer-pro" }),
    )
    expect(projectsChain.is).toHaveBeenCalledWith("app_slug", null)
  })
})
