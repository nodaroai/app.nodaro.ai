/**
 * A use-case node's hidden run is shown only through the node that started it
 * (its wrapper job): `GET /v1/jobs` leaves out that run's inner jobs, as it
 * leaves out a component's.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "community" },
  isCloud: () => false,
  hasCredits: () => false,
  isCommunity: () => true,
  isBusiness: () => false,
  hasAdmin: () => false,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/workflow-delete.js", () => ({ deleteJobWithPrivateMedia: vi.fn() }))
// The owner's favorite/rating reads have their own tests (jobs-favorites-ratings).
vi.mock("@/lib/job-owner-state.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/job-owner-state.js")>()),
  jobOwnerStateFor: async () => new Map(),
}))

import { jobRoutes } from "../jobs.js"
import { supabase } from "../../lib/supabase.js"

const USER = "00000000-0000-4000-8000-000000000001"

let app: FastifyInstance
let rows: Array<Record<string, unknown>>
let calls: Array<{ method: string; args: unknown[] }>

function job(id: string, execution: Record<string, unknown> | null) {
  return {
    id,
    status: "completed",
    progress: 100,
    input_data: { type: "transcribe" },
    output_data: {},
    error_message: null,
    created_at: `2026-10-13T00:00:0${id.length % 10}Z`,
    started_at: null,
    completed_at: null,
    user_id: USER,
    credits: 1,
    job_type: "transcribe",
    workflow_execution_id: execution ? `exec-${id}` : null,
    workflow_executions: execution,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  rows = []
  calls = []
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table !== "jobs") throw new Error(`Unexpected table "${table}"`)
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: rows, error: null })
        return (...args: unknown[]) => {
          calls.push({ method: String(prop), args })
          return proxy
        }
      },
    }
    const proxy: Record<string, unknown> = new Proxy({}, handler)
    return proxy as never
  })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
  })
  await app.register(async (instance) => {
    await jobRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("GET /v1/jobs — a use-case node's hidden run", () => {
  it("leaves out the inner jobs of a use-case run, as it does a component's", async () => {
    rows.push(
      job("j-inner", { is_component_execution: false, trigger_type: "use_case" }),
      job("j-own", { is_component_execution: false, trigger_type: "manual" }),
      job("j-comp", { is_component_execution: true, trigger_type: "app_run" }),
      job("j-loose", null),
    )
    const res = await app.inject({ method: "GET", url: "/v1/jobs?limit=10" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.map((j: { id: string }) => j.id)).toEqual(["j-own", "j-loose"])
  })

  it("reads a one-element array embed the same as an object", async () => {
    rows.push(job("j-inner", [{ is_component_execution: false, trigger_type: "use_case" }] as never))
    const res = await app.inject({ method: "GET", url: "/v1/jobs?limit=10" })
    expect(res.json().data).toEqual([])
  })

  it("embeds the execution's trigger type for the filter", async () => {
    await app.inject({ method: "GET", url: "/v1/jobs?limit=10" })
    const select = calls.find((c) => c.method === "select")
    expect(String(select?.args[0])).toContain("workflow_executions!workflow_execution_id(is_component_execution, trigger_type)")
  })
})

/**
 * A child job (`parent_job_id` set: a step a worker-side handler ran for its
 * parent) is shown only through that parent. The filter is in the query, so
 * the keyset cursor stays correct; the mocked builder returns every row, so
 * what is asserted is the query call itself.
 */
describe("GET /v1/jobs — child jobs", () => {
  it("GET /v1/jobs excludes child jobs", async () => {
    await app.inject({ method: "GET", url: "/v1/jobs?limit=10" })
    expect(calls).toContainEqual({ method: "is", args: ["parent_job_id", null] })
  })

  it("excludes them under every filter too", async () => {
    await app.inject({ method: "GET", url: "/v1/jobs?limit=10&status=completed&type=text-to-video" })
    expect(calls).toContainEqual({ method: "is", args: ["parent_job_id", null] })
  })
})
