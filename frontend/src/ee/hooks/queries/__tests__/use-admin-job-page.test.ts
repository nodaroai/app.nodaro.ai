import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const enrich = vi.hoisted(() => vi.fn())

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer t" }) }))
vi.mock("../use-admin-queries", () => ({
  adminError: async (_res: Response, fallback: string) => new Error(fallback),
  enrichAdminJobRows: enrich,
}))

import { fetchAdminChildJobs, fetchAdminJobPage } from "../use-admin-job-page"

const ID = "0b1c2d3e-0000-4000-8000-000000000001"

type Row = { id: string }

// The enrichment maps a list row's fields and adds the account's address. Like the real one it
// drops every field it does not name, so what the job page keeps beside it is the page's own doing.
const enriched = (rows: readonly Row[]) => rows.map((r) => ({ id: r.id, user_email: "dana@x.test" }))

function answer(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })))
}

beforeEach(() => {
  enrich.mockImplementation(async (rows: readonly Row[]) => enriched(rows))
})

afterEach(() => vi.unstubAllGlobals())

describe("fetchAdminJobPage", () => {
  it("returns the job enriched, with its parent and child count", async () => {
    answer(200, { data: { id: ID, user_id: "u1", parent_job_id: "p1", child_count: 4 } })
    const out = await fetchAdminJobPage(ID)
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(`/v1/admin/jobs/${ID}`)
    expect(out).toEqual({ kind: "found", job: expect.objectContaining({ id: ID, user_email: "dana@x.test", parent_job_id: "p1", child_count: 4 }) })
  })

  it("reads an unknown child count as unknown", async () => {
    answer(200, { data: { id: ID, user_id: "u1", child_count: null } })
    const out = await fetchAdminJobPage(ID)
    expect(out.kind === "found" && out.job.child_count).toBeNull()
  })

  it("keeps the provider's own words about a failure; a job without any reads as none", async () => {
    answer(200, { data: { id: ID, user_id: "u1", status: "failed", error_detail: "Request blocked: restricted content." } })
    const failed = await fetchAdminJobPage(ID)
    expect(failed.kind === "found" && failed.job.error_detail).toBe("Request blocked: restricted content.")
    answer(200, { data: { id: ID, user_id: "u1", status: "completed" } })
    const fine = await fetchAdminJobPage(ID)
    expect(fine.kind === "found" && fine.job.error_detail).toBeNull()
  })

  it("an unknown or malformed id is no such job; any other failure throws", async () => {
    answer(404, { error: { code: "not_found" } })
    expect(await fetchAdminJobPage(ID)).toEqual({ kind: "missing" })
    answer(400, { error: { code: "validation_error" } })
    expect(await fetchAdminJobPage("nope")).toEqual({ kind: "missing" })
    answer(500, { error: { code: "internal_error" } })
    await expect(fetchAdminJobPage(ID)).rejects.toThrow("Failed to load the job")
  })
})

describe("fetchAdminChildJobs", () => {
  it("returns the steps in the server's flow order with their depth and parent", async () => {
    answer(200, { data: [{ id: "a", parent_job_id: ID, depth: 1 }, { id: "b", parent_job_id: "a", depth: 2 }], truncated: true })
    const out = await fetchAdminChildJobs(ID)
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(`/v1/admin/jobs/${ID}/children`)
    expect(out.truncated).toBe(true)
    expect(out.jobs.map((j) => [j.id, j.depth, j.parent_job_id, j.user_email])).toEqual([
      ["a", 1, ID, "dana@x.test"],
      ["b", 2, "a", "dana@x.test"],
    ])
  })

  it("each step keeps the provider's own words about its failure", async () => {
    answer(200, { data: [{ id: "a", parent_job_id: ID, depth: 1 }, { id: "b", parent_job_id: ID, depth: 1, error_detail: "Internal Error" }] })
    const out = await fetchAdminChildJobs(ID)
    expect(out.jobs.map((j) => [j.id, j.error_detail])).toEqual([["a", null], ["b", "Internal Error"]])
  })

  it("pairs each step with its own depth, parent and words by its id, whatever order the enrichment answers in", async () => {
    answer(200, {
      data: [
        { id: "a", parent_job_id: ID, depth: 1 },
        { id: "b", parent_job_id: "a", depth: 2, error_detail: "Internal Error" },
      ],
    })
    enrich.mockImplementation(async (rows: readonly Row[]) => [...enriched(rows)].reverse())
    const out = await fetchAdminChildJobs(ID)
    // The flow stays in the server's order, and nothing moves to another step.
    expect(out.jobs.map((j) => [j.id, j.depth, j.parent_job_id, j.error_detail])).toEqual([
      ["a", 1, ID, null],
      ["b", 2, "a", "Internal Error"],
    ])
  })

  it("throws when the steps cannot be read", async () => {
    answer(500, {})
    await expect(fetchAdminChildJobs(ID)).rejects.toThrow("Failed to load the child jobs")
  })
})
