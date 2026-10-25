/**
 * The session filters of the job listing (lib/job-list-filters.ts, migration
 * 561): `projectId` (a project, or `none`) and `inSession` read the job's LIVE
 * links through an embed of `session_items`, like the favorites / ratings
 * filters; every listing leaves the Trash out. The embed shapes and filters
 * here were run against PostgREST v12.2.12 (the PR records the probe).
 */
import { describe, it, expect } from "vitest"
import { applyJobListFilters, jobListFilterSelect, parseJobListQuery, withoutFilterEmbeds } from "../job-list-filters.js"

function recorder() {
  const calls: Array<[string, ...unknown[]]> = []
  const q = {
    eq: (c: string, v: string) => (calls.push(["eq", c, v]), q),
    in: (c: string, v: readonly string[]) => (calls.push(["in", c, [...v]]), q),
    is: (c: string, v: null) => (calls.push(["is", c, v]), q),
    filter: (c: string, op: string, v: string) => (calls.push(["filter", c, op, v]), q),
  }
  return { q, calls }
}

const OWNER = "00000000-0000-4000-8000-0000000000aa"
const PROJECT = "00000000-0000-4000-8000-0000000000bb"

describe("parseJobListQuery — where the job is", () => {
  it("takes a project id (lower-cased), none, and inSession", () => {
    const p = parseJobListQuery({ projectId: PROJECT.toUpperCase(), inSession: "true" })
    expect(p.success && p.data).toEqual({ projectId: PROJECT, inSession: true })
    const none = parseJobListQuery({ projectId: "none" })
    expect(none.success && none.data).toEqual({ projectId: "none" })
    const general = parseJobListQuery({ inSession: "false" })
    expect(general.success && general.data).toEqual({ inSession: false })
  })

  it("refuses a project that is not a uuid, an inSession that is not a boolean, and a project with inSession=false", () => {
    expect(parseJobListQuery({ projectId: "all" }).success).toBe(false)
    expect(parseJobListQuery({ inSession: "yes" }).success).toBe(false)
    expect(parseJobListQuery({ projectId: PROJECT, inSession: "false" }).success).toBe(false)
  })
})

describe("every listing leaves the Trash and child jobs out", () => {
  it("with no filter at all", () => {
    const { q, calls } = recorder()
    applyJobListFilters(q, {}, OWNER)
    expect(calls).toEqual([["is", "parent_job_id", null], ["is", "deleted_at", null]])
  })
})

describe("the session embeds", () => {
  it("a project joins the job's live links and their session's project, each job once", () => {
    expect(jobListFilterSelect({ projectId: PROJECT })).toBe(
      ", live_link:session_items!session_items_job_id_fkey!inner(session_id, live_session:generation_sessions!session_items_session_id_fkey!inner(project_id))",
    )
    const { q, calls } = recorder()
    applyJobListFilters(q, { projectId: PROJECT }, OWNER)
    expect(calls).toContainEqual(["is", "live_link.removed_at", null])
    expect(calls).toContainEqual(["eq", "live_link.live_session.project_id", PROJECT])
    expect(calls.some((c) => c[0] === "is" && c[1] === "live_link")).toBe(false)
  })

  it("none is a session with no project", () => {
    const { q, calls } = recorder()
    applyJobListFilters(q, { projectId: "none" }, OWNER)
    expect(calls).toContainEqual(["is", "live_link.live_session.project_id", null])
    expect(calls).toContainEqual(["is", "live_link.removed_at", null])
  })

  it("inSession=true is any live link; inSession=false is no live link at all (the anti-join)", () => {
    expect(jobListFilterSelect({ inSession: true })).toBe(", live_link:session_items!session_items_job_id_fkey!inner(session_id)")
    expect(jobListFilterSelect({ inSession: false })).toBe(", live_link:session_items!session_items_job_id_fkey(session_id)")
    const general = recorder()
    applyJobListFilters(general.q, { inSession: false }, OWNER)
    expect(general.calls).toContainEqual(["is", "live_link.removed_at", null])
    expect(general.calls).toContainEqual(["is", "live_link", null])
    const inside = recorder()
    applyJobListFilters(inside.q, { inSession: true }, OWNER)
    expect(inside.calls).toContainEqual(["is", "live_link.removed_at", null])
    expect(inside.calls.some((c) => c[0] === "is" && c[1] === "live_link")).toBe(false)
  })

  it("the embed is a filtering detail, never output", () => {
    expect(withoutFilterEmbeds({ id: "j", live_link: [{ session_id: "s" }] })).toEqual({ id: "j" })
  })
})
