import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"
import type { Scope } from "../../../scopes.js"
import { callTool, listTools } from "./_helpers.js"

/**
 * What MCP offers where the UGC builders are not served — the same two halves
 * as `studio-production-plugin-absent.test.ts`: off cloud the three tools are
 * not registered at all; on cloud, before the plugin's routes are installed,
 * each answers `not_available` rather than "invalid request". An ungated tool
 * (`ping`) is checked in both states so an empty catalog cannot pass.
 */
const h = vi.hoisted(() => ({ credits: true }))

vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => h.credits }
})

const { buildMcpServer } = await import("../../server.js")
const { UGC_TOOL_NAMES } = await import("../ugc.js")

const FAMILY = [...UGC_TOOL_NAMES].sort()

async function serverFor(credits: boolean, scopes: Scope[] = []) {
  h.credits = credits
  return buildMcpServer({ userId: "u1", scopes, clientName: "Claude", fastify: Fastify() })
}

describe("the UGC builders are gated on the edition, not on scopes", () => {
  it("off cloud, none of the three is offered", async () => {
    const names = (await listTools(await serverFor(false))).map((t) => t.name)
    expect(names.filter((n) => FAMILY.includes(n as never))).toEqual([])
    expect(names).toContain("ping")
  })
  it("on cloud, all three are — even with no scopes at all", async () => {
    const names = (await listTools(await serverFor(true))).map((t) => t.name)
    expect(names.filter((n) => FAMILY.includes(n as never)).sort()).toEqual(FAMILY)
    expect(names).toContain("ping")
  })
})

describe("on cloud, with the plugin's routes not installed", () => {
  it("every tool answers not_available", async () => {
    const server = await serverFor(true)
    const calls: Array<[string, Record<string, unknown>]> = [
      ["build_ugc_creator", { source: "sampled", gender: "woman", product_category: "saas" }],
      ["build_ugc_clips", { plan: {}, gender: "woman", identity_images: ["https://cdn.example/a.png"] }],
      ["build_ugc_cards", { plan: {}, alignment: [] }],
    ]
    expect(calls.map(([name]) => name).sort()).toEqual(FAMILY)
    for (const [name, args] of calls) {
      const res = await callTool(server, name, args)
      expect(res.isError, name).toBe(true)
      expect(res.content[0]!.text, name).toContain("not_available")
      expect(res.content[0]!.text, name).toContain("not served on this deployment")
    }
  })
})
