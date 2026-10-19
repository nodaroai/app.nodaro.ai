/**
 * The resume hint on a failed APP run names the app's own Retry
 * (`retry_app_run`), never `run_workflow` (which refuses a published
 * version's execution): only on the run's CURRENT execution, with the app's
 * latest slug, and saying so when the app changed since the run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  appRun: null as unknown,
  ran: null as unknown,
  latest: null as unknown,
  throws: false,
  filters: [] as Array<{ table: string; method: string; args: unknown[] }>,
}))

vi.mock("../../../supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (db.throws) throw new Error("down")
      const filters: Record<string, unknown> = {}
      const q: Record<string, unknown> = {}
      for (const m of ["select", "eq", "in", "is", "not", "order", "limit"])
        q[m] = (...a: unknown[]) => {
          db.filters.push({ table, method: m, args: a })
          if (m === "eq") filters[a[0] as string] = a[1]
          return q
        }
      q.maybeSingle = async () => {
        if (table === "app_runs") return { data: db.appRun, error: null }
        if (table === "published_apps") return { data: "id" in filters ? db.ran : db.latest, error: null }
        return { data: null, error: null }
      }
      return q
    },
  },
}))
const access = vi.hoisted(() => ({ calls: 0 }))
vi.mock("../_workflow-access.js", () => ({
  loadMcpWorkflow: vi.fn(async () => (access.calls++, { ok: true, row: { id: "wf-1", nodes: [], edges: [] } })),
}))

import { resumeFailedRunHint } from "../_resume-hint.js"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"

const session = newSession({ userId: "u1", scopes: ["assets:read"] as Scope[], clientName: "Claude" })
const RUN_ID = "33333333-3333-4333-8333-333333333333"
const failedAppRun = (over: Record<string, unknown> = {}) => ({
  id: "exec-a",
  status: "failed",
  workflow_id: "wf-1",
  trigger_type: "app_run",
  trigger_data: { appRun: { appRunId: RUN_ID } },
  started_at: "2026-10-18T10:00:00Z",
  ...over,
})

beforeEach(() => {
  db.appRun = { id: RUN_ID, app_id: "app-v3" }
  db.ran = { workflow_id: "wf-1", slug: "hair-styler", version: 3, publish_type: "app" }
  db.latest = { slug: "hair-styler", version: 3 }
  db.throws = false
  db.filters.length = 0
  access.calls = 0
})

describe("resumeFailedRunHint on an app run", () => {
  it("a failed app run: retry_app_run (it quotes first), never run_workflow", async () => {
    const hint = await resumeFailedRunHint(failedAppRun(), session)
    expect(hint).toContain(`retry_app_run({ slug: "hair-styler", run_id: "${RUN_ID}" })`)
    expect(hint).toContain("start over with run_app")
    expect(hint).not.toContain("run_workflow")
    expect(hint).not.toContain("version:")
    expect(hint).toContain("confirm: true")
    // The run is the runner's own, found by its pointer to this execution.
    expect(db.filters).toEqual(
      expect.arrayContaining([
        { table: "app_runs", method: "eq", args: ["execution_id", "exec-a"] },
        { table: "app_runs", method: "eq", args: ["runner_id", "u1"] },
        { table: "app_runs", method: "is", args: ["deleted_at", null] },
      ]),
    )
    expect(access.calls).toBe(0)
  })

  it("a draft-lane re-run (manual, stamped with its run) gets the same hint", async () => {
    const hint = await resumeFailedRunHint(failedAppRun({ trigger_type: "manual" }), session)
    expect(hint).toContain(`retry_app_run({ slug: "hair-styler", run_id: "${RUN_ID}" })`)
  })

  it("an execution the run moved on from (a later Retry or a start-over): no hint", async () => {
    db.appRun = null
    expect(await resumeFailedRunHint(failedAppRun(), session)).toBeNull()
  })

  it("the app changed since the run: names the run's version to continue on, and run_app for the new one", async () => {
    db.ran = { workflow_id: "wf-1", slug: "hair-styler-v2", version: 2, publish_type: "app" }
    const hint = await resumeFailedRunHint(failedAppRun(), session)
    expect(hint).toContain(`retry_app_run({ slug: "hair-styler", run_id: "${RUN_ID}", version: 2 })`)
    expect(hint).toMatch(/now on version 3/)
    expect(hint).toContain("start over with run_app")
  })

  it("a component's run, or a version that is gone: no hint", async () => {
    db.ran = { workflow_id: "wf-1", slug: "x", version: 3, publish_type: "component" }
    expect(await resumeFailedRunHint(failedAppRun(), session)).toBeNull()
    db.ran = null
    expect(await resumeFailedRunHint(failedAppRun(), session)).toBeNull()
  })

  it("a webhook row carrying a forged app-run stamp is no app run: hinted as the saved-workflow run it is", async () => {
    const hint = await resumeFailedRunHint(failedAppRun({ trigger_type: "webhook" }), session)
    expect(hint).not.toContain("retry_app_run")
    expect(hint).toContain("run_workflow")
  })

  it("a Render final keeps its own path: no Retry hint", async () => {
    const hint = await resumeFailedRunHint(
      failedAppRun({ trigger_type: "manual", trigger_data: { appRenderFinal: { appRunId: RUN_ID, appVersionId: "app-v3", continuedFrom: "exec-0" } } }),
      session,
    )
    expect(hint).toBeNull()
  })

  it("a run that did not fail, or a failed lookup: no hint", async () => {
    expect(await resumeFailedRunHint(failedAppRun({ status: "cancelled" }), session)).toBeNull()
    db.throws = true
    expect(await resumeFailedRunHint(failedAppRun(), session)).toBeNull()
  })
})
