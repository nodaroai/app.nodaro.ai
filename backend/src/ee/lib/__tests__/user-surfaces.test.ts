// @test-watches supabase/migrations/607_user_surfaces.sql
/**
 * The durable sibling of the presence notes: which surfaces each account has
 * used, written through migration 607's function once an hour per user and
 * surface — so an extension sign-in that never ran a job still leaves a row.
 * Reads the migration itself (the source list), hence the watch above.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import type { FastifyRequest } from "fastify"
import { JOB_SOURCES } from "../../../lib/job-source.js"
import { createPresenceRecorder, type PresenceEntry } from "../presence.js"
import { USER_SURFACE_RETRY_AFTER_MS, USER_SURFACE_WRITE_EVERY_MS, createUserSurfaceStore } from "../user-surfaces.js"

const USER = "00000000-0000-4000-8000-0000000000aa"
const EXTENSION = "extension/ext.nodaro.ai@0.2.6"

function entry(over: Partial<PresenceEntry> = {}): PresenceEntry {
  return { userId: USER, source: "extension", detail: EXTENSION, address: null, country: null, userAgent: null, lastSeenAt: 1_000, ...over }
}

/** A signed-in GET from the extension's service worker: no Origin, the client header. */
function request(headers: Record<string, string> = {}): FastifyRequest {
  return {
    userId: USER,
    isInternalCall: false,
    headers: { origin: "", "x-nodaro-client": EXTENSION, "user-agent": "Mozilla/5.0 Chrome/141", ...headers },
    socket: { remoteAddress: "203.0.113.7" },
  } as unknown as FastifyRequest
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("createUserSurfaceStore", () => {
  it("touches the account's row for the surface through the migration's function", async () => {
    const rpc = vi.fn(async () => ({ error: null }))
    await createUserSurfaceStore({ rpc }).put(entry())
    expect(rpc).toHaveBeenCalledWith("touch_user_surface", { p_user_id: USER, p_source: "extension", p_detail: EXTENSION })
  })

  it("a surface with nothing more to say is the empty detail, part of the row's key", async () => {
    const rpc = vi.fn(async () => ({ error: null }))
    await createUserSurfaceStore({ rpc }).put(entry({ source: "api", detail: null }))
    expect(rpc).toHaveBeenCalledWith("touch_user_surface", expect.objectContaining({ p_source: "api", p_detail: "" }))
  })

  it("a refused write is an error, for the recorder to report once", async () => {
    const rpc = vi.fn(async () => ({ error: { message: "relation does not exist" } }))
    await expect(createUserSurfaceStore({ rpc }).put(entry())).rejects.toThrow("relation does not exist")
  })
})

describe("the recorder over the store", () => {
  it("an extension sign-in that runs nothing still leaves its row, once an hour", async () => {
    let now = 0
    const rpc = vi.fn(async () => ({ error: null }))
    const record = createPresenceRecorder(() => Promise.resolve(createUserSurfaceStore({ rpc })), {
      writeEveryMs: USER_SURFACE_WRITE_EVERY_MS,
      now: () => now,
      log: () => {},
    })
    record(request(), 200)
    now = 30 * 60_000
    record(request(), 200)
    await settle()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith("touch_user_surface", expect.objectContaining({ p_source: "extension", p_detail: EXTENSION }))
    now = 61 * 60_000
    record(request(), 200)
    await settle()
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it("says which recorder it is when the database refuses", async () => {
    const log = vi.fn()
    const rpc = vi.fn(async () => ({ error: { message: "boom" } }))
    const record = createPresenceRecorder(() => Promise.resolve(createUserSurfaceStore({ rpc })), { label: "user-surfaces", log })
    record(request(), 200)
    await settle()
    expect(log).toHaveBeenCalledWith("[user-surfaces] could not note a signed-in visit: boom")
  })

  it("a lasting database error is tried again a minute later, not on every request", async () => {
    let now = 0
    const rpc = vi.fn(async () => ({ error: { message: "function touch_user_surface does not exist" } }))
    const record = createPresenceRecorder(() => Promise.resolve(createUserSurfaceStore({ rpc })), {
      writeEveryMs: USER_SURFACE_WRITE_EVERY_MS,
      retryAfterMs: USER_SURFACE_RETRY_AFTER_MS,
      now: () => now,
      log: () => {},
    })
    record(request(), 200)
    await settle()
    now = 30_000
    record(request(), 200)
    await settle()
    expect(rpc).toHaveBeenCalledTimes(1)
    now = 61_000
    record(request(), 200)
    await settle()
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})

describe("the migration", () => {
  it("accepts exactly the sources the code can name, less the orchestrator's own hop", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../../../../supabase/migrations/607_user_surfaces.sql", import.meta.url)), "utf8")
    const list = /CHECK \(source IN \(([^)]*)\)\)/.exec(sql)?.[1] ?? ""
    const accepted = list.split(",").map((s) => s.trim().replace(/^'|'$/g, "")).sort()
    expect(accepted).toEqual([...JOB_SOURCES].filter((s) => s !== "internal").sort())
  })
})
