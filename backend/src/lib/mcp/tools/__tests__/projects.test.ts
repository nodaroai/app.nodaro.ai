import { describe, it, expect, vi, beforeEach } from "vitest"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { registerProjectTools } = await import("../projects.js")
const { supabase } = await import("../../../supabase.js")

const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * Chain stub for the `projects` list query:
 * `.from("projects").select(...).eq("user_id", ...).order("name", ...)` resolves.
 */
function projectsListChain(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
}

/**
 * Chain stub for the `projects` single-row query:
 * `.from("projects").select(...).eq("user_id", ...).eq("id"|"name", ...).maybeSingle()`.
 */
function projectsSingleChain(row: unknown | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  }
}

/**
 * Chain stub for the `workflows` count query:
 * `.from("workflows").select("project_id").eq("user_id", ...).in("project_id", [...])` resolves.
 */
function workflowsCountChain(rows: Array<{ project_id: string | null }>) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: rows, error: null }),
  }
}

function readSession() {
  return newSession({
    userId: "u1",
    scopes: ["workflows:read"] as Scope[],
    clientName: "Claude",
  })
}

describe("list_projects tool", () => {
  it("returns an empty array when the user has no projects", async () => {
    fromMock.mockReturnValueOnce(projectsListChain([]))
    // No workflows query is issued when there are zero projects.
    const server = buildServer()
    registerProjectTools(server, readSession())
    const result = await callTool(server, "list_projects", {})
    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as { data: unknown[] }
    expect(payload.data).toEqual([])
  })

  it("returns projects with workflow counts", async () => {
    fromMock
      .mockReturnValueOnce(
        projectsListChain([
          {
            id: "p1",
            name: "Alpha",
            description: "first",
            created_at: "2026-04-01T00:00:00Z",
          },
          {
            id: "p2",
            name: "Beta",
            description: null,
            created_at: "2026-04-02T00:00:00Z",
          },
        ]),
      )
      .mockReturnValueOnce(
        workflowsCountChain([
          { project_id: "p1" },
          { project_id: "p1" },
          { project_id: "p2" },
        ]),
      )
    const server = buildServer()
    registerProjectTools(server, readSession())
    const result = await callTool(server, "list_projects", {})
    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      data: Array<{ id: string; name: string; workflowCount: number }>
    }
    expect(payload.data).toHaveLength(2)
    expect(payload.data[0]).toMatchObject({ id: "p1", name: "Alpha", workflowCount: 2 })
    expect(payload.data[1]).toMatchObject({ id: "p2", name: "Beta", workflowCount: 1 })
  })

  it("does NOT register without workflows:read scope", async () => {
    const server = buildServer()
    registerProjectTools(
      server,
      newSession({ userId: "u1", scopes: [] as Scope[], clientName: "Claude" }),
    )
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("list_projects")
    expect(tools.map((t) => t.name)).not.toContain("get_project")
  })
})

describe("get_project tool", () => {
  it("finds a project by id (UUID input)", async () => {
    fromMock
      .mockReturnValueOnce(
        projectsSingleChain({
          id: "11111111-1111-4111-8111-111111111111",
          name: "By Id",
          description: "desc",
          created_at: "2026-04-01T00:00:00Z",
        }),
      )
      .mockReturnValueOnce(
        workflowsCountChain([{ project_id: "11111111-1111-4111-8111-111111111111" }]),
      )
    const server = buildServer()
    registerProjectTools(server, readSession())
    const result = await callTool(server, "get_project", {
      project_id: "11111111-1111-4111-8111-111111111111",
    })
    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      data: { id: string; name: string; workflowCount: number }
    }
    expect(payload.data.id).toBe("11111111-1111-4111-8111-111111111111")
    expect(payload.data.name).toBe("By Id")
    expect(payload.data.workflowCount).toBe(1)
  })

  it("finds a project by name (non-UUID input)", async () => {
    fromMock
      .mockReturnValueOnce(
        projectsSingleChain({
          id: "p9",
          name: "marketing",
          description: null,
          created_at: "2026-04-05T00:00:00Z",
        }),
      )
      .mockReturnValueOnce(workflowsCountChain([]))
    const server = buildServer()
    registerProjectTools(server, readSession())
    const result = await callTool(server, "get_project", { project_id: "marketing" })
    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      data: { id: string; name: string; workflowCount: number }
    }
    expect(payload.data.id).toBe("p9")
    expect(payload.data.name).toBe("marketing")
    expect(payload.data.workflowCount).toBe(0)
  })

  it("returns isError when the project is not found", async () => {
    fromMock.mockReturnValueOnce(projectsSingleChain(null))
    const server = buildServer()
    registerProjectTools(server, readSession())
    const result = await callTool(server, "get_project", { project_id: "nope" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("not found")
  })
})
