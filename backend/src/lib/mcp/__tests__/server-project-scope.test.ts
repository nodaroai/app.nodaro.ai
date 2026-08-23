/**
 * `buildMcpServer({ projectScope })` pins an in-app session to one project.
 * The pin is authorized at this single choke point: the project must belong
 * to the session's user, or the server is never built.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"

const { fromMock, maybeSingleMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  maybeSingleMock: vi.fn(),
}))

vi.mock("../../supabase.js", () => ({
  supabase: { from: fromMock },
}))

const { buildMcpServer } = await import("../server.js")

function projectsChain() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: maybeSingleMock,
  }
}

describe("buildMcpServer projectScope", () => {
  beforeEach(() => {
    fromMock.mockReset()
    maybeSingleMock.mockReset()
    fromMock.mockImplementation(() => projectsChain())
  })

  it("builds when the project belongs to the user and looks it up by id AND user_id", async () => {
    maybeSingleMock.mockResolvedValue({ data: { id: "proj-1" }, error: null })
    const server = await buildMcpServer({
      userId: "u1",
      scopes: ["workflows:read"],
      clientName: "copilot",
      fastify: Fastify(),
      projectScope: { projectId: "proj-1" },
    })
    expect(server).toBeDefined()
    expect(fromMock).toHaveBeenCalledWith("projects")
    const chain = fromMock.mock.results.find((r) => r.value?.maybeSingle === maybeSingleMock)?.value as
      | { eq: ReturnType<typeof vi.fn> }
      | undefined
    expect(chain?.eq).toHaveBeenCalledWith("id", "proj-1")
    expect(chain?.eq).toHaveBeenCalledWith("user_id", "u1")
  })

  it("refuses to build when the project is not the user's", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    await expect(
      buildMcpServer({
        userId: "u1",
        scopes: ["workflows:read"],
        clientName: "copilot",
        fastify: Fastify(),
        projectScope: { projectId: "someone-elses" },
      }),
    ).rejects.toThrow(/project not found for this user/)
  })

  it("does not touch the projects table when no projectScope is given (the /mcp path)", async () => {
    await buildMcpServer({ userId: "u1", scopes: ["workflows:read"], clientName: "Claude", fastify: Fastify() })
    expect(fromMock).not.toHaveBeenCalledWith("projects")
  })
})
