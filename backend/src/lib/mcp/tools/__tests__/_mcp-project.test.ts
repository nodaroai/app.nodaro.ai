import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return { supabase: { from: mockFrom } }
})

import { ensureMcpProject } from "../_mcp-project.js"
import { supabase } from "../../../supabase.js"
import type { McpSession } from "../../session.js"

function makeSession(overrides: Partial<McpSession> = {}): McpSession {
  return { userId: "user-1", scopes: [], clientName: "test", ...overrides }
}

function makeChain(maybeSingleResult: unknown, singleResult?: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(maybeSingleResult),
    single: vi.fn().mockResolvedValue(singleResult ?? maybeSingleResult),
  }
}

describe("ensureMcpProject", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns cached id without DB call on second invocation", async () => {
    const session = makeSession({ mcpProjectId: "cached-id" })
    const result = await ensureMcpProject(session)
    expect(result).toBe("cached-id")
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("returns existing project id when found", async () => {
    const session = makeSession()
    vi.mocked(supabase.from).mockReturnValueOnce(
      makeChain({ data: { id: "proj-existing" }, error: null }) as any,
    )
    const result = await ensureMcpProject(session)
    expect(result).toBe("proj-existing")
    expect(session.mcpProjectId).toBe("proj-existing")
  })

  it("creates project when not found and returns new id", async () => {
    const session = makeSession()
    vi.mocked(supabase.from)
      .mockReturnValueOnce(makeChain({ data: null, error: null }) as any)
      .mockReturnValueOnce(makeChain(null, { data: { id: "proj-new" }, error: null }) as any)
    const result = await ensureMcpProject(session)
    expect(result).toBe("proj-new")
    expect(session.mcpProjectId).toBe("proj-new")
  })

  it("throws when insert fails", async () => {
    const session = makeSession()
    vi.mocked(supabase.from)
      .mockReturnValueOnce(makeChain({ data: null, error: null }) as any)
      .mockReturnValueOnce(makeChain(null, { data: null, error: { message: "DB error" } }) as any)
    await expect(ensureMcpProject(session)).rejects.toThrow("DB error")
  })
})
