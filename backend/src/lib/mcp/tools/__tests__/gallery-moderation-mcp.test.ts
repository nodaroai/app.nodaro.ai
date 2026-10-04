/**
 * The MCP public scopes are the gallery: browse_gallery and list_jobs take
 * the gallery's moderation, and never hand out another creator's id.
 * Neutral stand-in words on purpose: the real list is admin data, never code.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool } from "./_helpers.js"

const state = vi.hoisted(() => ({
  settings: { gallery_blocked_words: [] as unknown[], gallery_banned_users: [] as unknown[] },
  rows: [] as unknown[],
  calls: [] as Array<{ method: string; args: unknown[] }>,
}))

vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../app-settings.js", () => ({ getAppSettings: vi.fn(async () => state.settings), settingsReadFailed: () => false }))

const { registerGallery } = await import("../gallery.js")
const { registerJobs } = await import("../jobs.js")
const { supabase } = await import("../../../supabase.js")

const A = "00000000-0000-4000-8000-00000000000a"
const B = "00000000-0000-4000-8000-00000000000b"

function chain() {
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return (resolve: (value: unknown) => void) => resolve({ data: state.rows, count: state.rows.length, error: null })
        return (...args: unknown[]) => {
          state.calls.push({ method: String(prop), args })
          return proxy
        }
      },
    },
  )
  return proxy
}

function row(id: string, userId: string, prompt: string) {
  return {
    id,
    user_id: userId,
    job_type: "generate-image",
    status: "completed",
    input_data: { prompt },
    output_data: { imageUrl: `https://example.com/${id}.png` },
    completed_at: "2026-10-01T00:00:00Z",
    created_at: "2026-10-01T00:00:00Z",
    provider: "kie",
  }
}

const session = (scopes: string[]) => newSession({ userId: "caller", scopes: scopes as Scope[], clientName: "Claude" })

beforeEach(() => {
  vi.clearAllMocks()
  state.calls = []
  state.settings = {
    gallery_blocked_words: [{ word: "bucket", translations: [], exceptions: [] }],
    gallery_banned_users: [{ userId: A, addedAt: null }],
  }
  state.rows = [row("shown", B, "a sunset"), row("blocked-creator", A, "a sunset"), row("banned-word", B, "a bucket")]
  vi.mocked(supabase.from).mockImplementation((() => chain()) as never)
})

describe("browse_gallery scope=public", () => {
  it("shows only what the gallery shows, and leaves blocked creators out in the query", async () => {
    const server = buildServer()
    registerGallery({ server, session: session(["assets:read"]), fastify: Fastify() })
    const result = await callTool(server, "browse_gallery", { scope: "public", limit: 3 })

    const items = (result as { structuredContent?: { items?: { jobId: string }[] } }).structuredContent?.items ?? []
    expect(items.map((item) => item.jobId)).toEqual(["shown"])
    expect(state.calls.filter((c) => c.method === "filter" && c.args[0] === "user_id").map((c) => c.args)).toContainEqual(["user_id", "not.in", `(${A})`])
  })

  it("the caller's own library is untouched", async () => {
    const server = buildServer()
    registerGallery({ server, session: session(["assets:read"]), fastify: Fastify() })
    const result = await callTool(server, "browse_gallery", { scope: "mine", limit: 3 })

    const items = (result as { structuredContent?: { items?: { jobId: string }[] } }).structuredContent?.items ?? []
    expect(items.map((item) => item.jobId)).toEqual(["shown", "blocked-creator", "banned-word"])
    expect(state.calls.some((c) => c.method === "filter" && c.args[0] === "user_id")).toBe(false)
  })
})

describe("list_jobs scope=public", () => {
  it("shows only what the gallery shows, without anyone's user id", async () => {
    const server = buildServer()
    registerJobs({ server, session: session(["jobs:read"]), fastify: Fastify() })
    const result = await callTool(server, "list_jobs", { scope: "public", limit: 3 })

    const text = (result as { content: { text: string }[] }).content[0]!.text
    const payload = JSON.parse(text) as { data: Array<Record<string, unknown>> }
    expect(payload.data.map((r) => r.id)).toEqual(["shown"])
    expect(text).not.toContain(B)
    expect(state.calls.filter((c) => c.method === "filter" && c.args[0] === "user_id").map((c) => c.args)).toEqual([["user_id", "not.in", `(${A})`]])
  })
})
