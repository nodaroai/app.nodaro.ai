import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../../index.js"
import { AlreadyRunningError, AppRunVersionChangedError, ContinuationRefusedError, InsufficientCreditsError, NodaroError, NotFoundError } from "../../entries/errors.js"
import type { AppRunResumePlan, AppRunResumeRefusalCode, AppRunResumeResult } from "../../entries/apps.js"

function mockOk<T>(body: T, status = 200) {
  return Promise.resolve({ ok: true, status, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}
function client(fetchMock: ReturnType<typeof vi.fn>) {
  return createClient({
    baseUrl: "https://api.example.com",
    auth: new StaticTokenAuth("t"),
    fetch: fetchMock as unknown as typeof fetch,
  })
}
const call = (fetchMock: ReturnType<typeof vi.fn>, i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, { method: string; body: string }]
  return { url, method: init.method, body: JSON.parse(init.body) as unknown }
}

const plan: AppRunResumePlan = {
  runId: "run-1",
  continuesExecutionId: "ex-failed",
  appVersion: 3,
  nodeIds: ["clip", "join"],
  steps: [{ nodeId: "clip", type: "ugc-clip", label: "Clips" }],
  estimatedCredits: 120,
  reusedClips: 2,
  sufficient: true,
  available: 900,
}

describe("apps.resume — the Retry of a failed app run", () => {
  it("POSTs the resume route with an empty body by default and returns the started Retry", async () => {
    const started: AppRunResumeResult = { executionId: "ex-2", runId: "run-1", status: "pending", nodeIds: ["clip", "join"] }
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk(started, 202))
    const result = await client(fetchMock).apps.resume("my app", "run-1")
    expect(result).toEqual(started)
    const sent = call(fetchMock)
    expect(sent.method).toBe("POST")
    expect(sent.url).toBe("https://api.example.com/v1/app/my%20app/runs/run-1/resume")
    expect(sent.body).toEqual({})
  })

  it("dryRun sends dryRun: true and returns the plan under data", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: plan }))
    const { data } = await client(fetchMock).apps.resume("my-app", "run-1", { dryRun: true })
    expect(data).toEqual(plan)
    expect(call(fetchMock).body).toEqual({ dryRun: true })
  })

  it("a plan the app credits stop carries appCreditsAllowance", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: { ...plan, sufficient: false, appCreditsAllowance: 0 } }))
    const { data } = await client(fetchMock).apps.resume("my-app", "run-1", { dryRun: true })
    expect(data.sufficient).toBe(false)
    expect(data.appCreditsAllowance).toBe(0)
  })

  it("forwards version, and leaves dryRun out when false", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ executionId: "ex-2", runId: "run-1", status: "pending", nodeIds: [] }, 202))
    await client(fetchMock).apps.resume("my-app", "run-1", { dryRun: false, version: 2 })
    expect(call(fetchMock).body).toEqual({ version: 2 })
  })

  it("a version change is an AppRunVersionChangedError carrying both versions", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(409, {
        error: { code: "app_run_version_changed", message: "This run used version 2 of the app, which is now on version 3" },
        runVersion: 2,
        appVersion: 3,
      }),
    )
    const refused = await client(fetchMock).apps.resume("my-app", "run-1").catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(AppRunVersionChangedError)
    expect(refused).toBeInstanceOf(NodaroError)
    expect(refused).toMatchObject({ code: "app_run_version_changed", status: 409, runVersion: 2, appVersion: 3 })
  })

  it("the other refusals keep their stable code", async () => {
    const codes: Array<[number, AppRunResumeRefusalCode]> = [
      [409, "app_run_version_unavailable"],
      [409, "continuation_not_failed"],
      [409, "continuation_subset_required"],
      [400, "validation_error"],
      [400, "continuation_version_mismatch"],
      [503, "billing_unavailable"],
      [400, "locked_field"],
      [400, "preview_review_required"],
    ]
    for (const [status, code] of codes) {
      const fetchMock = vi.fn().mockReturnValueOnce(mockErr(status, { error: { code, message: "refused" } }))
      const refused = await client(fetchMock).apps.resume("my-app", "run-1").catch((e: unknown) => e)
      expect(refused).toBeInstanceOf(NodaroError)
      expect(refused).not.toBeInstanceOf(AppRunVersionChangedError)
      expect(refused).toMatchObject({ code, status })
    }
  })

  it("already_running names the live execution: an AlreadyRunningError carrying it", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(409, { error: { code: "already_running", message: "This run is still running." }, executionId: "ex-live" }),
    )
    const refused = await client(fetchMock).apps.resume("my-app", "run-1").catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(AlreadyRunningError)
    expect(refused).toBeInstanceOf(NodaroError)
    expect(refused).toMatchObject({ code: "already_running", status: 409, executionId: "ex-live" })
  })

  it("already_running that names a job stays a ContinuationRefusedError; one naming nothing a plain NodaroError", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockErr(409, { error: { code: "already_running", message: "busy" }, jobId: "job-1" }))
      .mockReturnValueOnce(mockErr(409, { error: { code: "already_running", message: "This run was started again elsewhere." } }))
    const c = client(fetchMock)
    expect(await c.apps.resume("my-app", "run-1").catch((e: unknown) => e)).toBeInstanceOf(ContinuationRefusedError)
    const bare = await c.apps.resume("my-app", "run-1").catch((e: unknown) => e)
    expect(bare).not.toBeInstanceOf(AlreadyRunningError)
    expect(bare).toMatchObject({ code: "already_running", status: 409 })
  })

  it("no such run is a NotFoundError; a balance that cannot cover it an InsufficientCreditsError", async () => {
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(mockErr(404, { error: { code: "not_found", message: "Run not found" } }))
      .mockReturnValueOnce(mockErr(402, { error: { code: "insufficient_credits", message: "This retry can hold up to about 40 credits" } }))
    const c = client(fetchMock)
    expect(await c.apps.resume("my-app", "run-1").catch((e: unknown) => e)).toBeInstanceOf(NotFoundError)
    expect(await c.apps.resume("my-app", "run-1").catch((e: unknown) => e)).toBeInstanceOf(InsufficientCreditsError)
  })
})
