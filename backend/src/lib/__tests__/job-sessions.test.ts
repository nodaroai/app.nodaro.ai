/**
 * The sessions a page of jobs is in now (lib/job-sessions.ts) — `GET /v1/jobs`'s
 * `withSessions` and MCP `list_jobs`'s `with_sessions`: the owner's own LIVE
 * links only (a removed one is in the Trash, not "in" the session), each
 * job's sessions newest link first, and one read for the whole page.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { argOf, has, type QueryResult, type RecordedQuery } from "./fake-supabase-query.js"

const db = vi.hoisted(() => ({ log: [] as RecordedQuery[], answer: { data: [], error: null } as QueryResult }))
vi.mock("../supabase.js", async () => {
  const { makeFakeFrom } = await import("./fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log, () => db.answer) } }
})

import { liveSessionsOfJobs } from "../job-sessions.js"

const OWNER = "00000000-0000-4000-8000-000000000001"

beforeEach(() => {
  db.log.length = 0
  db.answer = { data: [], error: null }
})

describe("liveSessionsOfJobs", () => {
  it("reads the owner's live links of the page's jobs, once, newest first", async () => {
    await liveSessionsOfJobs(OWNER, ["j1", "j2", "j1"])
    expect(db.log).toHaveLength(1)
    const [q] = db.log
    expect(q!.table).toBe("session_items")
    expect(has(q!, "in", "job_id", ["j1", "j2"])).toBe(true)
    expect(has(q!, "eq", "user_id", OWNER)).toBe(true)
    expect(has(q!, "is", "removed_at", null)).toBe(true)
    expect(has(q!, "order", "added_at", { ascending: false })).toBe(true)
    // The item's own session (session_items has two keys to generation_sessions).
    expect(String(argOf(q!, "select")![0])).toContain("generation_sessions!session_id(")
  })

  it("maps each job to its sessions, in the order read; a job in none is absent", async () => {
    db.answer = {
      data: [
        { job_id: "j1", added_at: "2026-10-25", session: { id: "s2", title: "Beach", project_id: "p1" } },
        { job_id: "j1", added_at: "2026-10-24", session: [{ id: "s1", title: null, project_id: null }] },
        { job_id: "j2", added_at: "2026-10-23", session: null },
      ],
      error: null,
    }
    const { data } = await liveSessionsOfJobs(OWNER, ["j1", "j2", "j3"])
    expect(data.get("j1")).toEqual([
      { id: "s2", title: "Beach", projectId: "p1" },
      { id: "s1", title: null, projectId: null },
    ])
    expect(data.has("j2")).toBe(false)
    expect(data.has("j3")).toBe(false)
  })

  it("reads nothing for an empty page, and hands back a read error", async () => {
    expect((await liveSessionsOfJobs(OWNER, [])).data.size).toBe(0)
    expect(db.log).toHaveLength(0)
    db.answer = { data: null, error: { message: "down" } }
    expect((await liveSessionsOfJobs(OWNER, ["j1"])).error).toEqual({ message: "down" })
  })
})
