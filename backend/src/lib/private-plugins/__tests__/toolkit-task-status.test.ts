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

const { mockFrom, mockPollKieTask } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockPollKieTask: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mockFrom } }))
vi.mock(import("../../../providers/kie/client.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, pollKieTask: mockPollKieTask }
})

import { buildToolkit } from "../toolkit.js"
import { KieError } from "../../../providers/kie/client.js"
import type { PluginToolkit } from "../types.js"

describe("tk.providers.getVideoTaskStatus", () => {
  let tk: PluginToolkit

  beforeEach(() => {
    mockPollKieTask.mockReset()
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
