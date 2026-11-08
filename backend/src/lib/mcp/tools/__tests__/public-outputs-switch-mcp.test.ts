/**
 * A deployment that does not allow public outputs (`outputs.allowPublic:
 * false`) has no public gallery, so the MCP public scopes list nothing — and
 * read no job to find that out. The workers already make every new output
 * private there; what these pin is the READ: a row marked public before the
 * switch was set, or carried over in a copied database, must not be listed
 * either. The caller's own library is untouched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool } from "./_helpers.js"
import { __resetSurfaceProfileCacheForTests } from "../../../surface-profile.js"

const state = vi.hoisted(() => ({ rows: [] as unknown[], tables: [] as string[] }))

vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../app-settings.js", () => ({
  getAppSettings: vi.fn(async () => ({ gallery_blocked_words: [], gallery_banned_users: [] })),
  settingsReadFailed: () => false,
}))

const { registerGallery } = await import("../gallery.js")
const { registerJobs } = await import("../jobs.js")
const { supabase } = await import("../../../supabase.js")

const OTHER = "00000000-0000-4000-8000-00000000000b"

function chain() {
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return (resolve: (value: unknown) => void) => resolve({ data: state.rows, count: state.rows.length, error: null })
        return () => proxy
      },
    },
  )
  return proxy
}

function row(id: string, userId: string) {
  return {
    id,
    user_id: userId,
    job_type: "generate-image",
    status: "completed",
    input_data: { prompt: "a sunset" },
    output_data: { imageUrl: `https://example.com/${id}.png` },
    completed_at: "2026-10-01T00:00:00Z",
    created_at: "2026-10-01T00:00:00Z",
    provider: "kie",
  }
}

const session = (scopes: string[]) => newSession({ userId: "caller", scopes: scopes as Scope[], clientName: "Claude" })

function setProfile(profile: Record<string, unknown> | null) {
  if (profile) process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

beforeEach(() => {
  vi.clearAllMocks()
  state.tables = []
  state.rows = [row("marked-public", OTHER)]
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    state.tables.push(table)
    return chain()
  }) as never)
  setProfile({ outputs: { allowPublic: false } })
})

afterEach(() => setProfile(null))

describe("browse_gallery on a deployment that does not allow public outputs", () => {
  it("scope public lists nothing, and reads no job", async () => {
    const server = buildServer()
    registerGallery({ server, session: session(["assets:read"]), fastify: Fastify() })

    const result = await callTool(server, "browse_gallery", { scope: "public", limit: 3 })

    expect((result as { structuredContent?: unknown }).structuredContent).toEqual({ items: [], nextCursor: null, totalCount: 0 })
    expect((result as { content: { text: string }[] }).content[0]!.text).toBe("(no items)")
    expect(state.tables).not.toContain("jobs")
  })

  it("scope mine still lists the caller's own library", async () => {
    state.rows = [row("mine", "caller")]
    const server = buildServer()
    registerGallery({ server, session: session(["assets:read"]), fastify: Fastify() })

    const result = await callTool(server, "browse_gallery", { scope: "mine", limit: 3 })

    const items = (result as { structuredContent?: { items?: { jobId: string }[] } }).structuredContent?.items ?? []
    expect(items.map((item) => item.jobId)).toEqual(["mine"])
    expect(state.tables).toContain("jobs")
  })

  it("with the switch on (the default), scope public lists as before", async () => {
    setProfile(null)
    const server = buildServer()
    registerGallery({ server, session: session(["assets:read"]), fastify: Fastify() })

    const result = await callTool(server, "browse_gallery", { scope: "public", limit: 3 })

    const items = (result as { structuredContent?: { items?: { jobId: string }[] } }).structuredContent?.items ?? []
    expect(items.map((item) => item.jobId)).toEqual(["marked-public"])
  })
})

describe("list_jobs on a deployment that does not allow public outputs", () => {
  it("scope public lists nothing, and reads no job", async () => {
    const server = buildServer()
    registerJobs({ server, session: session(["jobs:read"]), fastify: Fastify() })

    const result = await callTool(server, "list_jobs", { scope: "public", limit: 3 })

    const payload = JSON.parse((result as { content: { text: string }[] }).content[0]!.text) as unknown
    expect(payload).toEqual({ data: [], next_cursor: null })
    expect(state.tables).not.toContain("jobs")
  })

  it("with the switch on (the default), scope public lists as before", async () => {
    setProfile(null)
    const server = buildServer()
    registerJobs({ server, session: session(["jobs:read"]), fastify: Fastify() })

    const result = await callTool(server, "list_jobs", { scope: "public", limit: 3 })

    const payload = JSON.parse((result as { content: { text: string }[] }).content[0]!.text) as { data: Array<{ id: string }> }
    expect(payload.data.map((r) => r.id)).toEqual(["marked-public"])
  })
})
