/**
 * The editable-copy source (`loadStudioEditableCopySource`) on a deployment
 * that does not allow public outputs (`outputs.allowPublic: false`).
 *
 * A workflow shared with `settings.studio.shared` and `allowEditableCopy` can
 * be read for copying by anyone signed in: the same opt-in the no-sign-in
 * public read (`GET /v1/public/workflows/:id`) answers to. Where public work is
 * not allowed that read is closed, so this one grants nothing through the flag
 * either — otherwise the closed read would still be open one door over. The
 * owner, and anyone the workflow is otherwise shared with, keep their access;
 * with the switch on nothing changes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const h = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, access: "none" as string }))

vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.maybeSingle = async () => ({ data: h.row, error: null })
      return chain
    },
  },
}))
vi.mock("../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config.js")>()),
  isCloud: () => true,
  isBusiness: () => false,
}))
vi.mock("../workflow-access.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../workflow-access.js")>()),
  workflowAccessFromRow: vi.fn(async () => h.access),
}))

import { loadStudioEditableCopySource, loadWorkflowFor } from "../workflow-route-access.js"
import { __resetSurfaceProfileCacheForTests } from "../surface-profile.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const COPIER = "00000000-0000-4000-8000-0000000000ff"

const sharedRow = () => ({
  id: "wf-1",
  user_id: OWNER,
  workspace_id: null,
  visibility: "private",
  settings: { studio: { shared: true, allowEditableCopy: true } },
  nodes: [{ id: "n1", type: "generate-image", data: { generatedImageUrl: "https://cdn.example/result.png" } }],
  edges: [],
})

function reply() {
  const r = { status: vi.fn(() => r), send: vi.fn(() => r) }
  return r
}

async function load(loader: typeof loadWorkflowFor, userId: string) {
  const r = reply()
  const loaded = await loader({} as never, r as never, userId, "wf-1", "view", "id, user_id, workspace_id, visibility, settings, nodes, edges", "Failed", { resolveResultIds: false })
  return { loaded, reply: r }
}

function setProfile(profile: Record<string, unknown> | null) {
  if (profile) process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

beforeEach(() => {
  h.row = sharedRow()
  setProfile({ outputs: { allowPublic: false } })
})

afterEach(() => setProfile(null))

describe("the editable-copy source with outputs.allowPublic false", () => {
  it("someone the workflow is not shared with is answered as for an unshared workflow: 404, nothing read", async () => {
    h.access = "none"
    const { loaded, reply: r } = await load(loadStudioEditableCopySource, COPIER)
    expect(loaded.ok).toBe(false)
    expect(r.status).toHaveBeenCalledWith(404)
    expect(r.send).toHaveBeenCalledWith({ error: { code: "not_found", message: "Workflow not found" } })
  })

  it("the owner still copies their own", async () => {
    h.access = "own"
    const { loaded } = await load(loadStudioEditableCopySource, OWNER)
    expect(loaded.ok).toBe(true)
    expect(loaded.ok && JSON.stringify(loaded.row.nodes)).toContain("result.png")
  })

  it("someone the workflow is shared with by its own grant keeps that access", async () => {
    h.access = "view"
    const { loaded } = await load(loadStudioEditableCopySource, COPIER)
    expect(loaded.ok).toBe(true)
  })
})

describe.each([
  ["no profile (the default)", null],
  ["a profile that allows public outputs", { outputs: { allowPublic: true } }],
])("the editable-copy source with public outputs allowed: %s", (_label, profile) => {
  beforeEach(() => setProfile(profile))

  it("anyone signed in reads the shared workflow for copying, as before", async () => {
    h.access = "none"
    const { loaded } = await load(loadStudioEditableCopySource, COPIER)
    expect(loaded.ok).toBe(true)
    expect(loaded.ok && loaded.access).toBe("view")
  })

  it("the flag still reaches only the copy source, never an ordinary read", async () => {
    h.access = "none"
    const { loaded } = await load(loadWorkflowFor, COPIER)
    expect(loaded.ok).toBe(false)
  })
})
