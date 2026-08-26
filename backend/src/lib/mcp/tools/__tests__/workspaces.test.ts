import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Scope } from "@/lib/scopes.js"

const h = vi.hoisted(() => ({
  hasOrganizations: vi.fn(() => true),
  orgs: undefined as
    | undefined
    | { resolveRequestContext: ReturnType<typeof vi.fn>; me: ReturnType<typeof vi.fn> },
  storeSessionWorkspace: vi.fn(async () => {}),
}))

vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...actual, hasOrganizations: h.hasOrganizations }
})
vi.mock("@/lib/private-plugins/load.js", () => ({ getPluginServices: () => ({ orgs: h.orgs }) }))
vi.mock("@/lib/mcp/workspace-session.js", () => ({ storeSessionWorkspace: h.storeSessionWorkspace }))

import { registerWorkspaces } from "@/lib/mcp/tools/workspaces.js"
import type { McpSession } from "@/lib/mcp/session.js"

const USER = "00000000-0000-4000-8000-000000000001"
const WS = "20000000-0000-4000-8000-000000000001"
const WS2 = "20000000-0000-4000-8000-000000000002"

type Handler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}>

/** A stand-in for the MCP server that just records what was registered. */
function fakeServer() {
  const tools = new Map<string, { config: Record<string, unknown>; handler: Handler }>()
  return {
    server: {
      registerTool: (name: string, config: Record<string, unknown>, handler: Handler) =>
        tools.set(name, { config, handler }),
    } as never,
    tools,
  }
}

function session(scopes: Scope[], workspaceId?: string): McpSession {
  return { userId: USER, scopes, clientName: "test", workspaceId }
}

const ME = {
  organizations: [{ id: "org-1", name: "School A", status: "active" }],
  workspaces: [
    { id: WS, orgId: "org-1", name: "Class 1", role: "member", archived: false },
    { id: WS2, orgId: "org-1", name: "Old Class", role: "admin", archived: true },
  ],
  lastWorkspaceId: WS,
}

const ALL: Scope[] = ["workspaces:read", "workspaces:write"]

beforeEach(() => {
  h.hasOrganizations.mockReturnValue(true)
  h.orgs = {
    me: vi.fn(async () => ME),
    resolveRequestContext: vi.fn(async () => ({ workspaceId: WS, orgId: "org-1" })),
  }
})
afterEach(() => vi.clearAllMocks())

/**
 * On a build without organizations the tools are ABSENT, not present and
 * empty — a client should discover that there is no such concept here, not
 * find a switch that does nothing.
 */
describe("registration", () => {
  it("registers nothing without the feature, and nothing without the service", () => {
    h.hasOrganizations.mockReturnValue(false)
    const off = fakeServer()
    registerWorkspaces({ server: off.server, session: session(ALL) })
    expect(off.tools.size).toBe(0)

    h.hasOrganizations.mockReturnValue(true)
    h.orgs = undefined
    const noPlugin = fakeServer()
    registerWorkspaces({ server: noPlugin.server, session: session(ALL) })
    expect(noPlugin.tools.size).toBe(0)
  })

  it("registers each tool only for the scope that owns it", () => {
    const read = fakeServer()
    registerWorkspaces({ server: read.server, session: session(["workspaces:read"]) })
    expect([...read.tools.keys()]).toEqual(["list_workspaces"])

    const write = fakeServer()
    registerWorkspaces({ server: write.server, session: session(["workspaces:write"]) })
    expect([...write.tools.keys()]).toEqual(["select_workspace"])

    const none = fakeServer()
    registerWorkspaces({ server: none.server, session: session(["workflows:read"]) })
    expect(none.tools.size).toBe(0)
  })

  it("marks the read as read-only so a client can reason about it", () => {
    const s = fakeServer()
    registerWorkspaces({ server: s.server, session: session(ALL) })
    expect(s.tools.get("list_workspaces")!.config.annotations).toMatchObject({ readOnlyHint: true })
    expect(s.tools.get("select_workspace")!.config.annotations).toBeUndefined()
  })
})

describe("list_workspaces", () => {
  async function call(workspaceId?: string) {
    const s = fakeServer()
    registerWorkspaces({ server: s.server, session: session(ALL, workspaceId) })
    return s.tools.get("list_workspaces")!.handler({})
  }

  it("names each workspace, its organization, and which one is selected", async () => {
    const res = await call(WS)
    expect(res.content[0].text).toContain("Currently working in " + WS)
    expect(res.content[0].text).toContain("Class 1 (School A)")
    expect(res.content[0].text).toContain("SELECTED")
    expect(res.structuredContent).toMatchObject({ selectedWorkspaceId: WS })
  })

  it("says plainly when the session is in the personal space", async () => {
    const res = await call(undefined)
    expect(res.content[0].text).toContain("personal space")
    expect(res.content[0].text).not.toContain("SELECTED")
    expect(res.structuredContent).toMatchObject({ selectedWorkspaceId: null })
  })

  it("marks an archived workspace, because it is still selectable but read-only", async () => {
    const res = await call(WS)
    expect(res.content[0].text).toContain("archived")
  })

  it("treats belonging to nothing as normal, not as an error", async () => {
    h.orgs!.me = vi.fn(async () => ({ organizations: [], workspaces: [], lastWorkspaceId: null }))
    const res = await call(undefined)
    expect(res.isError).toBeUndefined()
    expect(res.content[0].text).toMatch(/belongs to no workspaces/i)
  })

  it("reports a failed read as an error rather than as an empty list", async () => {
    h.orgs!.me = vi.fn(async () => {
      throw new Error("db down")
    })
    const res = await call(undefined)
    expect(res.isError).toBe(true)
  })
})

describe("select_workspace", () => {
  async function call(args: Record<string, unknown>, s = session(ALL)) {
    const f = fakeServer()
    registerWorkspaces({ server: f.server, session: s })
    return { res: await f.tools.get("select_workspace")!.handler(args), session: s }
  }

  it("asks the resolver, and stores only what resolved", async () => {
    const { res, session: sess } = await call({ workspace_id: WS })
    expect(h.orgs!.resolveRequestContext).toHaveBeenCalledWith({
      userId: USER,
      headerWorkspaceId: WS,
      identityRoute: false,
    })
    expect(h.storeSessionWorkspace).toHaveBeenCalledWith(USER, WS)
    expect(sess.workspaceId).toBe(WS)
    expect(res.structuredContent).toMatchObject({ workspaceId: WS, orgId: "org-1" })
  })

  it("reports a refusal and stores NOTHING — a preference that was never valid costs every later session", async () => {
    h.orgs!.resolveRequestContext = vi.fn(async () => ({
      reject: { status: 403, code: "not_a_member", message: "Not a member of that workspace" },
    }))
    const { res, session: sess } = await call({ workspace_id: WS })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe("Not a member of that workspace")
    expect(h.storeSessionWorkspace).not.toHaveBeenCalled()
    expect(sess.workspaceId).toBeUndefined()
  })

  it("treats a silent non-resolution as a refusal too", async () => {
    h.orgs!.resolveRequestContext = vi.fn(async () => ({}))
    const { res } = await call({ workspace_id: WS })
    expect(res.isError).toBe(true)
    expect(h.storeSessionWorkspace).not.toHaveBeenCalled()
  })

  it("goes back to the personal space without asking anyone", async () => {
    const { res, session: sess } = await call({ workspace_id: null }, session(ALL, WS))
    expect(res.isError).toBeUndefined()
    expect(h.orgs!.resolveRequestContext).not.toHaveBeenCalled()
    expect(h.storeSessionWorkspace).toHaveBeenCalledWith(USER, null)
    expect(sess.workspaceId).toBeUndefined()
  })

  it("clears the cached mcp/landing project on SELECT — the id belonged to the old context", async () => {
    const s = session(ALL)
    s.mcpProjectId = "stale-project-from-before"
    await call({ workspace_id: WS }, s)
    expect(s.workspaceId).toBe(WS)
    // Without this, ensureMcpProject would keep writing this session's work into
    // the previous context's project for the rest of the session.
    expect(s.mcpProjectId).toBeUndefined()
  })

  it("clears the cached mcp/landing project on DESELECT too", async () => {
    const s = session(ALL, WS)
    s.mcpProjectId = "stale-workspace-landing-project"
    await call({ workspace_id: null }, s)
    expect(s.workspaceId).toBeUndefined()
    expect(s.mcpProjectId).toBeUndefined()
  })
})
