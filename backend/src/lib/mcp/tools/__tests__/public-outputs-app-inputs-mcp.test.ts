/**
 * MCP `get_app_inputs` and `get_component_inputs` on a deployment that does
 * not allow public outputs (`outputs.allowPublic: false`, decided 2026-11-11):
 * another person's app or component is its creator's alone, so the caller gets
 * the not-found answer an unknown slug gets, listed or not; the caller's own is
 * unchanged. `run_app`, `retry_app_run` and `run_component` meet the same rule
 * in the routes they call (POST /v1/app/:slug/run, …/resume,
 * POST /v1/component/execute — tested there). With public outputs allowed,
 * nothing changes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool } from "./_helpers.js"
import { __resetSurfaceProfileCacheForTests } from "../../../surface-profile.js"

const state = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }))

vi.mock("../../../supabase.js", () => {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "limit", "order"]) chain[m] = () => chain
  chain.single = async () => (state.row ? { data: state.row, error: null } : { data: null, error: { code: "PGRST116" } })
  return { supabase: { from: () => chain } }
})

const { registerApps } = await import("../apps.js")
const { registerComponents } = await import("../components.js")

const CALLER = "00000000-0000-4000-8000-00000000000a"
const OTHER = "00000000-0000-4000-8000-00000000000b"

function row(creatorId: string, publishType: "app" | "component") {
  return {
    id: "app-1",
    slug: "zebrify",
    name: "Zebrify",
    description: "d",
    is_listed: true,
    is_active: true,
    creator_id: creatorId,
    publish_type: publishType,
    snapshot_settings: {},
    snapshot_nodes: [],
    component_metadata: { inputs: [], outputs: [], exposedSettings: [] },
  }
}

function setProfile(profile: Record<string, unknown> | null) {
  if (profile) process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

const TOOLS = [
  { tool: "get_app_inputs", args: { slug: "zebrify" }, scopes: ["apps:read"], register: registerApps, kind: "app" as const, notFound: 'App "zebrify" not found.' },
  { tool: "get_component_inputs", args: { component_id: "zebrify" }, scopes: ["workflows:read"], register: registerComponents, kind: "component" as const, notFound: 'Component "zebrify" not found.' },
]

const textOf = (result: unknown) => (result as { content: { text: string }[] }).content[0]!.text

async function call(t: (typeof TOOLS)[number]) {
  const server = buildServer()
  t.register({ server, session: newSession({ userId: CALLER, scopes: t.scopes as Scope[], clientName: "Claude" }), fastify: Fastify() })
  return callTool(server, t.tool, t.args)
}

beforeEach(() => setProfile({ outputs: { allowPublic: false } }))
afterEach(() => setProfile(null))

describe.each(TOOLS)("$tool with outputs.allowPublic false", (t) => {
  it("another person's listed one answers as an unknown slug does", async () => {
    state.row = null
    const unknown = await call(t)
    state.row = row(OTHER, t.kind)
    const result = await call(t)
    expect((result as { isError?: boolean }).isError).toBe(true)
    expect(textOf(result)).toBe(t.notFound)
    expect(textOf(result)).toBe(textOf(unknown))
  })

  it("the caller's own is unchanged", async () => {
    state.row = row(CALLER, t.kind)
    const result = await call(t)
    expect((result as { isError?: boolean }).isError).toBeFalsy()
    expect(JSON.parse(textOf(result))).toMatchObject({ slug: "zebrify", name: "Zebrify" })
  })
})

describe.each(TOOLS)("$tool with public outputs allowed", (t) => {
  it.each([
    ["no profile (the default)", null],
    ["a profile that allows public outputs", { outputs: { allowPublic: true } }],
  ])("%s: another person's listed one, and the caller's own, are read as before", async (_label, profile) => {
    setProfile(profile)
    for (const creator of [OTHER, CALLER]) {
      state.row = row(creator, t.kind)
      const result = await call(t)
      expect((result as { isError?: boolean }).isError).toBeFalsy()
      expect(JSON.parse(textOf(result))).toMatchObject({ slug: "zebrify" })
    }
  })
})
