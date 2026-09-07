import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"

import type { Scope } from "../../../scopes.js"
import { listTools } from "./_helpers.js"

/**
 * The DEFAULT surface — what a deployment that has not turned the studio
 * production API on actually offers over MCP.
 *
 * `STUDIO_PRODUCTIONS_API` ships OFF (D11), and the whole suite runs with it
 * forced ON (`test/setup.ts`) so the family gets covered at all. That leaves
 * the shipped default pinned nowhere: every existing suite registers the family
 * directly or reads it through a snapshot taken with the flag on, so the day
 * the gate stopped gating, nothing would say so.
 *
 * Both directions are asserted from ONE builder. An "absent when off" test
 * alone passes just as happily when the family stops registering entirely, or
 * when the server fails to build — so the same six names are demanded back when
 * the flag flips, and an ungated tool (`ping`) is checked in both states to
 * prove the catalog itself was built either way.
 *
 * The route half of the same gate lives in
 * `routes/__tests__/studio-productions-flag-off.test.ts`.
 */

const h = vi.hoisted(() => ({ flag: true }))

// tools/list never runs a tool body; this only guards a registration path that
// happens to touch the client.
vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))

// A GETTER, not a copied value: `server.ts` reads the flag when the server is
// BUILT, so each case sets `h.flag` and builds, and one mock covers both.
vi.mock("../../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as typeof import("../../../config.js")
  return {
    ...orig,
    config: {
      ...orig.config,
      get STUDIO_PRODUCTIONS_API() {
        return h.flag
      },
    },
  }
})

const { buildMcpServer } = await import("../../server.js")

/** Every scope the family's gates ask for, and then some — so a missing tool is
 *  never explained by a missing grant. */
const ALL_GRANTED: Scope[] = [
  "workflows:read", "workflows:write", "workflows:execute", "jobs:read",
  "assets:read", "assets:write", "credits:read", "apps:read",
]

/** The six of Phase 0, named here because this is what the flag is FOR. */
const FAMILY = [
  "create_studio_production",
  "get_studio_production",
  "get_studio_production_skill",
  "import_studio_production",
  "list_studio_productions",
  "validate_studio_plan",
]

async function toolNames(flagOn: boolean): Promise<string[]> {
  h.flag = flagOn
  const server = await buildMcpServer({
    userId: "u1",
    scopes: ALL_GRANTED,
    clientName: "Claude",
    fastify: Fastify(),
  })
  return (await listTools(server)).map((t) => t.name)
}

describe("the studio production family is behind STUDIO_PRODUCTIONS_API", () => {
  it("with the flag OFF, not one of the six is offered", async () => {
    const names = await toolNames(false)
    expect(names.filter((n) => FAMILY.includes(n))).toEqual([])
    // The catalog was built — the six are absent because the gate held, not
    // because there was nothing to list.
    expect(names).toContain("ping")
  })

  it("with the flag ON, all six are — the gate is the only thing between them", async () => {
    const names = await toolNames(true)
    expect(names.filter((n) => FAMILY.includes(n)).sort()).toEqual(FAMILY)
    expect(names).toContain("ping")
  })
})
