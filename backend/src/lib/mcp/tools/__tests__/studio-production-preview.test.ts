/**
 * The two arguments an in-app assistant needs from this family: a PREVIEW of a
 * change, and a read that does not land finished work.
 *
 * Both exist because the studio editor is a different kind of caller from an
 * outside client. The editor is open, polling and landing everything it
 * started, so a read that lands would double a take it already owns; and a
 * change it is going to show a person before writing has to be describable
 * without being written.
 *
 * The preview is FAIL-CLOSED, and that is what most of this file is about. The
 * ops route ignores keys it does not know, so a preview flag sent to a service
 * that predates it is simply APPLIED — the batch the flag was meant to prevent.
 * So the tool proves the capability first, with the empty batch the route has
 * always answered without writing: only an answer that carries the literal
 * earns the real batch. A service that answers the ping without it gets
 * nothing.
 *
 * Its own file rather than more cases in `studio-production.test.ts`: the ping
 * and the batch are two requests to ONE route that must answer them
 * differently, which the shared stub's fixed reply per route cannot express.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({
  supabase: {
    from: () => {
      throw new Error("a studio production tool must not read Supabase directly")
    },
  },
}))

const { registerStudioProductionTools } = await import("../studio-production.js")

const PRODUCTION = "00000000-0000-4000-8000-000000000020"
const OPS = [{ op: "example", target: "s1" }]

const h = vi.hoisted(() => ({
  /** What the ops route answers a body that carries the preview flag. */
  dryRunAnswer: null as unknown,
}))

interface Call {
  method: string
  url: string
  body?: Record<string, unknown>
}

function stub(): { fastify: FastifyInstance; calls: Call[] } {
  const fastify = Fastify()
  const calls: Call[] = []
  const capture = (req: { url: string; method: string; body?: unknown }): void => {
    calls.push({ method: req.method, url: req.url, body: req.body as Record<string, unknown> })
  }

  fastify.post("/v1/studio/productions/:id/ops", async (req) => {
    capture(req)
    const body = req.body as { dryRun?: unknown }
    if (body?.dryRun === true) return { data: h.dryRunAnswer }
    return { data: { production: { id: PRODUCTION }, version: 4, rebased: false, receipts: [], warnings: [] } }
  })
  fastify.post("/v1/studio/productions/:id/reconcile", async (req) => {
    capture(req)
    return { data: { production: { id: PRODUCTION, from: "reconcile" }, landed: [], pending: [] } }
  })
  fastify.get("/v1/studio/productions/:id", async (req) => {
    capture(req)
    return { data: { production: { id: PRODUCTION } } }
  })

  return { fastify, calls }
}

const ALL: Scope[] = ["workflows:read", "workflows:write", "workflows:execute"]

function serverWith(scopes: Scope[] = ALL) {
  const server = buildServer()
  const { fastify, calls } = stub()
  registerStudioProductionTools({
    server,
    session: newSession({ userId: "u1", scopes, clientName: "Claude" }),
    fastify,
  })
  return { server, calls }
}

/** The preview the route answers when it understands the flag. */
function preview(receipts: unknown[] = []): Record<string, unknown> {
  return { dryRun: true, version: 4, receipts, warnings: [] }
}

beforeEach(() => {
  h.dryRunAnswer = preview()
})

describe("edit_studio_production, asked for a preview", () => {
  it("proves the capability with the empty batch before it sends the real one", async () => {
    const { server, calls } = serverWith()
    const res = await callTool(server, "edit_studio_production", {
      production_id: PRODUCTION,
      ops: OPS,
      dry_run: true,
    })

    expect(calls).toHaveLength(2)
    // The ping: the batch the route has always answered without writing, and
    // never a version or a strict flag — a ping must not be able to conflict.
    expect(calls[0].body).toMatchObject({ ops: [], dryRun: true })
    expect(calls[0].body?.baseVersion).toBeUndefined()
    expect(calls[0].body?.strict).toBeUndefined()
    // Then the caller's own batch, under the same flag.
    expect(calls[1].body).toMatchObject({ ops: OPS, dryRun: true })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toMatchObject({ dryRun: true, version: 4 })
  })

  it("carries the caller's version and strict flag on the batch, never on the ping", async () => {
    const { server, calls } = serverWith()
    await callTool(server, "edit_studio_production", {
      production_id: PRODUCTION,
      ops: OPS,
      expected_version: 3,
      strict: true,
      dry_run: true,
    })
    expect(calls[0].body).not.toMatchObject({ baseVersion: 3 })
    expect(calls[1].body).toMatchObject({ baseVersion: 3, strict: true })
  })

  it("sends NOTHING when the ping comes back without the literal", async () => {
    // What every service older than the preview answers the ping: the empty
    // batch's ordinary reply. Read as a preview it would be a batch applied.
    h.dryRunAnswer = { production: { id: PRODUCTION }, version: 4, rebased: false, receipts: [], warnings: [] }
    const { server, calls } = serverWith()
    const res = await callTool(server, "edit_studio_production", {
      production_id: PRODUCTION,
      ops: OPS,
      dry_run: true,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ ops: [] })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("studio_preview_unavailable")
  })

  it("is one request and no flag at all when no preview was asked for", async () => {
    const { server, calls } = serverWith()
    const res = await callTool(server, "edit_studio_production", { production_id: PRODUCTION, ops: OPS })
    expect(calls).toHaveLength(1)
    expect(calls[0].body?.dryRun).toBeUndefined()
    expect(res.structuredContent).toMatchObject({ version: 4, rebased: false })
  })

  it("is one request and no flag when the preview is declined outright", async () => {
    const { server, calls } = serverWith()
    await callTool(server, "edit_studio_production", { production_id: PRODUCTION, ops: OPS, dry_run: false })
    expect(calls).toHaveLength(1)
    expect(calls[0].body?.dryRun).toBeUndefined()
  })
})

describe("get_studio_production, asked not to land", () => {
  it("skips the landing call entirely", async () => {
    const { server, calls } = serverWith()
    const res = await callTool(server, "get_studio_production", {
      production_id: PRODUCTION,
      reconcile: false,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe("GET")
    expect(res.structuredContent).toEqual({ production: { id: PRODUCTION } })
  })

  it("still lands by default, and when asked to", async () => {
    for (const args of [{}, { reconcile: true }]) {
      const { server, calls } = serverWith()
      await callTool(server, "get_studio_production", { production_id: PRODUCTION, ...args })
      expect(calls).toHaveLength(2)
      expect(calls[0].url).toBe(`/v1/studio/productions/${PRODUCTION}/reconcile`)
    }
  })
})
