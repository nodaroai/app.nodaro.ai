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

// findOldestMcpProject: select.eq.eq.order.order.limit.maybeSingle
function selectChain(maybeSingleResult: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(maybeSingleResult),
  }
}

// the create path now awaits `.insert({...})` directly (no .select().single())
function insertChain(error: unknown) {
  return { insert: vi.fn().mockResolvedValue({ error }) }
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
      selectChain({ data: { id: "proj-existing" }, error: null }) as any,
    )
    const result = await ensureMcpProject(session)
    expect(result).toBe("proj-existing")
    expect(session.mcpProjectId).toBe("proj-existing")
  })

  it("creates when not found, then re-selects the oldest as source of truth", async () => {
    const session = makeSession()
    vi.mocked(supabase.from)
      .mockReturnValueOnce(selectChain({ data: null, error: null }) as any) // initial find: miss
      .mockReturnValueOnce(insertChain(null) as any) // insert
      .mockReturnValueOnce(selectChain({ data: { id: "proj-new" }, error: null }) as any) // re-select
    const result = await ensureMcpProject(session)
    expect(result).toBe("proj-new")
    expect(session.mcpProjectId).toBe("proj-new")
  })

  it("converges on the concurrent winner: ignores our own insert, uses the re-selected oldest", async () => {
    const session = makeSession()
    vi.mocked(supabase.from)
      .mockReturnValueOnce(selectChain({ data: null, error: null }) as any)
      .mockReturnValueOnce(insertChain({ message: "duplicate" }) as any) // our insert may even fail
      .mockReturnValueOnce(selectChain({ data: { id: "proj-winner" }, error: null }) as any)
    const result = await ensureMcpProject(session)
    expect(result).toBe("proj-winner")
    expect(session.mcpProjectId).toBe("proj-winner")
  })

  it("throws when insert fails and no row appears on re-select", async () => {
    const session = makeSession()
    vi.mocked(supabase.from)
      .mockReturnValueOnce(selectChain({ data: null, error: null }) as any)
      .mockReturnValueOnce(insertChain({ message: "DB error" }) as any)
      .mockReturnValueOnce(selectChain({ data: null, error: null }) as any)
    await expect(ensureMcpProject(session)).rejects.toThrow("DB error")
  })
})
