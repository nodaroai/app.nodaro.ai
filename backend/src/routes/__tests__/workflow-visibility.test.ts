import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The organization side of the by-id workflow routes.
 *
 * `workflows.test.ts` covers what every install without organizations gets —
 * the fallback, byte-for-byte what these routes did before the access seam
 * existed. This file covers the other half: the plugin present, the flag on,
 * and a caller who is NOT the creator.
 *
 * Four rules live here, and each one is a separate question that a route was
 * tempted to answer with `access >= edit`:
 *
 *   - changing who a workflow is visible TO is not editing it
 *   - deleting it is not editing it
 *   - running it is not editing it, because running spends the class's money
 *   - publishing it is not editing it
 *
 * Every test below has a matching mutation in the PR body: break the rule in
 * the route and the named test goes red. A green suite on this axis has
 * already proved nothing once, in the PR before this one.
 */

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
  hasOrganizations: () => true,
}))

vi.mock("@/lib/private-plugins/load.js", () => ({
  getPluginServices: vi.fn(() => ({})),
  loadPrivatePlugins: vi.fn(),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/workflow-delete.js", () => ({
  deleteWorkflowWithPrivateMedia: vi.fn(),
}))

vi.mock("@/lib/orchestration-queue.js", () => ({
  orchestrationQueue: { add: vi.fn().mockResolvedValue({ id: "orch-1" }) },
}))

vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn(), getJob: vi.fn(), remove: vi.fn() },
  renderQueue: { add: vi.fn() },
  redis: {},
  tryRemoveFromQueue: vi.fn(),
}))

vi.mock("@/lib/sse.js", () => ({
  createSSEStream: vi.fn().mockReturnValue({
    sendEvent: vi.fn(), sendComment: vi.fn(), close: vi.fn(), isClosed: false,
  }),
}))

vi.mock("@/lib/execution-events.js", () => ({
  executionEvents: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}))

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { refundCredits: vi.fn() },
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
}))

vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: vi.fn() }))

vi.mock("@/lib/storage.js", () => ({
  copyToTemplatePreview: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/ee/middleware/require-admin.js", () => ({ requireAdmin: vi.fn() }))

// ---------------------------------------------------------------------------

import { workflowRoutes } from "../workflows.js"
import { workflowExecutionRoutes } from "../workflow-execution.js"
import { workflowTemplatesRoutes } from "../workflow-templates.js"
import { publishedAppsRoutes } from "../published-apps.js"
import { webhookTriggerRoutes } from "../webhook-triggers.js"
import { supabase } from "../../lib/supabase.js"
import { getPluginServices } from "../../lib/private-plugins/load.js"
import { deleteWorkflowWithPrivateMedia } from "../../lib/workflow-delete.js"
import type { PluginMemberships } from "../../lib/private-plugins/types.js"

const CREATOR = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-0000000000ff"
const WF = "00000000-0000-4000-8000-000000000020"
const WS = "00000000-0000-4000-8000-000000000030"
const OTHER_WS = "00000000-0000-4000-8000-000000000031"

/** A workflow that belongs to CREATOR and lives in a workspace. */
const WORKSPACE_WORKFLOW = {
  id: WF,
  project_id: "00000000-0000-4000-8000-000000000010",
  user_id: CREATOR,
  workspace_id: WS,
  visibility: "workspace",
  folder_id: null,
  name: "Class work",
  description: null,
  is_template: false,
  version: 1,
  thumbnail_url: null,
  source_prompt: null,
  nodes: [],
  edges: [],
  settings: {},
  parent_workflow_id: null,
  app_slug: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

/** A personal workflow that belongs to CREATOR. */
const PERSONAL_WORKFLOW = { ...WORKSPACE_WORKFLOW, workspace_id: null, visibility: "private" }

type OrgsAnswers = {
  access?: string
  canDelete?: boolean
  canRun?: boolean
  canChangeVisibility?: boolean
  canShare?: boolean
  auditOk?: boolean
}

let auditCalls: Array<Record<string, unknown>>

/** Install a plugin that answers exactly what a test wants it to. */
function plugin(answers: OrgsAnswers) {
  auditCalls = []
  const level = answers.access ?? "edit"
  const orgs = {
    workflowAccess: vi.fn().mockResolvedValue(level),
    workflowAccessFromRow: vi.fn().mockResolvedValue(level),
    canDeleteWorkflow: vi.fn().mockResolvedValue(answers.canDelete ?? false),
    canRunWorkflow: vi.fn().mockResolvedValue(answers.canRun ?? false),
    canChangeWorkflowVisibility: vi.fn().mockResolvedValue(answers.canChangeVisibility ?? false),
    canShareWorkflow: vi.fn().mockResolvedValue(answers.canShare ?? false),
    auditWorkflowDeleted: vi.fn().mockImplementation((input: Record<string, unknown>) => {
      auditCalls.push(input)
      return Promise.resolve(answers.auditOk ?? true)
    }),
  }
  vi.mocked(getPluginServices).mockReturnValue({ orgs } as never)
  return orgs
}

/** `.from("workflows").select(…).eq("id", …).maybeSingle()` → this row. */
function workflowRow(row: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  vi.mocked(supabase.from).mockReturnValue({ select, ...extra } as never)
  return { select, eq }
}

let memberships: PluginMemberships
let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  auditCalls = []
  memberships = { organizations: [], workspaces: [] }
  vi.mocked(deleteWorkflowWithPrivateMedia).mockResolvedValue(true)

  app = Fastify({ logger: false })
  app.addHook("onRequest", async (req) => {
    req.orgs = async () => memberships
  })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (i) => {
    await workflowRoutes(i)
    await workflowExecutionRoutes(i)
    await workflowTemplatesRoutes(i)
    await publishedAppsRoutes(i)
    await webhookTriggerRoutes(i)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------

describe("PATCH /v1/workflows/:id { visibility } — visibility needs more than edit", () => {
  it("refuses an editor who may change the canvas", async () => {
    // The whole point: an editor flipping `private` to `workspace` would be
    // publishing somebody else's work to the class. Editing and deciding who
    // else sees it are different powers, asked of different authorities.
    const orgs = plugin({ access: "edit", canChangeVisibility: false })
    workflowRow(WORKSPACE_WORKFLOW, { update: vi.fn() })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WF}`,
      headers: { "x-user-id": OTHER },
      payload: { visibility: "workspace" },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(orgs.canChangeWorkflowVisibility).toHaveBeenCalledWith(OTHER, WF)
  })

  it("allows someone the rule says may decide it", async () => {
    plugin({ access: "edit", canChangeVisibility: true })
    const maybeSingle = vi.fn().mockResolvedValue({ data: WORKSPACE_WORKFLOW, error: null })
    const readEq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq: readEq })
    const updateSelect = vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({
        data: { ...WORKSPACE_WORKFLOW, visibility: "private" }, error: null,
      }),
    })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })
    vi.mocked(supabase.from).mockReturnValue({ select, update } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WF}`,
      headers: { "x-user-id": OTHER },
      payload: { visibility: "private" },
    })

    expect(res.statusCode).toBe(200)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ visibility: "private" }))
  })

  it("refuses on a workflow that is in no workspace at all", async () => {
    // There is nothing for it to be visible TO. Storing the value would leave
    // a field that reads as a setting and governs nothing — worse than a
    // refusal, because the caller would believe they had shared something.
    plugin({ access: "own", canChangeVisibility: true })
    const update = vi.fn()
    workflowRow(PERSONAL_WORKFLOW, { update })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WF}`,
      headers: { "x-user-id": CREATOR },
      payload: { visibility: "workspace" },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("not_workspace_scoped")
    expect(update).not.toHaveBeenCalled()
  })

  it("does not ask the question when the field is absent", async () => {
    const orgs = plugin({ access: "edit" })
    const updateSelect = vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({ data: WORKSPACE_WORKFLOW, error: null }),
    })
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: updateSelect }) })
    workflowRow(WORKSPACE_WORKFLOW, { update })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WF}`,
      headers: { "x-user-id": OTHER },
      payload: { name: "renamed" },
    })

    expect(res.statusCode).toBe(200)
    expect(orgs.canChangeWorkflowVisibility).not.toHaveBeenCalled()
  })
})

describe("DELETE /v1/workflows/:id — delete is its own question", () => {
  it("refuses a collaborator holding an EDITOR grant", async () => {
    // The grant was given to help with the work, not to end it. `edit` is
    // deliberately not enough, which is why this route asks a different
    // member instead of comparing access levels.
    plugin({ access: "edit", canDelete: false })
    workflowRow(WORKSPACE_WORKFLOW)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflows/${WF}`,
      headers: { "x-user-id": OTHER },
    })

    expect(res.statusCode).toBe(403)
    expect(deleteWorkflowWithPrivateMedia).not.toHaveBeenCalled()
  })

  it("admin delete is recorded BEFORE it happens, under the workflow's workspace", async () => {
    plugin({ access: "edit", canDelete: true, auditOk: true })
    workflowRow(WORKSPACE_WORKFLOW)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflows/${WF}`,
      headers: { "x-user-id": OTHER },
    })

    expect(res.statusCode).toBe(200)
    expect(auditCalls).toEqual([
      {
        actorId: OTHER,
        workflowId: WF,
        workflowName: "Class work",
        workspaceId: WS,
        creatorId: CREATOR,
      },
    ])
    // And the RPC gets the CREATOR's id, because its row filter is
    // `user_id = p_user_id` — the caller's id would match nothing.
    expect(deleteWorkflowWithPrivateMedia).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: WF, userId: CREATOR }),
    )
  })

  it("refuses the delete when the audit entry cannot be written", async () => {
    // "Through the system only" buys nothing if the system can delete without
    // recording it. An audit row for an attempt that then failed is the safe
    // direction to be wrong in; a destroyed workflow nobody can attribute is
    // not.
    plugin({ access: "edit", canDelete: true, auditOk: false })
    workflowRow(WORKSPACE_WORKFLOW)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflows/${WF}`,
      headers: { "x-user-id": OTHER },
    })

    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("audit_unavailable")
    expect(deleteWorkflowWithPrivateMedia).not.toHaveBeenCalled()
  })

  it("a creator deleting their OWN work is not audited", async () => {
    plugin({ access: "own", canDelete: true })
    workflowRow(WORKSPACE_WORKFLOW)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflows/${WF}`,
      headers: { "x-user-id": CREATOR },
    })

    expect(res.statusCode).toBe(200)
    expect(auditCalls).toEqual([])
  })

  it("REFUSES a non-creator deleting a personal workflow — it could not be recorded", async () => {
    // The only caller who reaches this is a platform admin: they resolve to
    // `own` on every workflow in the database, so `canDeleteWorkflow` says yes.
    // But a personal workflow has no organization for an audit entry to belong
    // to, and the rule this route is built around is "a non-creator deletion is
    // recorded, or it does not happen". Where it cannot be recorded, it does
    // not happen — which is also what this route answered before the access
    // rule widened it. Somebody else's private work is the single worst thing
    // to be able to destroy with nobody's name on it.
    plugin({ access: "own", canDelete: true })
    workflowRow({ ...PERSONAL_WORKFLOW, user_id: CREATOR })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflows/${WF}`,
      headers: { "x-user-id": OTHER },
    })

    expect(res.statusCode).toBe(403)
    expect(deleteWorkflowWithPrivateMedia).not.toHaveBeenCalled()
    expect(auditCalls).toEqual([])
  })

  it("a creator deleting their OWN personal workflow is untouched and unaudited", async () => {
    plugin({ access: "own", canDelete: true })
    workflowRow({ ...PERSONAL_WORKFLOW, user_id: CREATOR })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/workflows/${WF}`,
      headers: { "x-user-id": CREATOR },
    })

    expect(res.statusCode).toBe(200)
    expect(auditCalls).toEqual([])
  })
})

describe("POST /v1/workflows/:id/run — running is stricter than editing", () => {
  it("refuses an outside collaborator who may edit but does not belong", async () => {
    // The cap that keeps a stranger from billing the class: they can change
    // the canvas and cannot start a job somebody else pays for.
    const orgs = plugin({ access: "edit", canRun: false })
    workflowRow({ ...WORKSPACE_WORKFLOW, nodes: [] })

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflows/${WF}/run`,
      headers: { "x-user-id": OTHER },
      payload: {},
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.message).toMatch(/not a member of this workspace/i)
    expect(orgs.canRunWorkflow).toHaveBeenCalledWith(OTHER, WF)
  })

  it("a caller with no access at all gets 404, not 403", async () => {
    plugin({ access: "none", canRun: false })
    workflowRow(WORKSPACE_WORKFLOW)

    const res = await app.inject({
      method: "POST",
      url: `/v1/workflows/${WF}/run`,
      headers: { "x-user-id": OTHER },
      payload: {},
    })

    expect(res.statusCode).toBe(404)
  })
})

describe("publishing takes own AND authorship", () => {
  it("a template refuses an editor: a template is a disclosure, not an edit", async () => {
    plugin({ access: "edit" })
    workflowRow(WORKSPACE_WORKFLOW)

    const res = await app.inject({
      method: "POST",
      url: "/v1/templates/publish",
      headers: { "x-user-id": OTHER },
      payload: { workflowId: WF, name: "Stolen template", description: "x" },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
  })

  it("an app refuses an editor too", async () => {
    plugin({ access: "edit" })
    workflowRow(WORKSPACE_WORKFLOW)

    const res = await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      headers: { "x-user-id": OTHER },
      payload: { workflowId: WF, name: "Stolen app" },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
  })

  it("both refuse somebody the rule calls OWNER but who did not make it", async () => {
    // A platform admin resolves to `own` on every workflow in the database —
    // that is a documented decision of the access rule, not a bug. It means an
    // `own` bar alone does NOT mean "the creator", and publishing is the one
    // act where having made the thing is the actual question: the snapshot goes
    // out under the publisher's name, to strangers, permanently.
    for (const url of ["/v1/templates/publish", "/v1/apps/publish"]) {
      plugin({ access: "own" })
      workflowRow(WORKSPACE_WORKFLOW)

      const res = await app.inject({
        method: "POST",
        url,
        headers: { "x-user-id": OTHER },
        payload: { workflowId: WF, name: "Not mine", description: "x" },
      })

      expect(res.statusCode, `${url} must refuse a non-author`).toBe(403)
    }
  })

  it("refuses the CREATOR when the rule has capped them at view", async () => {
    // Both bars are load-bearing, and this is the cell where the LEVEL one is
    // the only thing left. Authorship passes — they did make it — and the
    // access rule has still capped them at `view`, which is what it answers to
    // a creator whose workspace is archived, or whose membership in it has
    // been suspended. Publishing a snapshot out of a frozen class is exactly
    // what freezing it was for.
    plugin({ access: "view" })
    workflowRow(WORKSPACE_WORKFLOW)

    const res = await app.inject({
      method: "POST",
      url: "/v1/templates/publish",
      headers: { "x-user-id": CREATOR },
      payload: { workflowId: WF, name: "Frozen", description: "x" },
    })

    expect(res.statusCode).toBe(403)
  })

  it("and allow the creator", async () => {
    plugin({ access: "own" })
    workflowRow(WORKSPACE_WORKFLOW)

    const res = await app.inject({
      method: "POST",
      url: "/v1/templates/publish",
      headers: { "x-user-id": CREATOR },
      payload: { workflowId: WF, name: "Mine", description: "x" },
    })

    // Past the authorization; whatever it does next is the publish path's own
    // business and not this test's.
    expect(res.statusCode).not.toBe(403)
    expect(res.statusCode).not.toBe(404)
  })
})

describe("POST /v1/workflow-triggers — a trigger is a standing run", () => {
  it("refuses somebody who may edit but may not run", async () => {
    // The bar is `canRunWorkflow`, not `edit`. Asking only `edit` would let a
    // caller who is refused at `POST /v1/workflows/:id/run` mint a webhook URL
    // that runs the very same workflow, unattended and on somebody else's
    // credits.
    const orgs = plugin({ access: "edit", canRun: false })
    workflowRow(WORKSPACE_WORKFLOW, { insert: vi.fn() })

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow-triggers",
      headers: { "x-user-id": OTHER },
      payload: { workflowId: WF, type: "webhook" },
    })

    expect(res.statusCode).toBe(403)
    expect(orgs.canRunWorkflow).toHaveBeenCalledWith(OTHER, WF)
  })

  it("is 404, not 403, for a workflow the caller cannot see", async () => {
    plugin({ access: "none", canRun: false })
    workflowRow(WORKSPACE_WORKFLOW, { insert: vi.fn() })

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow-triggers",
      headers: { "x-user-id": OTHER },
      payload: { workflowId: WF, type: "webhook" },
    })

    expect(res.statusCode).toBe(404)
  })

  it("allows somebody the rule says may run it", async () => {
    plugin({ access: "edit", canRun: true })
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "trig-1" }, error: null }),
      }),
    })
    workflowRow(WORKSPACE_WORKFLOW, { insert })

    const res = await app.inject({
      method: "POST",
      url: "/v1/workflow-triggers",
      headers: { "x-user-id": OTHER },
      payload: { workflowId: WF, type: "webhook" },
    })

    expect(res.statusCode).toBe(201)
    expect(insert).toHaveBeenCalled()
  })
})

describe("GET /v1/workflows/:id/access — the one question the canvas asks", () => {
  it("answers the level plus every lever the surfaces render from", async () => {
    plugin({ access: "view", canChangeVisibility: false, canShare: false, canRun: false })
    workflowRow(WORKSPACE_WORKFLOW)

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${WF}/access`,
      headers: { "x-user-id": OTHER },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({
      access: "view",
      workspaceId: WS,
      visibility: "workspace",
      canChangeVisibility: false,
      canShare: false,
      canRun: false,
    })
  })

  it("passes each permission through SEPARATELY — they are different rules", async () => {
    // The three are genuinely independent: a team workspace lets an editor
    // invite people (`canShare`) while reserving the class-wide switch
    // (`canChangeVisibility`) for admins, and `canRun` can be false while the
    // caller may still edit. A route that answered one from another would look
    // right in every test that set them all the same way — so this one sets
    // them all differently.
    plugin({ access: "edit", canChangeVisibility: false, canShare: true, canRun: false })
    workflowRow(WORKSPACE_WORKFLOW)

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${WF}/access`,
      headers: { "x-user-id": OTHER },
    })

    const data = res.json().data
    expect(data.canChangeVisibility).toBe(false)
    expect(data.canShare).toBe(true)
    expect(data.canRun).toBe(false)
  })

  it("reports the permissions as TRUE when the rule says so", async () => {
    plugin({ access: "own", canChangeVisibility: true, canShare: true, canRun: true })
    workflowRow(PERSONAL_WORKFLOW)

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${WF}/access`,
      headers: { "x-user-id": CREATOR },
    })

    const data = res.json().data
    expect(data.access).toBe("own")
    expect(data.canChangeVisibility).toBe(true)
    expect(data.canShare).toBe(true)
    expect(data.canRun).toBe(true)
    expect(data.workspaceId).toBeNull()
    expect(data.visibility).toBe("private")
  })

  it("never returns the graph — that is the whole reason it is its own route", async () => {
    plugin({ access: "own", canChangeVisibility: true })
    const { select } = workflowRow(PERSONAL_WORKFLOW)

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${WF}/access`,
      headers: { "x-user-id": CREATOR },
    })

    expect(res.json().data.nodes).toBeUndefined()
    expect(select).toHaveBeenCalledWith("id, user_id, workspace_id, visibility")
  })

  it("is 404 for somebody who cannot see the workflow at all", async () => {
    plugin({ access: "none" })
    workflowRow(WORKSPACE_WORKFLOW)

    const res = await app.inject({
      method: "GET",
      url: `/v1/workflows/${WF}/access`,
      headers: { "x-user-id": OTHER },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe("GET /v1/workflows/shared-with-me", () => {
  /** `.from("workflow_collaborators").select(…).eq(…).limit(…)` → rows. */
  function grants(rows: Array<{ role: string; workflows: Record<string, unknown> }>) {
    const limit = vi.fn().mockResolvedValue({ data: rows, error: null })
    // `.order()` before `.limit()`, because an unordered cap takes an arbitrary
    // page rather than the most recent one. Pinned by the mock's shape: drop
    // the ordering from the route and every test in this block breaks.
    const order = vi.fn().mockReturnValue({ limit })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    vi.mocked(supabase.from).mockReturnValue({ select } as never)
    return { select, eq, order, limit }
  }

  it("lists work shared with me, with the role that reaches it", async () => {
    plugin({ access: "edit" })
    const { eq } = grants([{ role: "editor", workflows: PERSONAL_WORKFLOW }])

    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows/shared-with-me",
      headers: { "x-user-id": OTHER },
    })

    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(WF)
    expect(data[0].grantedRole).toBe("editor")
    // Scoped to the CALLER, by name and by value. Without this the mock is
    // satisfied by any `.eq()` at all, so a route that asked for every grant in
    // the table — or keyed the filter on the wrong column — would pass every
    // test in this block. The query carries a `tenant-scope-ignore`, so the
    // lint does not guard it either: this assertion is the only thing that does.
    expect(eq).toHaveBeenCalledWith("user_id", OTHER)
  })

  it("drops a grant whose access has since been revoked", async () => {
    // A grant row and access are not the same thing. The rule refuses over a
    // live grant in more than one state — a suspended membership, an
    // organization that has been deleted — and in each of those this page would
    // otherwise show a name and a thumbnail for something that 404s when
    // opened. This page is exactly where a person whose access was just revoked
    // goes to look.
    plugin({ access: "none" })
    grants([{ role: "editor", workflows: WORKSPACE_WORKFLOW }])

    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows/shared-with-me",
      headers: { "x-user-id": OTHER },
    })

    expect(res.json().data).toEqual([])
  })

  it("EXCLUDES work in a workspace I already belong to", async () => {
    // It is already in that workspace's own lists. Listing it twice would make
    // "shared with me" the less true of the two labels.
    plugin({})
    memberships = {
      organizations: [],
      workspaces: [{ workspaceId: WS, orgId: "o1", role: "member", status: "active" }],
    }
    grants([{ role: "editor", workflows: WORKSPACE_WORKFLOW }])

    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows/shared-with-me",
      headers: { "x-user-id": OTHER },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([])
  })

  it("KEEPS work in a workspace I do NOT belong to", async () => {
    plugin({})
    memberships = {
      organizations: [],
      workspaces: [{ workspaceId: OTHER_WS, orgId: "o1", role: "member", status: "active" }],
    }
    grants([{ role: "viewer", workflows: WORKSPACE_WORKFLOW }])

    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows/shared-with-me",
      headers: { "x-user-id": OTHER },
    })

    expect(res.json().data).toHaveLength(1)
  })

  it("handles the empty-membership case — the common one", async () => {
    // Most callers belong to no workspace. The exclusion runs in TypeScript
    // rather than as a PostgREST `not.in` precisely because an empty `in`
    // list is the classic way to write a filter that matches wrongly.
    plugin({})
    grants([{ role: "editor", workflows: WORKSPACE_WORKFLOW }])

    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows/shared-with-me",
      headers: { "x-user-id": OTHER },
    })

    expect(res.json().data).toHaveLength(1)
  })

  it("drops a grant whose workflow could not be joined", async () => {
    plugin({})
    grants([{ role: "editor", workflows: null as never }])

    const res = await app.inject({
      method: "GET",
      url: "/v1/workflows/shared-with-me",
      headers: { "x-user-id": OTHER },
    })

    expect(res.json().data).toEqual([])
  })
})
