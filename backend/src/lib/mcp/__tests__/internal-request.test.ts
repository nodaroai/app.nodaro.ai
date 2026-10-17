// @test-watches backend/src/lib/mcp/tools/*.ts
import { describe, expect, it, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...actual, config: { ...actual.config, INTERNAL_ORCHESTRATOR_SECRET: "test-secret" } }
})

import { mcpInject } from "@/lib/mcp/internal-request.js"
import type { McpSession } from "@/lib/mcp/session.js"

const USER = "00000000-0000-4000-8000-000000000001"
const WS = "20000000-0000-4000-8000-000000000001"

function session(workspaceId?: string): McpSession {
  return { userId: USER, scopes: [], clientName: "test", workspaceId, firstParty: false }
}

/** Records what would have been injected, without a real Fastify instance. */
function recorder() {
  const calls: Array<Record<string, unknown>> = []
  return {
    calls,
    fastify: {
      inject: (opts: Record<string, unknown>) => {
        calls.push(opts)
        return Promise.resolve({ statusCode: 200, body: "{}" })
      },
    } as never,
  }
}

describe("mcpInject", () => {
  it("sends the workspace the session is working in", async () => {
    const r = recorder()
    await mcpInject(r.fastify, session(WS), { method: "POST", url: "/v1/thing", payload: { a: 1 } })
    const headers = r.calls[0].headers as Record<string, string>
    expect(headers["x-nodaro-workspace"]).toBe(WS)
    expect(headers["x-internal-orchestrator-secret"]).toBe("test-secret")
    expect(r.calls[0]).toMatchObject({ method: "POST", url: "/v1/thing", payload: { a: 1 } })
  })

  it("sends NO workspace header when the session is in the personal space", async () => {
    // Absent, not empty: an empty header is not a selection, and the request
    // context seam reads a blank one as "no selection" only by accident.
    const r = recorder()
    await mcpInject(r.fastify, session(undefined), { method: "GET", url: "/v1/thing" })
    expect(r.calls[0].headers).not.toHaveProperty("x-nodaro-workspace")
  })

  it("merges a route's own headers but does not let them override the three it owns", async () => {
    const r = recorder()
    await mcpInject(r.fastify, session(WS), {
      method: "POST",
      url: "/v1/thing",
      headers: {
        "x-internal-user-id": "00000000-0000-4000-8000-000000000999",
        "x-internal-orchestrator-secret": "forged",
        "x-nodaro-workspace": "20000000-0000-4000-8000-000000000009",
        "x-route-own": "kept",
      },
    })
    const headers = r.calls[0].headers as Record<string, string>
    expect(headers["x-internal-user-id"]).toBe(USER)
    expect(headers["x-internal-orchestrator-secret"]).toBe("test-secret")
    expect(headers["x-nodaro-workspace"]).toBe(WS)
    expect(headers["x-route-own"]).toBe("kept")
  })

  it("names the session's user on every request, a POST that passed no header included (#1888)", async () => {
    // The rate limiter keys an internal request on this header; without it
    // every MCP user on an instance shared one bucket (the loopback address).
    for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE"] as const) {
      const r = recorder()
      await mcpInject(r.fastify, session(), { method, url: "/v1/thing", payload: method === "GET" ? undefined : { a: 1 } })
      expect((r.calls[0].headers as Record<string, string>)["x-internal-user-id"], method).toBe(USER)
    }
  })

  it("omits payload and query rather than sending them undefined", async () => {
    const r = recorder()
    await mcpInject(r.fastify, session(), { method: "GET", url: "/v1/thing" })
    expect(r.calls[0]).not.toHaveProperty("payload")
    expect(r.calls[0]).not.toHaveProperty("query")
  })
})

/**
 * The choke point only holds if it is the ONLY door.
 *
 * A browser sends the workspace from one place (`frontend/src/lib/api.ts`), so
 * the switcher and the server agree by construction. This is the same
 * guarantee for MCP: a tool that called `fastify.inject` directly would carry
 * the secret but not the workspace, and the failure would be silent — work
 * landing outside the workspace the client was told it was working in, with
 * nothing erroring. That is the tenancy axis' worst failure mode, and it is
 * exactly the "remember to update the list" pattern this codebase has been
 * bitten by repeatedly.
 *
 * Source-text, not behavioural, on purpose: the point is that no such call
 * EXISTS, which no amount of exercising the tools could establish.
 */
describe("every MCP tool reaches a route through the choke point", () => {
  const TOOLS_DIR = join(__dirname, "..", "tools")

  it("has no direct .inject( call in tools/", () => {
    const offenders: string[] = []
    for (const file of readdirSync(TOOLS_DIR).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(TOOLS_DIR, file), "utf8")
      src.split("\n").forEach((line, i) => {
        // Prose may name the pattern it replaced; only CODE is guarded.
        const trimmed = line.trim()
        if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) return
        if (/(^|[^a-zA-Z0-9_])inject\s*\(/.test(line) && !line.includes("mcpInject")) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(
      offenders,
      "call mcpInject(fastify, session, {...}) instead — it carries the session's workspace, which a hand-built headers block silently will not",
    ).toEqual([])
  })

  it("finds the tools directory it is guarding", () => {
    // A guard that silently scans nothing passes forever.
    const files = readdirSync(TOOLS_DIR).filter((f) => f.endsWith(".ts"))
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((f) => readFileSync(join(TOOLS_DIR, f), "utf8").includes("mcpInject"))).toBe(true)
  })
})

describe("mcpInject refuses a path that would leave the route it names", () => {
  // The injected request carries the internal secret, so the route sees no app
  // authorization and its scope check is a no-op: a tool that pasted an
  // argument into a path could otherwise be steered at ANY route
  // (`/v1/moodboards/../api-tokens`). light-my-request normalizes the URL the
  // way a browser does, so dot segments, their encoded forms, an encoded slash
  // and a backslash are all refused before anything is injected.
  it.each([
    "/v1/moodboards/../api-tokens",
    "/v1/moodboards/./x",
    "/v1/palettes/..",
    "/v1/moodboards/%2e%2e/api-tokens",
    "/v1/moodboards/%2E%2E/api-tokens",
    "/v1/moodboards/.%2e/api-tokens",
    "/v1/moodboards/%2e/x",
    "/v1/moodboards/a%2fb",
    "/v1/moodboards/a%2F..%2Fapi-tokens",
    "/v1/moodboards/a%5c..",
    "/v1/moodboards/..\\api-tokens",
    "/v1/moodboards/%zz",
  ])("refuses %s, injecting nothing", async (url) => {
    const r = recorder()
    await expect(mcpInject(r.fastify, session(), { method: "GET", url })).rejects.toThrow(/path/i)
    expect(r.calls).toHaveLength(0)
  })

  it.each([
    "/v1/moodboards/0f9e8d7c-6b5a-4c3d-9e2f-1a2b3c4d5e6f",
    "/v1/jobs/abc?cursor=../x",
    "/v1/files/a.b.png",
    "/v1/thing/...",
  ])("passes %s through unchanged", async (url) => {
    const r = recorder()
    await mcpInject(r.fastify, session(), { method: "GET", url })
    expect(r.calls[0].url).toBe(url)
  })
})
