import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"

import type { Scope } from "../../../scopes.js"
import { callTool, listTools } from "./_helpers.js"

/**
 * What MCP offers where studio productions are not served.
 *
 * There are two halves to that, and they fail differently:
 *
 *  1. **Off cloud the family is not registered at all.** The routes it
 *     dispatches to are a Nodaro Cloud feature, so the tools are gated on the
 *     EDITION — a listing that offered them would promise seventeen tools that
 *     could only ever 404.
 *  2. **On cloud, before the routes are installed, every tool answers
 *     `not_available`.** That is the rollout path: this family ships, the
 *     deployment picks up the routes afterwards, and in between the tools must
 *     say "not served here" rather than "invalid request". The router's own 404
 *     body carries no `error.code`, which is exactly what the family's error
 *     mapping keys on.
 *
 * Both directions are asserted from ONE builder, and an ungated tool (`ping`)
 * is checked in both states: an "absent when off" test alone passes just as
 * happily when the family stops registering entirely, or when the server fails
 * to build.
 *
 * The route half of the same gate lives in
 * `routes/__tests__/studio-productions-plugin-absent.test.ts`.
 */

const h = vi.hoisted(() => ({ credits: true }))

// tools/list never runs a tool body; this only guards a registration path that
// happens to touch the client.
vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))

// A FUNCTION, not a copied value: `server.ts` calls `hasCredits()` while it
// registers, so each case sets `h.credits` and builds, and one mock covers both.
vi.mock("../../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => h.credits }
})

const { buildMcpServer } = await import("../../server.js")
const { STUDIO_PRODUCTION_TOOL_NAMES } = await import("../_studio-helpers.js")

/** Every scope the family's gates ask for, and then some — so a missing tool is
 *  never explained by a missing grant. */
const ALL_GRANTED: Scope[] = [
  "workflows:read", "workflows:write", "workflows:execute", "jobs:read",
  "assets:read", "assets:write", "credits:read", "apps:read",
]

const FAMILY = [...STUDIO_PRODUCTION_TOOL_NAMES].sort()

const PRODUCTION = "00000000-0000-4000-8000-000000000020"

async function serverFor(credits: boolean) {
  h.credits = credits
  // A Fastify with no routes on it IS the deployment this file is about: every
  // dispatch lands on the router's unmatched-route handler.
  return buildMcpServer({
    userId: "u1",
    scopes: ALL_GRANTED,
    clientName: "Claude",
    fastify: Fastify(),
  })
}

describe("the studio production family is gated on the edition", () => {
  it("off cloud, not one of the seventeen is offered", async () => {
    const names = (await listTools(await serverFor(false))).map((t) => t.name)
    expect(names.filter((n) => FAMILY.includes(n as never))).toEqual([])
    // The catalog was built — the seventeen are absent because the gate held,
    // not because there was nothing to list.
    expect(names).toContain("ping")
  })

  it("on cloud, all seventeen are — the edition is the only thing between them", async () => {
    const names = (await listTools(await serverFor(true))).map((t) => t.name)
    expect(names.filter((n) => FAMILY.includes(n as never)).sort()).toEqual(FAMILY)
    expect(names).toContain("ping")
  })
})

describe("on cloud, with the routes not installed", () => {
  it("every tool answers `not_available` rather than a bad request", async () => {
    const server = await serverFor(true)
    const calls: Array<[string, Record<string, unknown>]> = [
      ["get_studio_production_skill", {}],
      ["validate_studio_plan", { plan: {} }],
      ["list_studio_productions", {}],
      ["get_studio_production", { production_id: PRODUCTION }],
      ["plan_studio_export", { production_id: PRODUCTION }],
      ["create_studio_production", {}],
      ["import_studio_production", { production_id: PRODUCTION, plan: {} }],
      ["edit_studio_production", { production_id: PRODUCTION, ops: [{ op: "example" }] }],
      ["share_studio_production", { production_id: PRODUCTION, shared: true }],
      ["clone_studio_production", { production_id: PRODUCTION }],
      ["describe_studio_production", { production_id: PRODUCTION, brief: "x", llm_model: "m" }],
      ["generate_studio_still", { production_id: PRODUCTION, shot_id: "s1" }],
      ["generate_studio_keyframe", { production_id: PRODUCTION, keyframe_id: "frame-A", expected_revision: 1 }],
      ["generate_studio_clip", { production_id: PRODUCTION, shot_id: "s1" }],
      ["new_studio_shot_from_frame", { production_id: PRODUCTION, shot_id: "s1" }],
      ["voice_studio_shot", { production_id: PRODUCTION, shot_id: "s1", text: "hello" }],
      ["revoice_studio_clip", { production_id: PRODUCTION, shot_id: "s1", plan: {} }],
      ["score_studio_production", { production_id: PRODUCTION, prompt: "strings" }],
    ]
    // Every registered tool, not a sample: a family member that forgot the
    // mapping would answer "invalid request" and send a model repairing a
    // document that was never the problem.
    expect(calls.map(([name]) => name).sort()).toEqual(FAMILY)

    for (const [name, args] of calls) {
      const res = await callTool(server, name, args)
      expect(res.isError, name).toBe(true)
      expect(res.content[0].text, name).toContain("not_available")
      expect(res.content[0].text, name).toContain("not served on this deployment")
    }
  })
})
