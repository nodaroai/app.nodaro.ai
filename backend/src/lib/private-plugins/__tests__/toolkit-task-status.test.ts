/**
 * `tk.providers.getVideoTaskStatus` — the resume-reconcile status read the
 * gvp chain uses on an in-flight checkpointed segment task.
 *
 * The `contentPolicy` passthrough is the app half of the 2026-08-16 fix
 * (run 499deba8): a deploy restart mid-segment left the chain's resume
 * unable to tell a content-screen rejection from any other failure — the
 * status shape carried no reason — so its one §6 attempt resubmitted the
 * identical bytes the deterministic screen had just rejected, and the
 * plugin-side rewrite never ran. With the flag, plugins ≥ 0.146.0 go
 * rewrite-first. The flag is emitted ONLY when true: older plugins (and
 * every non-policy failure) see the exact wire shape they always did.
 *
 * Mocking convention mirrors toolkit-gvp.test.ts: mock `@/lib/supabase.js`
 * so importing the toolkit stays inert, full-replace only `pollKieTask` —
 * KieError and isUpstreamKieFailure stay REAL so the classification under
 * test is the production one, not a mock of it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFrom, mockPollKieTask, routePoll, segmentDone } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockPollKieTask: vi.fn(),
  routePoll: vi.fn(),
  segmentDone: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mockFrom } }))
vi.mock(import("../../../providers/kie/client.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, pollKieTask: mockPollKieTask }
})

vi.mock("../services-registry.js", () => ({ getPluginServices: () => ({ alternateRoutes: { poll: routePoll } }) }))
vi.mock("../../alternate-route.js", async (original) => ({ ...(await original<object>()), rowlessSegmentDone: segmentDone }))

import { runWithJobCancellation } from "../../job-cancellation.js"
import { rowlessRouteTaskId } from "../../video-route-decision.js"
import { buildToolkit } from "../toolkit.js"
import { KieError } from "../../../providers/kie/client.js"
import type { PluginToolkit } from "../types.js"

describe("tk.providers.getVideoTaskStatus", () => {
  let tk: PluginToolkit

  beforeEach(() => {
    mockPollKieTask.mockReset()
    routePoll.mockReset()
    segmentDone.mockReset().mockResolvedValue(0)
    tk = buildToolkit()
  })

  it("maps a completed poll to succeeded with the first result url", async () => {
    mockPollKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://p/a.mp4", "https://p/b.mp4"] } })
    await expect(tk.providers.getVideoTaskStatus("t1")).resolves.toEqual({
      state: "succeeded",
      videoUrl: "https://p/a.mp4",
    })
    expect(mockPollKieTask).toHaveBeenCalledWith("t1", 1)
  })

  it("a terminal KieError carrying the content-policy flag surfaces it on the failed state", async () => {
    mockPollKieTask.mockRejectedValue(
      new KieError("declined: may resemble protected content", "failCode 400 copyright", "kie-poll", true, true),
    )
    await expect(tk.providers.getVideoTaskStatus("t1")).resolves.toEqual({
      state: "failed",
      contentPolicy: true,
    })
  })

  it("a terminal KieError WITHOUT the flag keeps the exact legacy wire shape — no contentPolicy key at all", async () => {
    mockPollKieTask.mockRejectedValue(new KieError("task failed", "failCode 500", "kie-poll", true, false))
    const result = await tk.providers.getVideoTaskStatus("t1")
    expect(result).toEqual({ state: "failed" })
    expect("contentPolicy" in result).toBe(false)
  })

  it("any non-terminal rejection (still generating, network blip, poll timeout) stays processing", async () => {
    mockPollKieTask.mockRejectedValue(new Error("single-attempt poll timeout"))
    await expect(tk.providers.getVideoTaskStatus("t1")).resolves.toEqual({ state: "processing" })
  })
})

// Only a positive reported bill is a bill; zero, missing and non-finite values remain pending.
// The estimate beside it is passed on for the record and never becomes the cost.
it.each([0, 1.5, null, undefined, Infinity, NaN, -1])("resumed routed receipt %s preserves its evidence", async (cost) => {
  routePoll.mockResolvedValue({ state: "done", resultUrl: "https://p/clip.mp4", providerCostUsd: cost, estimatedCostUsd: 2 })
  segmentDone.mockResolvedValue(0)
  const expected = typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : null
  const result = await runWithJobCancellation("parent-job", "owner", () =>
    buildToolkit().providers.getVideoTaskStatus(rowlessRouteTaskId("test-route", "task", "seg-1:1")))
  expect(segmentDone).toHaveBeenLastCalledWith("parent-job", "seg-1:1", "task", cost === 0 ? 0 : expected, 2, expected === null ? undefined : "receipt", {})
  expect(result).toMatchObject({ state: "succeeded", routed: { costUsd: expected } })
})

it("a resumed routed segment billed by its seconds carries that basis to the ledger", async () => {
  routePoll.mockResolvedValue({ state: "done", resultUrl: "https://p/clip.mp4", providerCostUsd: 1.2, costBasis: "billed-seconds", billedSec: 8 })
  segmentDone.mockResolvedValue(0)
  const result = await runWithJobCancellation("parent-job", "owner", () =>
    buildToolkit().providers.getVideoTaskStatus(rowlessRouteTaskId("test-route", "task", "seg-1:1")))
  expect(segmentDone).toHaveBeenLastCalledWith("parent-job", "seg-1:1", "task", 1.2, null, "billed-seconds", {})
  expect(result).toMatchObject({ state: "succeeded", routed: { costUsd: 1.2 } })
})

it("a resumed routed segment carries the time the route's own record says it finished to the ledger", async () => {
  routePoll.mockResolvedValue({ state: "done", resultUrl: "https://p/clip.mp4", providerCostUsd: 1.2, completedAt: "2026-11-24T23:58:00Z" })
  segmentDone.mockResolvedValue(0)
  await runWithJobCancellation("parent-job", "owner", () =>
    buildToolkit().providers.getVideoTaskStatus(rowlessRouteTaskId("test-route", "task", "seg-1:1")))
  expect(segmentDone).toHaveBeenLastCalledWith("parent-job", "seg-1:1", "task", 1.2, null, "receipt", { completedAt: "2026-11-24T23:58:00Z" })
})
