import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { registerDynamicTools } = await import("../dynamic.js")
const { supabase } = await import("../../../supabase.js")
const { _resetRegistry, getTask } = await import("../../tasks.js")

beforeEach(() => {
  vi.clearAllMocks()
  _resetRegistry()
})

interface MockRow {
  id: string
  name: string
  slug: string | null
  publish_type: "app" | "component"
  description?: string | null
  component_metadata?: unknown
}

/**
 * Stubs the `published_apps` query chain with kind-aware responses.
 * fetchByKind() does: from().select().eq().eq().eq().order().order().limit()
 * We intercept the second eq() (publish_type=...) to branch by kind.
 */
function mockPublishedApps(byKind: { app?: MockRow[]; component?: MockRow[] }) {
  ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockImplementation((_col1: string, _val1: string) => ({
        eq: vi.fn().mockImplementation((_col2: string, kindVal: string) => {
          const rows =
            kindVal === "component" ? byKind.component ?? [] : byKind.app ?? []
          return {
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
                }),
              }),
            }),
          }
        }),
      })),
    }),
  })
}

describe("registerDynamicTools — gating + capping", () => {
  it("does NOT register anything without workflows:execute", async () => {
    mockPublishedApps({ app: [{ id: "a1", name: "A", slug: "a", publish_type: "app" }] })
    const server = buildServer()
    await registerDynamicTools({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).toEqual([])
  })

  it("respects PER_KIND_CAP=15 (mock returns 20, expect 15 of each)", async () => {
    const components = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      name: `Comp ${i}`,
      slug: `comp-${i}`,
      publish_type: "component" as const,
    }))
    const apps = Array.from({ length: 20 }, (_, i) => ({
      id: `a${i}`,
      name: `App ${i}`,
      slug: `app-${i}`,
      publish_type: "app" as const,
    }))
    // mockPublishedApps simulates supabase enforcing .limit(15) — the test
    // verifies the registrar only registers what it gets back.
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockImplementation(() => ({
          eq: vi.fn().mockImplementation((_col2: string, kindVal: string) => {
            const all = kindVal === "component" ? components : apps
            return {
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    // Real Supabase honors .limit() — emulate.
                    limit: vi.fn(async (n: number) => ({
                      data: all.slice(0, n),
                      error: null,
                    })),
                  }),
                }),
              }),
            }
          }),
        })),
      }),
    })

    const server = buildServer()
    await registerDynamicTools({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:execute"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    const compNames = tools.filter((t) => t.name.startsWith("component_"))
    const appNames = tools.filter((t) => t.name.startsWith("app_"))
    expect(compNames.length).toBe(15)
    expect(appNames.length).toBe(15)
  })

  it("appends _2 suffix to colliding sanitized slugs", async () => {
    mockPublishedApps({
      component: [
        { id: "c1", name: "Image Gen", slug: "image gen", publish_type: "component" },
        { id: "c2", name: "Image-Gen", slug: "image-gen", publish_type: "component" },
      ],
    })

    const server = buildServer()
    await registerDynamicTools({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:execute"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(["component_image_gen", "component_image_gen_2"])
  })

  it("falls back to row.name when slug is missing", async () => {
    mockPublishedApps({
      component: [{ id: "c1", name: "Anonymous Component", slug: null, publish_type: "component" }],
    })
    const server = buildServer()
    await registerDynamicTools({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:execute"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).toContain("component_anonymous_component")
  })
})

describe("registerDynamicTools — component dispatch", () => {
  it("registers a component tool that calls /v1/component/execute and returns _meta.task_id + widget", async () => {
    mockPublishedApps({
      component: [
        {
          id: "c1",
          name: "Marketing Video Gen",
          slug: "marketing-video",
          publish_type: "component",
          description: "Make marketing videos",
          component_metadata: {
            inputs: [
              { id: "node-prompt", name: "Prompt", type: "text", required: true, fieldKey: "value" },
            ],
            outputs: [],
            exposedSettings: [],
          },
        },
      ],
    })

    const fastify = Fastify()
    let received: Record<string, unknown> | undefined
    fastify.post("/v1/component/execute", async (req, reply) => {
      received = req.body as Record<string, unknown>
      return reply.status(202).send({ jobId: "job-abc" })
    })

    const server = buildServer()
    await registerDynamicTools({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:execute"] as Scope[],
        clientName: "Claude",
      }),
      fastify,
    })

    const result = await callTool(server, "component_marketing_video", {
      prompt: "puppy on a beach",
    })
    expect(result.isError).toBeUndefined()
    expect((result._meta as Record<string, unknown>)?.task_id).toBe("job-abc")
    // 2 content items: text + workflow widget resource
    expect(result.content.length).toBe(2)
    expect(received?.appSlug).toBe("marketing-video")
    expect(received?.mcp_client).toBe("Claude")
    expect(received?.userId).toBe("u1")
    // inputOverrides built from the typed handle: { node-prompt: { value: ... } }
    expect(received?.inputOverrides).toEqual({ "node-prompt": { value: "puppy on a beach" } })

    // Task registered with kind=component
    expect(getTask("job-abc")?.kind).toBe("component")
  })

  it("surfaces a clear error when component has no slug", async () => {
    mockPublishedApps({
      component: [{ id: "c1", name: "Slugless", slug: null, publish_type: "component" }],
    })
    const server = buildServer()
    await registerDynamicTools({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:execute"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "component_slugless", {})
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("no slug")
  })
})

describe("registerDynamicTools — app dispatch", () => {
  it("registers an app tool that calls /v1/app/:slug/run and returns _meta.task_id + widget", async () => {
    mockPublishedApps({
      app: [
        {
          id: "a1",
          name: "Photo Editor",
          slug: "photo-editor",
          publish_type: "app",
          description: null,
        },
      ],
    })
    const fastify = Fastify()
    let received: Record<string, unknown> | undefined
    let receivedUrl = ""
    fastify.post("/v1/app/:slug/run", async (req, reply) => {
      received = req.body as Record<string, unknown>
      receivedUrl = req.url
      return reply.status(202).send({ executionId: "exec-xyz" })
    })

    const server = buildServer()
    await registerDynamicTools({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:execute"] as Scope[],
        clientName: "Cursor",
      }),
      fastify,
    })
    const result = await callTool(server, "app_photo_editor", {
      inputs: { "n-1": { value: "hello" } },
    })
    expect(result.isError).toBeUndefined()
    expect((result._meta as Record<string, unknown>)?.task_id).toBe("exec-xyz")
    expect(result.content.length).toBe(2)
    expect(receivedUrl).toBe("/v1/app/photo-editor/run")
    expect(received?.inputOverrides).toEqual({ "n-1": { value: "hello" } })
    expect(received?.mcp_client).toBe("Cursor")
    expect(getTask("exec-xyz")?.kind).toBe("app")
  })
})
