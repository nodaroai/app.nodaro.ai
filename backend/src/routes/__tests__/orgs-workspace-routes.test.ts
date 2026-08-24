import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * What the route layer does once a workspace is selected.
 *
 * The header decides LIST SCOPE and CREATE TARGET, and nothing else. Whether a
 * NAMED object may be read or written is decided from that object's own
 * workspace, elsewhere — so none of that is tested here, deliberately.
 *
 * The most important describe in this file is the last one. Every route below
 * has to be byte-identical to its pre-workspace self when no plugin provides
 * the organizations service, because that is every install that exists today
 * plus every community and business one that ever will.
 */

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
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
  hasOrganizations: vi.fn(() => true),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/private-plugins/load.js", () => ({
  getPluginServices: vi.fn(() => ({})),
}))

import { workflowRoutes } from "../workflows.js"
import { projectRoutes } from "../projects.js"
import { supabase } from "../../lib/supabase.js"
import { getPluginServices } from "../../lib/private-plugins/load.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-0000000000ff"
const WS = "b0000000-0000-4000-8000-000000000001"
const PROJECT = "00000000-0000-4000-8000-000000000010"
const OTHER_PROJECT = "00000000-0000-4000-8000-000000000011"
const LANDING = "00000000-0000-4000-8000-000000000012"
const WORKFLOW = "00000000-0000-4000-8000-000000000020"

const DB_WORKFLOW = {
  id: WORKFLOW,
  project_id: PROJECT,
  user_id: USER,
  folder_id: null,
  name: "W",
  description: null,
  is_template: false,
  thumbnail_url: null,
  version: 1,
  source_prompt: null,
  nodes: [],
  edges: [],
  settings: {},
  parent_workflow_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

const DB_PROJECT = {
  id: PROJECT,
  user_id: USER,
  name: "P",
  description: null,
  settings: {},
  is_default: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

/** What the context hook would have stamped, supplied directly. */
interface Context {
  workspaceId?: string
  archived?: boolean
  workspaces?: Array<{
    workspaceId: string
    orgId: string
    role: "admin" | "member"
    status: "active" | "suspended"
  }>
}

let app: FastifyInstance
let context: Context

async function buildApp(): Promise<FastifyInstance> {
  const instance = Fastify({ logger: false })
  instance.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
    // Stands in for the context hook, which is tested on its own.
    req.workspaceId = context.workspaceId
    req.workspaceArchived = context.archived === true
    req.orgs = async () => ({ organizations: [], workspaces: context.workspaces ?? [] })
  })
  await instance.register(async (i) => {
    await workflowRoutes(i)
    await projectRoutes(i)
  })
  await instance.ready()
  return instance
}

beforeEach(async () => {
  vi.clearAllMocks()
  context = {}
  vi.mocked(getPluginServices).mockReturnValue({} as never)
  app = await buildApp()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Chain builders. Each returns the spies the assertions need.
// ---------------------------------------------------------------------------

/** `.select().eq(user_id).<workspace filter>.is(parent).order().limit()` */
function workflowListChain(rows: unknown[] = []) {
  const limit = vi.fn().mockResolvedValue({ data: rows, error: null })
  const order = vi.fn().mockReturnValue({ limit })
  const isParent = vi.fn().mockReturnValue({ order })
  const wsIs = vi.fn().mockReturnValue({ is: isParent })
  const wsEq = vi.fn().mockReturnValue({ is: isParent })
  const userEq = vi.fn().mockReturnValue({ is: wsIs, eq: wsEq })
  const select = vi.fn().mockReturnValue({ eq: userEq })
  vi.mocked(supabase.from).mockReturnValue({ select } as never)
  return { userEq, wsIs, wsEq }
}

/** `.select().eq(user_id).<workspace filter>.order()` */
function projectListChain(rows: unknown[] = []) {
  const order = vi.fn().mockResolvedValue({ data: rows, error: null })
  const wsIs = vi.fn().mockReturnValue({ order })
  const wsEq = vi.fn().mockReturnValue({ order })
  const userEq = vi.fn().mockReturnValue({ is: wsIs, eq: wsEq })
  const select = vi.fn().mockReturnValue({ eq: userEq })
  vi.mocked(supabase.from).mockReturnValue({ select } as never)
  return { userEq, wsIs, wsEq }
}

/** The project-scope read, plus whatever else the route touches. */
function scopeChain(project: Record<string, unknown> | null, others: Record<string, unknown> = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: project, error: null })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "projects") return { select } as never
    return others as never
  })
  return { select, eq }
}

function insertChain(row: unknown) {
  const single = vi.fn().mockResolvedValue({ data: row, error: null })
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select })
  return { insert, spy: insert }
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

describe("list scope", () => {
  it("personal: mine, and only what belongs to no workspace", async () => {
    const { userEq, wsIs } = workflowListChain()

    const res = await app.inject({ method: "GET", url: "/v1/workflows", headers: { "x-user-id": USER } })

    expect(res.statusCode).toBe(200)
    expect(userEq).toHaveBeenCalledWith("user_id", USER)
    expect(wsIs).toHaveBeenCalledWith("workspace_id", null)
  })

  it("workspace: mine, inside this workspace — BOTH filters, on purpose", async () => {
    // `.eq("user_id")` staying is the whole decision of this list. The finished
    // rule is wider, and the resolver that says how much wider does not exist
    // yet; a scope may under-show and be widened, never over-show.
    context = { workspaceId: WS }
    const { userEq, wsEq } = workflowListChain()

    const res = await app.inject({ method: "GET", url: "/v1/workflows", headers: { "x-user-id": USER } })

    expect(res.statusCode).toBe(200)
    expect(userEq).toHaveBeenCalledWith("user_id", USER)
    expect(wsEq).toHaveBeenCalledWith("workspace_id", WS)
  })

  it("projects list follows the same rule", async () => {
    context = { workspaceId: WS }
    const { userEq, wsEq } = projectListChain()

    const res = await app.inject({ method: "GET", url: "/v1/projects", headers: { "x-user-id": USER } })

    expect(res.statusCode).toBe(200)
    expect(userEq).toHaveBeenCalledWith("user_id", USER)
    expect(wsEq).toHaveBeenCalledWith("workspace_id", WS)
  })

  it("an ARCHIVED workspace still lists — reading it is the point of archiving", async () => {
    context = { workspaceId: WS, archived: true }
    workflowListChain([DB_WORKFLOW])

    const res = await app.inject({ method: "GET", url: "/v1/workflows", headers: { "x-user-id": USER } })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Creates
// ---------------------------------------------------------------------------

describe("create target", () => {
  it("a project created inside a workspace carries it", async () => {
    context = { workspaceId: WS }
    const { insert } = insertChain(DB_PROJECT)
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { "x-user-id": USER },
      payload: { name: "Class project" },
    })

    expect(res.statusCode).toBe(201)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: WS }))
  })

  it("a plain member is refused when the workspace does not let members create projects", async () => {
    context = {
      workspaceId: WS,
      workspaces: [{ workspaceId: WS, orgId: "o", role: "member", status: "active" }],
    }
    vi.mocked(getPluginServices).mockReturnValue({
      orgs: { getEffectiveSettings: vi.fn().mockResolvedValue({ members_can_create_projects: false }) },
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { "x-user-id": USER },
      payload: { name: "Nope" },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("project_create_not_allowed")
  })

  it("...but an admin of that workspace may, without the setting being consulted", async () => {
    context = {
      workspaceId: WS,
      workspaces: [{ workspaceId: WS, orgId: "o", role: "admin", status: "active" }],
    }
    const getEffectiveSettings = vi.fn().mockResolvedValue({ members_can_create_projects: false })
    vi.mocked(getPluginServices).mockReturnValue({ orgs: { getEffectiveSettings } } as never)
    const { insert } = insertChain(DB_PROJECT)
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { "x-user-id": USER },
      payload: { name: "Fine" },
    })

    expect(res.statusCode).toBe(201)
    expect(getEffectiveSettings).not.toHaveBeenCalled()
  })

  it("an IMPLICIT admin — no membership row at all — may too", async () => {
    // An organization's owner administers every workspace in it without
    // holding a workspace row anywhere. Reading "no row" as "not an admin"
    // would refuse exactly the person who created the workspace.
    context = { workspaceId: WS, workspaces: [] }
    const getEffectiveSettings = vi.fn().mockResolvedValue({ members_can_create_projects: false })
    vi.mocked(getPluginServices).mockReturnValue({ orgs: { getEffectiveSettings } } as never)
    const { insert } = insertChain(DB_PROJECT)
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { "x-user-id": USER },
      payload: { name: "Mine" },
    })

    expect(res.statusCode).toBe(201)
    expect(getEffectiveSettings).not.toHaveBeenCalled()
  })

  it("a workflow with no project lands in the WORKSPACE's project, not the personal default", async () => {
    // The single outcome a workspace exists to prevent: a member's class work
    // quietly filed in their private space.
    context = { workspaceId: WS }
    const workspaceDefaultProject = vi.fn().mockResolvedValue(LANDING)
    vi.mocked(getPluginServices).mockReturnValue({ orgs: { workspaceDefaultProject } } as never)
    const { insert } = insertChain(DB_WORKFLOW)
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": USER },
      payload: { name: "Homework" },
    })

    expect(res.statusCode).toBe(201)
    expect(workspaceDefaultProject).toHaveBeenCalledWith(WS)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ project_id: LANDING }))
    // The personal default must never have been consulted.
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it("refuses rather than guessing when the workspace has no landing project", async () => {
    context = { workspaceId: WS }
    vi.mocked(getPluginServices).mockReturnValue({
      orgs: { workspaceDefaultProject: vi.fn().mockResolvedValue(null) },
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": USER },
      payload: { name: "Homework" },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("workspace_has_no_default_project")
  })

  it("a project belonging to a DIFFERENT workspace is not reachable from this one", async () => {
    context = { workspaceId: WS }
    scopeChain({ id: PROJECT, app_slug: null, user_id: USER, workspace_id: "b0000000-0000-4000-8000-0000000000ff" })

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": USER },
      payload: { name: "X", projectId: PROJECT },
    })

    expect(res.statusCode).toBe(404)
  })

  it("a WORKSPACE project is not reachable without its header", async () => {
    // Otherwise the header stops selecting scope and becomes decoration.
    context = {}
    scopeChain({ id: PROJECT, app_slug: null, user_id: USER, workspace_id: WS })

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": USER },
      payload: { name: "X", projectId: PROJECT },
    })

    expect(res.statusCode).toBe(404)
  })

  it("a member creating in the workspace's project is NOT refused for not owning it", async () => {
    // The project belongs to the admin who made the workspace. The old
    // `.eq("user_id")` check told every member their own class project did
    // not exist.
    context = { workspaceId: WS }
    const { insert } = insertChain(DB_WORKFLOW)
    scopeChain({ id: PROJECT, app_slug: null, user_id: OTHER, workspace_id: WS }, { insert })

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": USER },
      payload: { name: "X", projectId: PROJECT },
    })

    expect(res.statusCode).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// Archived
// ---------------------------------------------------------------------------

describe("an archived workspace is read-only", () => {
  const creates: Array<[string, string, Record<string, unknown>]> = [
    ["POST /v1/projects", "/v1/projects", { name: "N" }],
    ["POST /v1/workflows", "/v1/workflows", { name: "N" }],
    [`POST /v1/projects/:id/workflows`, `/v1/projects/${PROJECT}/workflows`, { name: "N" }],
    [
      "POST /v1/workflows/import",
      "/v1/workflows/import",
      {
        projectId: PROJECT,
        workflow_json: { version: 1, exportedAt: "2026-01-01T00:00:00Z", name: "N", nodes: [], edges: [] },
      },
    ],
    // The fifth path, and the one review caught: a sub-workflow is a new
    // workflow row that inherits its project from its parent, so an archived
    // workspace has to refuse it too. It answered 201 and wrote the row.
    [
      "POST /v1/workflows/:parentId/sub-workflows",
      `/v1/workflows/${WORKFLOW}/sub-workflows`,
      { name: "child" },
    ],
  ]

  for (const [label, url, payload] of creates) {
    it(`${label} refuses`, async () => {
      context = { workspaceId: WS, archived: true }
      // Nothing should be read or written; if a route gets that far the mock
      // throws and the test fails loudly rather than passing on a 500.
      vi.mocked(supabase.from).mockImplementation(() => {
        throw new Error("no table should be touched once the workspace is archived")
      })

      const res = await app.inject({ method: "POST", url, headers: { "x-user-id": USER }, payload })

      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("workspace_archived")
    })
  }
})

// ---------------------------------------------------------------------------
// Personal space
// ---------------------------------------------------------------------------

describe("an organization can close the personal space", () => {
  it("refuses a project-less create outside any workspace", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: false, error: null } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": USER },
      payload: { name: "Private" },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("personal_space_disabled")
    expect(supabase.rpc).toHaveBeenCalledWith("personal_space_enabled_for", { p_user_id: USER })
  })

  it("allows it for everyone else — the answer that protects all current traffic", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: true, error: null } as never)
    const { insert } = insertChain(DB_WORKFLOW)
    const defaultSingle = vi.fn().mockResolvedValue({ data: DB_PROJECT, error: null })
    const defaultEq2 = vi.fn().mockReturnValue({ maybeSingle: defaultSingle })
    const defaultEq1 = vi.fn().mockReturnValue({ eq: defaultEq2 })
    const defaultSelect = vi.fn().mockReturnValue({ eq: defaultEq1 })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "projects") return { select: defaultSelect } as never
      return { insert } as never
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": USER },
      payload: { name: "Private" },
    })

    expect(res.statusCode).toBe(201)
  })

  it("fails OPEN when the database cannot answer", async () => {
    // A blip must not stop everyone on the platform from creating anything,
    // to enforce a placement policy that today applies to nobody.
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: "boom" } } as never)
    const { insert } = insertChain(DB_WORKFLOW)
    const defaultSingle = vi.fn().mockResolvedValue({ data: DB_PROJECT, error: null })
    const defaultEq2 = vi.fn().mockReturnValue({ maybeSingle: defaultSingle })
    const defaultEq1 = vi.fn().mockReturnValue({ eq: defaultEq2 })
    const defaultSelect = vi.fn().mockReturnValue({ eq: defaultEq1 })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "projects") return { select: defaultSelect } as never
      return { insert } as never
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflows",
      headers: { "x-user-id": USER },
      payload: { name: "Private" },
    })

    expect(res.statusCode).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

describe("POST /v1/workflows/:id/move", () => {
  function moveTables(opts: {
    workflow?: Record<string, unknown> | null
    project?: Record<string, unknown> | null
    collaborators?: Array<{ user_id: string }>
    collabDeleteFails?: boolean
  } = {}) {
    const wfMaybeSingle = vi.fn().mockResolvedValue({
      data:
        opts.workflow === undefined
          ? { id: WORKFLOW, user_id: USER, workspace_id: null, project_id: PROJECT, assignment_id: null }
          : opts.workflow,
      error: null,
    })
    const wfSelectEq = vi.fn().mockReturnValue({ maybeSingle: wfMaybeSingle })
    const updateSingle = vi.fn().mockResolvedValue({
      data: { ...DB_WORKFLOW, project_id: OTHER_PROJECT },
      error: null,
    })
    // The move endpoint ends in .single(); PATCH scopes by user_id and ends in
    // .maybeSingle(). One stub serves both.
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle, maybeSingle: updateSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect, eq: vi.fn().mockReturnValue({ select: updateSelect }) })
    const update = vi.fn().mockReturnValue({ eq: updateEq })
    const wfSelect = vi.fn().mockReturnValue({ eq: wfSelectEq })

    const projMaybeSingle = vi.fn().mockResolvedValue({
      data:
        opts.project === undefined
          ? { id: OTHER_PROJECT, user_id: USER, workspace_id: null }
          : opts.project,
      error: null,
    })
    const projSelect = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: projMaybeSingle }) })

    // One statement now: delete(...).eq(...).select(...) returns the rows it
    // actually removed, so the report cannot outrun the write.
    const collabDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue(
          opts.collabDeleteFails
            ? { data: null, error: { message: "delete failed" } }
            : { data: opts.collaborators ?? [], error: null },
        ),
      }),
    })
    const collabSelect = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) })

    const profilesIn = vi.fn().mockResolvedValue({ data: [{ id: OTHER, full_name: "Sam" }], error: null })
    const profilesSelect = vi.fn().mockReturnValue({ in: profilesIn })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "projects") return { select: projSelect } as never
      if (table === "workflows") return { select: wfSelect, update } as never
      if (table === "workflow_collaborators") return { select: collabSelect, delete: collabDelete } as never
      if (table === "profiles") return { select: profilesSelect } as never
      throw new Error("unexpected table " + table)
    })
    return { update, collabDelete }
  }

  it("the creator moves their own work", async () => {
    const { update } = moveTables()

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflows/${WORKFLOW}/move`,
      headers: { "x-user-id": USER },
      payload: { projectId: OTHER_PROJECT },
    })

    expect(res.statusCode).toBe(200)
    expect(update).toHaveBeenCalledWith({ project_id: OTHER_PROJECT, folder_id: null })
    expect(res.json().droppedCollaborators).toEqual([])
  })

  it("delegates the decision when a plugin provides one, and honours a refusal", async () => {
    const canMoveWorkflow = vi.fn().mockResolvedValue({ allowed: false, reason: "not_permitted" })
    vi.mocked(getPluginServices).mockReturnValue({ orgs: { canMoveWorkflow } } as never)
    moveTables()

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflows/${WORKFLOW}/move`,
      headers: { "x-user-id": USER },
      payload: { projectId: OTHER_PROJECT },
    })

    expect(res.statusCode).toBe(403)
    expect(canMoveWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        workflow: expect.objectContaining({ id: WORKFLOW }),
        targetProject: expect.objectContaining({ id: OTHER_PROJECT }),
      }),
    )
  })

  it("names who lost access when the move changes scope", async () => {
    const { collabDelete } = moveTables({
      workflow: { id: WORKFLOW, user_id: USER, workspace_id: WS, project_id: PROJECT, assignment_id: null },
      collaborators: [{ user_id: OTHER }],
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflows/${WORKFLOW}/move`,
      headers: { "x-user-id": USER },
      payload: { projectId: OTHER_PROJECT },
    })

    expect(res.statusCode).toBe(200)
    expect(collabDelete).toHaveBeenCalled()
    expect(res.json().droppedCollaborators).toEqual([{ userId: OTHER, name: "Sam" }])
  })

  it("leaves grants alone when the scope does not change", async () => {
    const { collabDelete } = moveTables({ collaborators: [{ user_id: OTHER }] })

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflows/${WORKFLOW}/move`,
      headers: { "x-user-id": USER },
      payload: { projectId: OTHER_PROJECT },
    })

    expect(res.statusCode).toBe(200)
    expect(collabDelete).not.toHaveBeenCalled()
  })

  it("refuses moving INTO an archived workspace, and allows moving OUT of one", async () => {
    context = { workspaceId: WS, archived: true }
    moveTables({
      workflow: { id: WORKFLOW, user_id: USER, workspace_id: WS, project_id: PROJECT, assignment_id: null },
      project: { id: OTHER_PROJECT, user_id: USER, workspace_id: WS },
    })

    const into = await app.inject({
      method: "POST",
      url: `/v1/workflows/${WORKFLOW}/move`,
      headers: { "x-user-id": USER },
      payload: { projectId: OTHER_PROJECT },
    })
    expect(into.statusCode).toBe(409)
    expect(into.json().error.code).toBe("workspace_archived")

    // Out of it, into the caller's personal space: allowed. Rescuing your work
    // is the reason anyone opens an archived workspace at all.
    moveTables({
      workflow: { id: WORKFLOW, user_id: USER, workspace_id: WS, project_id: PROJECT, assignment_id: null },
      project: { id: OTHER_PROJECT, user_id: USER, workspace_id: null },
    })
    const out = await app.inject({
      method: "POST",
      url: `/v1/workflows/${WORKFLOW}/move`,
      headers: { "x-user-id": USER },
      payload: { projectId: OTHER_PROJECT },
    })
    expect(out.statusCode).toBe(200)
  })

  it("PATCH { projectId } drops the same grants the move endpoint drops", async () => {
    // Sharing the authorization is half of "one rule". This path authorized
    // identically and then skipped the consequence, so a workflow could leave
    // a workspace with everyone in it still able to read it.
    const { collabDelete } = moveTables({
      workflow: { id: WORKFLOW, user_id: USER, workspace_id: WS, project_id: PROJECT, assignment_id: null },
      collaborators: [{ user_id: OTHER }],
    })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WORKFLOW}`,
      headers: { "x-user-id": USER },
      payload: { projectId: OTHER_PROJECT },
    })

    expect(res.statusCode).toBe(200)
    expect(collabDelete).toHaveBeenCalled()
    expect(res.json().droppedCollaborators).toEqual([{ userId: OTHER, name: "Sam" }])
  })

  it("reports only what was ACTUALLY removed, never what it meant to remove", async () => {
    // The delete used to be fire-and-forget after a separate read, so a failed
    // delete still answered "these people lost access" while all of them kept
    // it. A response that is wrong about who can see something is worse than
    // an error, because nobody goes looking.
    moveTables({
      workflow: { id: WORKFLOW, user_id: USER, workspace_id: WS, project_id: PROJECT, assignment_id: null },
      collaborators: [{ user_id: OTHER }],
      collabDeleteFails: true,
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflows/${WORKFLOW}/move`,
      headers: { "x-user-id": USER },
      payload: { projectId: OTHER_PROJECT },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().droppedCollaborators).toEqual([])
  })

  it("a database failure is a failure, not a 404", async () => {
    // Reporting a read error as "not found" is a lie that looks like a normal
    // outcome: nothing is logged with a stack, and the caller retries forever.
    vi.mocked(supabase.from).mockImplementation((() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "connection reset" } }),
        }),
      }),
    })) as never)

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflows/${WORKFLOW}/move`,
      headers: { "x-user-id": USER },
      payload: { projectId: OTHER_PROJECT },
    })

    expect(res.statusCode).toBe(500)
  })

  it("refuses work created for an assignment", async () => {
    moveTables({
      workflow: {
        id: WORKFLOW,
        user_id: USER,
        workspace_id: null,
        project_id: PROJECT,
        assignment_id: "00000000-0000-4000-8000-0000000000aa",
      },
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflows/${WORKFLOW}/move`,
      headers: { "x-user-id": USER },
      payload: { projectId: OTHER_PROJECT },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("move_blocked")
  })
})

// ---------------------------------------------------------------------------
// The row that protects everyone who exists today
// ---------------------------------------------------------------------------

describe("with no organizations plugin, nothing changed", () => {
  beforeEach(() => {
    context = {}
    vi.mocked(getPluginServices).mockReturnValue({} as never)
  })

  it("the workflows list is the personal one", async () => {
    const { userEq, wsIs } = workflowListChain()
    const res = await app.inject({ method: "GET", url: "/v1/workflows", headers: { "x-user-id": USER } })
    expect(res.statusCode).toBe(200)
    expect(userEq).toHaveBeenCalledWith("user_id", USER)
    expect(wsIs).toHaveBeenCalledWith("workspace_id", null)
  })

  it("a created project carries no workspace", async () => {
    const { insert } = insertChain(DB_PROJECT)
    vi.mocked(supabase.from).mockReturnValue({ insert } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { "x-user-id": USER },
      payload: { name: "P" },
    })

    expect(res.statusCode).toBe(201)
    expect(insert).toHaveBeenCalledWith(expect.not.objectContaining({ workspace_id: expect.anything() }))
  })

  it("a move is creator-only, both sides", async () => {
    const wfMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: WORKFLOW, user_id: USER, workspace_id: null, project_id: PROJECT, assignment_id: null },
      error: null,
    })
    const wfSelect = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: wfMaybeSingle }) })
    const projMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: OTHER_PROJECT, user_id: OTHER, workspace_id: null },
      error: null,
    })
    const projSelect = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: projMaybeSingle }) })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "projects") return { select: projSelect } as never
      if (table === "workflows") return { select: wfSelect } as never
      throw new Error("unexpected table " + table)
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflows/${WORKFLOW}/move`,
      headers: { "x-user-id": USER },
      payload: { projectId: OTHER_PROJECT },
    })

    expect(res.statusCode).toBe(403)
  })
})
