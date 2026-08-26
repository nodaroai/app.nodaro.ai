import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { McpSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool } from "./_helpers.js"

/**
 * P11 — the WORKSPACE branch of the by-id workflow tools.
 *
 * These paths are dark in production (`ORGS_ENABLED` off → `session.workspaceId`
 * is never set), so they are exercised here by setting `workspaceId` directly.
 * The access seam is mocked so a NON-creator editor can exist — the case that
 * only appears once the flag flips, and the one the audience gate exists for.
 * The no-workspace equivalence lives in `workflows.test.ts`; this file only
 * covers what the workspace branch adds.
 */

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

// Real `accessAtLeast` (loadMcpWorkflow compares access ≥ min with it); only the
// two seam answers are overridable per test.
vi.mock("../../../workflow-access.js", async (importActual) => {
  const actual = await importActual<typeof import("../../../workflow-access.js")>()
  return {
    ...actual,
    workflowAccessFromRow: vi.fn(),
    canChangeWorkflowVisibility: vi.fn(),
  }
})

const { registerWorkflows } = await import("../workflows.js")
const { supabase } = await import("../../../supabase.js")
const access = await import("../../../workflow-access.js")

const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>
const accessFromRow = access.workflowAccessFromRow as unknown as ReturnType<typeof vi.fn>
const canChangeVis = access.canChangeWorkflowVisibility as unknown as ReturnType<typeof vi.fn>

const WS_ID = "77777777-7777-4777-8777-777777777777"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000001"

beforeEach(() => {
  vi.clearAllMocks()
})

function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "lt", "in", "order", "limit", "insert", "delete", "update"]) {
    obj[m] = vi.fn(() => obj)
  }
  obj.maybeSingle = vi.fn().mockResolvedValue(result)
  obj.single = vi.fn().mockResolvedValue(result)
  obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return obj
}

/** A session pinned to a workspace (the dark-in-prod branch). */
function wsSession(scopes: Scope[]): McpSession {
  const s = newSession({ userId: "u1", scopes, clientName: "Claude" })
  s.workspaceId = WS_ID
  return s
}

// ── delete_workflow ──────────────────────────────────────────────────────────

describe("delete_workflow — workspace branch", () => {
  it("routes through the audited REST DELETE, not a raw supabase delete", async () => {
    const fastify = Fastify()
    const seen: { url?: string; internalUser?: string; workspace?: string } = {}
    fastify.delete("/v1/workflows/:id", async (req) => {
      seen.url = req.url
      seen.internalUser = req.headers["x-internal-user-id"] as string
      seen.workspace = req.headers["x-nodaro-workspace"] as string
      return { success: true }
    })

    const server = buildServer()
    registerWorkflows({ server, session: wsSession(["workflows:write"]), fastify })
    const result = await callTool(server, "delete_workflow", { workflow_id: WORKFLOW_ID })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.deleted).toBe(true)
    // The whole P10 delete invariant lives in the route — the tool must reach it.
    expect(seen.url).toBe(`/v1/workflows/${WORKFLOW_ID}`)
    // A bodyless DELETE carries the caller via the header the auth hook reads.
    expect(seen.internalUser).toBe("u1")
    expect(seen.workspace).toBe(WS_ID)
    // Never a direct table delete in the workspace branch — that would skip the audit.
    expect(fromMock).not.toHaveBeenCalled()
  })

  it("relays the route's friendly refusal (403) as MCP error text", async () => {
    const fastify = Fastify()
    fastify.delete("/v1/workflows/:id", async (_req, reply) =>
      reply.status(403).send({
        error: { code: "forbidden", message: "Only the owner or a workspace admin can delete this workflow" },
      }),
    )
    const server = buildServer()
    registerWorkflows({ server, session: wsSession(["workflows:write"]), fastify })
    const result = await callTool(server, "delete_workflow", { workflow_id: WORKFLOW_ID })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("workspace admin")
    expect(fromMock).not.toHaveBeenCalled()
  })
})

// ── run_workflow ─────────────────────────────────────────────────────────────

describe("run_workflow — workspace branch", () => {
  it("gates on the seam (view) then dispatches the run", async () => {
    accessFromRow.mockResolvedValue("view")
    // The row must carry the access columns `toAccessRow` requires — the seam
    // adds them to the SELECT, so the real DB always returns them.
    fromMock.mockReturnValue(
      chain({
        data: { id: WORKFLOW_ID, user_id: "u1", workspace_id: WS_ID, visibility: "workspace", name: "Class Flow" },
        error: null,
      }),
    )

    const fastify = Fastify()
    let ranWith: Record<string, unknown> | undefined
    fastify.post("/v1/workflows/:id/run", async (req) => {
      ranWith = req.body as Record<string, unknown>
      return { executionId: "e-9" }
    })

    const server = buildServer()
    registerWorkflows({ server, session: wsSession(["workflows:execute"]), fastify })
    const result = await callTool(server, "run_workflow", { workflow_id: WORKFLOW_ID })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.executionId).toBe("e-9")
    expect(ranWith?.userId).toBe("u1")
  })

  it("a member who cannot even see it gets not-found and no run", async () => {
    accessFromRow.mockResolvedValue("none")
    fromMock.mockReturnValue(
      chain({
        data: { id: WORKFLOW_ID, user_id: "someone-else", workspace_id: WS_ID, visibility: "workspace", name: "Hidden" },
        error: null,
      }),
    )

    const fastify = Fastify()
    let hit = false
    fastify.post("/v1/workflows/:id/run", async () => {
      hit = true
      return { executionId: "x" }
    })
    const server = buildServer()
    registerWorkflows({ server, session: wsSession(["workflows:execute"]), fastify })
    const result = await callTool(server, "run_workflow", { workflow_id: WORKFLOW_ID })

    expect(result.isError).toBe(true)
    expect(hit).toBe(false)
  })
})

// ── update_workflow_json (the C1 audience gate) ──────────────────────────────

describe("update_workflow_json — workspace audience gate", () => {
  it("refuses a non-creator editor who tries to flip an audience bit", async () => {
    // Edit access — enough to change the canvas — but NOT visibility authority.
    accessFromRow.mockResolvedValue("edit")
    canChangeVis.mockResolvedValue(false)
    fromMock.mockReturnValue(
      chain({
        data: { id: WORKFLOW_ID, user_id: "creator-other", workspace_id: WS_ID, visibility: "workspace", settings: {} },
        error: null,
      }),
    )

    const server = buildServer()
    registerWorkflows({ server, session: wsSession(["workflows:write"]), fastify: Fastify() })
    const result = await callTool(server, "update_workflow_json", {
      workflow_id: WORKFLOW_ID,
      settings: { studio: { shared: true } }, // opening the public read
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("owner or a workspace admin")
    expect(canChangeVis).toHaveBeenCalledWith("u1", WORKFLOW_ID)
  })

  it("allows an ordinary content edit (no audience change) on edit access", async () => {
    accessFromRow.mockResolvedValue("edit")
    fromMock.mockReturnValue(
      chain({
        data: {
          id: WORKFLOW_ID,
          user_id: "creator-other",
          workspace_id: WS_ID,
          visibility: "workspace",
          name: "WF",
          settings: {},
          updated_at: "t",
          version: 2,
        },
        error: null,
      }),
    )

    const server = buildServer()
    registerWorkflows({ server, session: wsSession(["workflows:write"]), fastify: Fastify() })
    const result = await callTool(server, "update_workflow_json", {
      workflow_id: WORKFLOW_ID,
      nodes: [],
      edges: [],
    })

    expect(result.isError).toBeUndefined()
    // A content-only edit never consults the visibility authority.
    expect(canChangeVis).not.toHaveBeenCalled()
  })
})
