/**
 * The MCP reads of a job by its id — `get_asset`, `display_asset` and the
 * `list_favorites` hydration — read the caller's own job or anyone's public
 * completed one. On a deployment that does not allow public outputs
 * (`outputs.allowPublic: false`) no job is public to anyone but its owner, so
 * they ask for the caller's own only (`lib/public-job-read.ts`): a job marked
 * public before the switch was set reads as one that does not exist. With the
 * switch on, every query is what it was.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool } from "./_helpers.js"
import { __resetSurfaceProfileCacheForTests } from "../../../surface-profile.js"

const state = vi.hoisted(() => ({ ors: [] as Array<{ table: string; filter: string }>, rows: new Map<string, unknown>() }))

vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../app-settings.js", () => ({
  getAppSettings: vi.fn(async () => ({ gallery_blocked_words: [], gallery_banned_users: [] })),
  settingsReadFailed: () => false,
}))

const { registerGallery } = await import("../gallery.js")
const { supabase } = await import("../../../supabase.js")

const CALLER = "00000000-0000-4000-8000-00000000000a"
const JOB = "00000000-0000-4000-8000-0000000000aa"

function chain(table: string) {
  const rows = state.rows.get(table) ?? null
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return (resolve: (value: unknown) => void) => resolve({ data: rows, error: null })
        if (prop === "maybeSingle" || prop === "single") return async () => ({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null })
        if (prop === "or") return (filter: string) => { state.ors.push({ table, filter }); return proxy }
        return () => proxy
      },
    },
  )
  return proxy
}

function setProfile(profile: Record<string, unknown> | null) {
  if (profile) process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

const session = () => newSession({ userId: CALLER, scopes: ["assets:read"] as Scope[], clientName: "Claude" })

beforeEach(() => {
  vi.clearAllMocks()
  state.ors = []
  state.rows = new Map<string, unknown>([
    ["gallery_favorites", [{ job_id: JOB, created_at: "2026-10-01T00:00:00Z" }]],
    ["jobs", null],
  ])
  vi.mocked(supabase.from).mockImplementation(((table: string) => chain(table)) as never)
})

afterEach(() => setProfile(null))

const CALLS = [
  ["get_asset", { job_id: JOB }],
  ["display_asset", { job_id: JOB }],
  ["list_favorites", {}],
] as const

const jobFilters = () => state.ors.filter((o) => o.table === "jobs").map((o) => o.filter)

describe("with outputs.allowPublic false", () => {
  it.each(CALLS)("%s reads the caller's own jobs only", async (tool, args) => {
    setProfile({ outputs: { allowPublic: false } })
    const server = buildServer()
    registerGallery({ server, session: session(), fastify: Fastify() })

    await callTool(server, tool, args)

    expect(jobFilters()).toEqual([`user_id.eq.${CALLER}`])
  })
})

describe.each([
  ["no profile (the default)", null],
  ["a profile that allows public outputs", { outputs: { allowPublic: true } }],
])("with public outputs allowed: %s", (_label, profile) => {
  it.each(CALLS)("%s reads the caller's own job or any public completed one, as before", async (tool, args) => {
    setProfile(profile)
    const server = buildServer()
    registerGallery({ server, session: session(), fastify: Fastify() })

    await callTool(server, tool, args)

    expect(jobFilters()).toEqual([`user_id.eq.${CALLER},and(is_public.eq.true,status.eq.completed)`])
  })
})
