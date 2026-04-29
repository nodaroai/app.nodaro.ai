import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { registerGallery } = await import("../gallery.js")
const { supabase } = await import("../../../supabase.js")

beforeEach(() => {
  vi.clearAllMocks()
})

function readSession() {
  return newSession({
    userId: "u1",
    scopes: ["assets:read"] as Scope[],
    clientName: "Claude",
  })
}

function writeSession() {
  return newSession({
    userId: "u1",
    scopes: ["assets:write"] as Scope[],
    clientName: "Claude",
  })
}

describe("browse_gallery tool", () => {
  it("formats rows as one line per item with cursor footer", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: "g1",
                        job_type: "generate-image",
                        input_data: {
                          prompt: "knight",
                          provider: "nano-banana",
                        },
                        output_data: { imageUrl: "https://r2/x.png" },
                        completed_at: "2026-04-29T12:00:00Z",
                        provider: "nano-banana",
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    })
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "browse_gallery", { limit: 1 })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("g1: image")
    expect(result.content[0]?.text).toContain("nano-banana")
    expect(result.content[0]?.text).toContain("2026-04-29")
    // Per MCP Apps: text + structuredContent (iframe template at
    // ui://nodaro/widget/gallery consumes the items array).
    expect(result.content.length).toBe(1)
    const sc = (result as { structuredContent?: Record<string, unknown> }).structuredContent
    expect(Array.isArray(sc?.items)).toBe(true)
  })

  it("does NOT register without assets:read scope", async () => {
    const server = buildServer()
    registerGallery({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("browse_gallery")
  })
})

describe("list_favorites tool", () => {
  it("returns favorited job_ids", async () => {
    // Two from() calls: first hits gallery_favorites, second hydrates jobs.
    const favoritesChain = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [
                { job_id: "f1", created_at: "2026-04-29T12:00:00Z" },
                { job_id: "f2", created_at: "2026-04-29T11:00:00Z" },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }
    const jobsChain = {
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    }
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(favoritesChain)
      .mockReturnValueOnce(jobsChain)
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "list_favorites", {})
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("\"f1\"")
    expect(result.content[0]?.text).toContain("\"f2\"")
  })

  it("does NOT register without assets:read scope", async () => {
    const server = buildServer()
    registerGallery({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("list_favorites")
  })
})

describe("get_asset tool", () => {
  it("returns asset data when owned", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "g1",
                user_id: "u1",
                status: "completed",
                output_data: { imageUrl: "https://r2/x.png" },
              },
              error: null,
            }),
          }),
        }),
      }),
    })
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_asset", { job_id: "g1" })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("\"g1\"")
  })

  it("returns isError when not found", async () => {
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    })
    const server = buildServer()
    registerGallery({ server, session: readSession(), fastify: Fastify() })
    const result = await callTool(server, "get_asset", { job_id: "missing" })
    expect(result.isError).toBe(true)
  })
})

describe("favorite_asset tool", () => {
  it("inserts a favorite when favorited=true", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null })
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      insert: insertMock,
    })
    const server = buildServer()
    registerGallery({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "favorite_asset", {
      job_id: "g1",
      favorited: true,
    })
    expect(result.isError).toBeUndefined()
    expect(insertMock).toHaveBeenCalledWith({
      user_id: "u1",
      job_id: "g1",
    })
  })

  it("deletes a favorite when favorited=false", async () => {
    const eqMock2 = vi.fn().mockResolvedValue({ error: null })
    const eqMock1 = vi.fn().mockReturnValue({ eq: eqMock2 })
    const deleteMock = vi.fn().mockReturnValue({ eq: eqMock1 })
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      delete: deleteMock,
    })
    const server = buildServer()
    registerGallery({ server, session: writeSession(), fastify: Fastify() })
    const result = await callTool(server, "favorite_asset", {
      job_id: "g1",
      favorited: false,
    })
    expect(result.isError).toBeUndefined()
    expect(deleteMock).toHaveBeenCalled()
  })

  it("does NOT register without assets:write scope", async () => {
    const server = buildServer()
    registerGallery({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["assets:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("favorite_asset")
  })
})
