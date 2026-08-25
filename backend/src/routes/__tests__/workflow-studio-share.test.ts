import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `settings.studio.shared` — the fourth audience lever, and the one that is not
 * a column.
 *
 * Three levers decide who can reach a workflow and all three are pinned to the
 * creator or a workspace admin: `visibility`, `share_token`,
 * `is_presentation_enabled`. There is a fourth, and it is the widest of them:
 * `settings.studio.shared === true` makes a workflow readable by
 * `GET /v1/public/workflows/:id` — no auth, whole graph, to anyone holding the
 * id.
 *
 * It lives inside a free-form JSON column, so neither the PATCH schema nor the
 * row policy's column pinning can see it, and an editor writes `settings` on
 * every ordinary save. Before workflows could be shared that was harmless,
 * because only the creator could PATCH at all.
 */

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x" },
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

import { workflowRoutes } from "../workflows.js"
import { supabase } from "../../lib/supabase.js"
import { getPluginServices } from "../../lib/private-plugins/load.js"

const CREATOR = "00000000-0000-4000-8000-000000000001"
const EDITOR = "00000000-0000-4000-8000-0000000000ff"
const WF = "00000000-0000-4000-8000-000000000020"
const WS = "00000000-0000-4000-8000-000000000030"

const ROW = {
  id: WF,
  project_id: "00000000-0000-4000-8000-000000000010",
  user_id: CREATOR,
  workspace_id: WS,
  visibility: "workspace",
  folder_id: null,
  name: "Class work",
  description: null,
  is_template: false,
  version: 3,
  thumbnail_url: null,
  source_prompt: null,
  nodes: [],
  edges: [],
  settings: { studio: { shared: false } },
  parent_workflow_id: null,
  app_slug: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

/** An editor: may change the canvas, may not decide the audience. */
function asEditor() {
  vi.mocked(getPluginServices).mockReturnValue({
    orgs: {
      workflowAccess: vi.fn().mockResolvedValue("edit"),
      workflowAccessFromRow: vi.fn().mockResolvedValue("edit"),
      canDeleteWorkflow: vi.fn().mockResolvedValue(false),
      canRunWorkflow: vi.fn().mockResolvedValue(true),
      canChangeWorkflowVisibility: vi.fn().mockResolvedValue(false),
      canShareWorkflow: vi.fn().mockResolvedValue(false),
    },
  } as never)
}

/** The creator: may decide the audience. */
function asCreator() {
  vi.mocked(getPluginServices).mockReturnValue({
    orgs: {
      workflowAccess: vi.fn().mockResolvedValue("own"),
      workflowAccessFromRow: vi.fn().mockResolvedValue("own"),
      canDeleteWorkflow: vi.fn().mockResolvedValue(true),
      canRunWorkflow: vi.fn().mockResolvedValue(true),
      canChangeWorkflowVisibility: vi.fn().mockResolvedValue(true),
      canShareWorkflow: vi.fn().mockResolvedValue(true),
    },
  } as never)
}

function tables(extra: Record<string, unknown> = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: ROW, error: null })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  vi.mocked(supabase.from).mockReturnValue({ select, ...extra } as never)
  return { select, eq }
}

/** A full-body PATCH's update chain. */
function updateChain() {
  const maybeSingle = vi.fn().mockResolvedValue({ data: ROW, error: null })
  const selectAfter = vi.fn().mockReturnValue({ maybeSingle })
  const eq = vi.fn().mockReturnValue({ select: selectAfter })
  const update = vi.fn().mockReturnValue({ eq })
  return update
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("onRequest", async (req) => {
    req.orgs = async () => ({ organizations: [], workspaces: [] })
  })
  app.addHook("preHandler", async (req) => {
    const h = req.headers["x-user-id"]
    if (typeof h === "string") req.userId = h
  })
  await app.register(async (i) => { await workflowRoutes(i) })
  await app.ready()
})

afterEach(async () => { await app.close() })

describe("the public-publish flag is an audience decision, not an edit", () => {
  it("refuses an editor turning it ON through a full-body save", async () => {
    // The attack this exists for: one PATCH, and the creator's whole graph is
    // readable by anyone with the id, with no auth and no signal in the
    // creator's share dialog (that shows `share_token`, which is untouched).
    asEditor()
    const update = updateChain()
    tables({ update })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WF}`,
      headers: { "x-user-id": EDITOR },
      payload: { settings: { studio: { shared: true } } },
    })

    expect(res.statusCode).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it("refuses an editor turning it ON through a DELTA save", async () => {
    // The delta path authorizes in SQL at `edit` and can carry `set.settings`,
    // so it reaches the same lever by a different door.
    asEditor()
    tables()

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WF}`,
      headers: { "x-user-id": EDITOR },
      payload: { delta: { baseVersion: 3, set: { settings: { studio: { shared: true } } } } },
    })

    expect(res.statusCode).toBe(403)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it("lets an editor save settings that do NOT touch it", async () => {
    // The other half: an ordinary save must stay ordinary. A rule that refused
    // every settings write would break the editor for every collaborator.
    asEditor()
    const update = updateChain()
    tables({ update })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WF}`,
      headers: { "x-user-id": EDITOR },
      payload: { settings: { autoSave: true } },
    })

    expect(res.statusCode).toBe(200)
    expect(update).toHaveBeenCalled()
  })

  it("lets an editor carry the studio block through UNCHANGED", async () => {
    // The full-body path compares against the stored value rather than
    // refusing on presence, so a client that round-trips the whole settings
    // object — which the editor does on every save — is not locked out.
    asEditor()
    const update = updateChain()
    tables({ update })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WF}`,
      headers: { "x-user-id": EDITOR },
      payload: { settings: { studio: { shared: false }, autoSave: true } },
    })

    expect(res.statusCode).toBe(200)
    expect(update).toHaveBeenCalled()
  })

  it("refuses an editor flipping presentationSettings.shareReadOnly from true to false", async () => {
    // The second lever in the same JSON: shareReadOnly=true keeps a share link
    // view-only; flipping it false lets link holders RUN the creator's
    // workflow on the creator's credits. The attack starts from the SAFE state
    // (true) and moves to the dangerous one — so the stored row has it on.
    asEditor()
    const viewOnly = { ...ROW, settings: { presentationSettings: { shareReadOnly: true } } }
    const maybeSingle = vi.fn().mockResolvedValue({ data: viewOnly, error: null })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    const update = updateChain()
    vi.mocked(supabase.from).mockReturnValue({ select, update } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WF}`,
      headers: { "x-user-id": EDITOR },
      payload: { settings: { presentationSettings: { shareReadOnly: false } } },
    })

    expect(res.statusCode).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it("refuses an editor ERASING shareReadOnly by omission", async () => {
    // The full-body path replaces the whole settings object, so a save that
    // simply omits presentationSettings erases shareReadOnly — turning a
    // view-only link runnable without ever naming the field. Omission is a
    // change.
    asEditor()
    const withReadOnly = {
      ...ROW,
      settings: { presentationSettings: { shareReadOnly: true } },
    }
    const maybeSingle = vi.fn().mockResolvedValue({ data: withReadOnly, error: null })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    const update = updateChain()
    vi.mocked(supabase.from).mockReturnValue({ select, update } as never)

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WF}`,
      headers: { "x-user-id": EDITOR },
      payload: { settings: { autoSave: true } },
    })

    expect(res.statusCode).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it("lets the CREATOR turn it on", async () => {
    asCreator()
    const update = updateChain()
    tables({ update })

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WF}`,
      headers: { "x-user-id": CREATOR },
      payload: { settings: { studio: { shared: true } } },
    })

    expect(res.statusCode).toBe(200)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ settings: { studio: { shared: true } } }),
    )
  })
})
