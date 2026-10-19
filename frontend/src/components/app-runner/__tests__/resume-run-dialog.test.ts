import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))

import { resumeDialogText } from "../resume-run-dialog"
import { tx } from "@/lib/i18n"
import type { ResumeDialogState } from "../use-run-slots"

const t = tx as unknown as Parameters<typeof resumeDialogText>[1]
const plan = (over: Record<string, unknown> = {}) => ({
  runId: "r", continuesExecutionId: "e", appVersion: 1, nodeIds: ["vid", "join"],
  steps: [{ nodeId: "vid", type: "image-to-video", label: "Animate" }, { nodeId: "join", type: "combine-videos", label: null }],
  estimatedCredits: 40, reusedClips: 0, sufficient: true, available: 900, ...over,
})
const state = (over: Partial<ResumeDialogState>): ResumeDialogState => ({ slotId: "r", plan: null, error: null, ...over })

describe("the Retry confirmation names the steps that run again and their price", () => {
  it("each step by its own label, else its node type; the price in the title", () => {
    const text = resumeDialogText(state({ plan: plan() }), t)
    expect(text.steps).toEqual(["Animate", expect.stringMatching(/combine/i)])
    expect(text.title).toBe(tx("runner.retryTitleCredits", { credits: 40 }))
    expect(text.body).toBe(tx("runner.retryBody"))
    expect(text.notes).toContain(tx("runner.retryInputsNote"))
    expect(text.canRetry).toBe(true)
  })

  it("says how many finished clips are reused", () => {
    expect(resumeDialogText(state({ plan: plan({ reusedClips: 1 }) }), t).notes).toContain(tx("runner.retryReusedClipOne"))
    expect(resumeDialogText(state({ plan: plan({ reusedClips: 3 }) }), t).notes).toContain(tx("runner.retryReusedClips", { n: 3 }))
  })

  it("a balance that does not cover it: says so, and Retry cannot be pressed", () => {
    const text = resumeDialogText(state({ plan: plan({ sufficient: false }) }), t)
    expect(text.notes).toContain(tx("runner.retryInsufficient"))
    expect(text.canRetry).toBe(false)
  })

  it("app credits that do not cover it: names the app credits, not the balance, and Retry cannot be pressed", () => {
    const text = resumeDialogText(state({ plan: plan({ sufficient: false, appCreditsAllowance: 0 }) }), t)
    expect(text.notes).toContain(tx("runner.retryNoAppCredits"))
    expect(text.notes).not.toContain(tx("runner.retryInsufficient"))
    expect(text.canRetry).toBe(false)
  })

  it("while the plan is asked: no steps yet, nothing to press", () => {
    expect(resumeDialogText(state({}), t)).toMatchObject({ body: tx("runner.retryChecking"), steps: [], canRetry: false })
  })

  it("a run that cannot be continued: the reason by its code, and Start over", () => {
    for (const [code, key] of [
      ["app_run_version_unavailable", "runner.retryVersionGone"],
      ["app_run_version_changed", "runner.retryVersionChanged"],
      ["continuation_not_failed", "runner.retryNotFailed"],
      ["continuation_subset_required", "runner.retryNothingLeft"],
    ] as const) {
      const text = resumeDialogText(state({ error: { code, message: "x" } }), t)
      expect(text.body).toBe(tx(key))
      expect(text.canRetry).toBe(false)
    }
    expect(resumeDialogText(state({ error: { code: null, message: "down" } }), t).body).toBe(tx("runner.retryUnavailable", { message: "down" }))
  })
})
