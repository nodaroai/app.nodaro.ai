import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { registerApps } = await import("../apps.js")
const { supabase } = await import("../../../supabase.js")

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * Thenable Supabase chain mock. Supabase queries are PromiseLike — awaiting
 * the chain after any number of .eq/.order/.lt/.limit calls resolves to
 * { data, error }. Mirroring that with a .then on the chain object means
 * we don't need to know how many builder methods the code chains before
 * awaiting.
 */
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

/** Same shape but resolves at the .single() leaf used by get_*_inputs / run_*. */
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

describe("list_apps tool", () => {
  it("returns marketplace apps (default scope=public)", async () => {
    chainResolves([
      {
        id: "a1",
        slug: "headshot-pro",
        name: "Headshot Pro",
        created_at: "2026-04-01T00:00:00Z",
      },
    ])
    const server = buildServer()
    registerApps({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["apps:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "list_apps", { limit: 5 })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain('"headshot-pro"')
    expect(result.content[0]?.text).toContain('"scope": "public"')
  })

  it("scope=mine errors without auth", async () => {
    chainResolves([])
    const server = buildServer()
    registerApps({
      server,
      session: newSession({
        userId: "",
        scopes: ["apps:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "list_apps", { scope: "mine" })
    expect(result.isError).toBe(true)
  })

  it("does NOT register without apps:read scope", async () => {
    const server = buildServer()
    registerApps({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("list_apps")
  })
})

describe("get_app_inputs tool", () => {
  it("returns flat schema for an app's exposed inputs", async () => {
    chainResolvesSingle({
      slug: "headshot-pro",
      name: "Headshot Pro",
      description: null,
      is_listed: true,
      creator_id: "owner",
      is_active: true,
      publish_type: "app",
      snapshot_settings: {
        presentationSettings: {
          inputItems: [
            { type: "node", nodeId: "n1" },
            { type: "field", id: "f1", nodeId: "n2", field: "tone", allowedValues: ["a", "b"] },
          ],
        },
      },
      snapshot_nodes: [
        { id: "n1", type: "upload-image", data: { label: "Photo" } },
        { id: "n2", type: "text-prompt", data: { label: "Style" } },
      ],
    })
    const server = buildServer()
    registerApps({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["apps:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "get_app_inputs", { slug: "headshot-pro" })
    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      inputs: Array<{ key: string; type: string; options?: unknown }>
    }
    expect(payload.inputs).toHaveLength(2)
    expect(payload.inputs[0]?.type).toBe("image")
    expect(payload.inputs[1]?.type).toBe("select")
    expect(payload.inputs[1]?.options).toEqual(["a", "b"])
  })
})

describe("run_app tool", () => {
  it("translates flat inputs to node-id-keyed inputOverrides", async () => {
    // First DB call: schema lookup. Returns app with one image input on n1.
    chainResolvesSingle({
      snapshot_settings: {
        presentationSettings: {
          inputItems: [{ type: "node", nodeId: "n1" }],
        },
      },
      snapshot_nodes: [{ id: "n1", type: "upload-image", data: { label: "Photo" } }],
    })

    const fastify = Fastify()
    let received: Record<string, unknown> | undefined
    fastify.post("/v1/app/:slug/run", async (req, reply) => {
      received = req.body as Record<string, unknown>
      return reply.status(202).send({ executionId: "e-app" })
    })
    const server = buildServer()
    registerApps({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:execute"] as Scope[],
        clientName: "Claude",
      }),
      fastify,
    })
    const result = await callTool(server, "run_app", {
      slug: "headshot-pro",
      inputs: { photo: "https://r2/photo.jpg" },
    })
    expect(result.isError).toBeUndefined()
    expect((result.structuredContent as Record<string, unknown>)?.executionId).toBe("e-app")
    expect(received?.userId).toBe("u1")
    expect((received?.inputOverrides as Record<string, unknown>)?.n1).toEqual({
      url: "https://r2/photo.jpg",
    })
  })

  it("does NOT register without workflows:execute scope", async () => {
    const server = buildServer()
    registerApps({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["apps:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("run_app")
  })
})
