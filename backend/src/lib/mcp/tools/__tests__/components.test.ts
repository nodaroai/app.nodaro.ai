import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { registerComponents } = await import("../components.js")
const { supabase } = await import("../../../supabase.js")

beforeEach(() => {
  vi.clearAllMocks()
})

function chainResolves(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {}
  const mk = () => chain
  for (const m of ["select", "eq", "is", "order", "lt", "textSearch", "limit"]) {
    chain[m] = vi.fn(mk)
  }
  chain.then = (onR: (v: { data: unknown; error: null }) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(onR)
  ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain)
}

function chainResolvesSingle(row: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {}
  const mk = () => chain
  for (const m of ["select", "eq", "is", "order", "lt", "textSearch", "limit"]) {
    chain[m] = vi.fn(mk)
  }
  chain.single = vi.fn().mockResolvedValue({ data: row, error: null })
  ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue(chain)
}

describe("list_components tool", () => {
  it("returns marketplace components (default scope=public)", async () => {
    chainResolves([
      {
        id: "c1",
        slug: "thumbnail-maker",
        name: "Thumbnail Maker",
        created_at: "2026-04-01T00:00:00Z",
      },
    ])
    const server = buildServer()
    registerComponents({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "list_components", { limit: 5 })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain('"thumbnail-maker"')
    expect(result.content[0]?.text).toContain('"scope": "public"')
  })

  it("does NOT register without workflows:read scope", async () => {
    const server = buildServer()
    registerComponents({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("list_components")
  })
})

describe("get_component_inputs tool", () => {
  it("returns flat schema from component_metadata.inputs", async () => {
    chainResolvesSingle({
      slug: "thumbnail-maker",
      name: "Thumbnail Maker",
      description: null,
      is_listed: true,
      creator_id: "owner",
      is_active: true,
      publish_type: "component",
      component_metadata: {
        inputs: [
          { id: "h1", name: "source image", fieldKey: "url", type: "image", required: true },
          { id: "h2", name: "title", fieldKey: "text", type: "text", required: false },
        ],
      },
    })
    const server = buildServer()
    registerComponents({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "get_component_inputs", {
      component_id: "thumbnail-maker",
    })
    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      inputs: Array<{ key: string; type: string; required: boolean }>
    }
    expect(payload.inputs).toHaveLength(2)
    expect(payload.inputs[0]?.type).toBe("image")
    expect(payload.inputs[0]?.required).toBe(true)
    expect(payload.inputs[1]?.type).toBe("text")
  })
})

describe("run_component tool", () => {
  it("translates flat inputs to inputOverrides via component_metadata", async () => {
    chainResolvesSingle({
      component_metadata: {
        inputs: [
          { id: "h1", name: "source image", fieldKey: "url", type: "image", required: true },
        ],
      },
    })
    const fastify = Fastify()
    let received: Record<string, unknown> | undefined
    fastify.post("/v1/component/execute", async (req, reply) => {
      received = req.body as Record<string, unknown>
      return reply.status(202).send({ jobId: "j-comp" })
    })
    const server = buildServer()
    registerComponents({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:execute"] as Scope[],
        clientName: "Cursor",
      }),
      fastify,
    })
    const result = await callTool(server, "run_component", {
      component_id: "thumbnail-maker",
      inputs: { source_image: "https://r2/img.jpg" },
    })
    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as Record<string, unknown>)?.jobId).toBe("j-comp")
    expect(received?.appSlug).toBe("thumbnail-maker")
    expect((received?.inputOverrides as Record<string, unknown>)?.h1).toEqual({
      url: "https://r2/img.jpg",
    })
  })

  it("does NOT register without workflows:execute scope", async () => {
    const server = buildServer()
    registerComponents({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("run_component")
  })
})
