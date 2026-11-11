/**
 * The MCP marketplace listings on a deployment that does not allow public
 * outputs (`outputs.allowPublic: false`): `list_apps` and `list_components` in
 * their public scope list other people's published work, so there they list
 * nothing — and read no app to find that out, in the shape `browse_gallery`
 * and `list_jobs` already answer the same case with. The caller's own apps and
 * components (scope "mine") are untouched, and with the switch on (the
 * default) the public scope lists as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool } from "./_helpers.js"
import { __resetSurfaceProfileCacheForTests } from "../../../surface-profile.js"

const state = vi.hoisted(() => ({ rows: [] as unknown[], tables: [] as string[], eqs: [] as Array<[string, unknown]> }))

vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))

const { registerApps } = await import("../apps.js")
const { registerComponents } = await import("../components.js")
const { supabase } = await import("../../../supabase.js")

const CALLER = "00000000-0000-4000-8000-00000000000a"
const OTHER = "00000000-0000-4000-8000-00000000000b"

/** Every builder call returns the chain (recording `.eq`); awaiting it answers the rows. */
function chain() {
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return (resolve: (value: unknown) => void) => resolve({ data: state.rows, error: null })
        if (prop === "eq") return (col: string, value: unknown) => { state.eqs.push([col, value]); return proxy }
        return () => proxy
      },
    },
  )
  return proxy
}

function listing(id: string, creatorId: string) {
  return {
    id,
    slug: id,
    name: `Listing ${id}`,
    description: "d",
    icon_url: null,
    estimated_credits: 10,
    category: null,
    output_types: ["image"],
    tags: [],
    total_run_count: 0,
    favorite_count: 0,
    created_at: "2026-10-01T00:00:00Z",
    creator_id: creatorId,
  }
}

const session = (scopes: string[]) => newSession({ userId: CALLER, scopes: scopes as Scope[], clientName: "Claude" })

function setProfile(profile: Record<string, unknown> | null) {
  if (profile) process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

const payloadOf = (result: unknown) => JSON.parse((result as { content: { text: string }[] }).content[0]!.text) as { data: Array<{ id: string }>; scope: string; next_cursor: string | null }

beforeEach(() => {
  vi.clearAllMocks()
  state.tables = []
  state.eqs = []
  state.rows = [listing("theirs", OTHER)]
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    state.tables.push(table)
    return chain()
  }) as never)
  setProfile({ outputs: { allowPublic: false } })
})

afterEach(() => setProfile(null))

const TOOLS = [
  { tool: "list_apps", scopes: ["apps:read"], register: registerApps },
  { tool: "list_components", scopes: ["workflows:read"], register: registerComponents },
] as const

describe.each(TOOLS)("$tool on a deployment that does not allow public outputs", ({ tool, scopes, register }) => {
  it.each([
    ["scope public", { scope: "public" }],
    ["no scope (the public default)", {}],
  ])("%s lists nothing, and reads no app", async (_label, args) => {
    const server = buildServer()
    register({ server, session: session([...scopes]), fastify: Fastify() })

    const result = await callTool(server, tool, { ...args, limit: 5 })

    expect((result as { isError?: boolean }).isError).toBeFalsy()
    expect(payloadOf(result)).toEqual({ data: [], scope: "public", next_cursor: null })
    expect(state.tables).not.toContain("published_apps")
  })

  it("scope mine still lists the caller's own", async () => {
    state.rows = [listing("mine", CALLER)]
    const server = buildServer()
    register({ server, session: session([...scopes]), fastify: Fastify() })

    const result = await callTool(server, tool, { scope: "mine", limit: 5 })

    expect(payloadOf(result).data.map((row) => row.id)).toEqual(["mine"])
    expect(state.tables).toContain("published_apps")
    expect(state.eqs).toContainEqual(["creator_id", CALLER])
  })
})

describe.each(TOOLS)("$tool with public outputs allowed", ({ tool, scopes, register }) => {
  it.each([
    ["no profile (the default)", null],
    ["a profile that allows public outputs", { outputs: { allowPublic: true } }],
  ])("%s: scope public lists the marketplace as before", async (_label, profile) => {
    setProfile(profile)
    const server = buildServer()
    register({ server, session: session([...scopes]), fastify: Fastify() })

    const result = await callTool(server, tool, { scope: "public", limit: 5 })

    const payload = payloadOf(result)
    expect(payload.scope).toBe("public")
    expect(payload.next_cursor).toBeNull()
    expect(payload.data.map((row) => row.id)).toEqual(["theirs"])
    expect(state.eqs).toContainEqual(["is_listed", true])
  })
})
