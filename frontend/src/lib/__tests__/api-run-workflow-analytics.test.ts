import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Every run the editor starts on the server passes runWorkflow, which reports
 * one `workflow_run` to the site analytics (lib/analytics) per started run —
 * never for a start the server refused, nor for "already running".
 */

const mockGetSession = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}))

import { runWorkflow, WorkflowAlreadyRunningError } from "../api"

type AnalyticsGlobals = { dataLayer?: unknown[]; __NODARO_GA__?: unknown }
const globals = window as unknown as AnalyticsGlobals

function runEvents(): unknown[] {
  return (globals.dataLayer ?? [])
    .map((entry) => Array.from(entry as ArrayLike<unknown>))
    .filter((command) => command[0] === "event" && command[1] === "workflow_run")
    .map((command) => (command[2] as { run_scope?: string }).run_scope)
}

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status < 300, status, json: () => Promise.resolve(body) })
}

beforeEach(() => {
  mockGetSession.mockReset()
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "tok" } } })
  globals.dataLayer = []
  globals.__NODARO_GA__ = { measurementId: "G-TEST1234" }
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete globals.dataLayer
  delete globals.__NODARO_GA__
})

describe("runWorkflow → workflow_run", () => {
  it("names what the run covers", async () => {
    vi.stubGlobal("fetch", respond(202, { executionId: "exec-1" }))
    await runWorkflow("wf-1")
    await runWorkflow("wf-1", ["a"])
    await runWorkflow("wf-1", ["r"], undefined, { continueFromExecutionId: "exec-0" })
    await runWorkflow("wf-1", ["r"], undefined, { continueFromExecutionId: "exec-0", continueMode: "from-failed" })
    expect(runEvents()).toEqual(["all", "nodes", "continue", "continue_failed"])
  })

  it("a refused start and an already-running workflow report nothing", async () => {
    vi.stubGlobal("fetch", respond(402, { error: { code: "insufficient_credits", message: "Not enough credits" } }))
    await expect(runWorkflow("wf-1")).rejects.toThrow()
    vi.stubGlobal("fetch", respond(409, { error: { code: "already_running" }, executionId: "exec-9" }))
    await expect(runWorkflow("wf-1")).rejects.toBeInstanceOf(WorkflowAlreadyRunningError)
    expect(runEvents()).toEqual([])
  })
})
