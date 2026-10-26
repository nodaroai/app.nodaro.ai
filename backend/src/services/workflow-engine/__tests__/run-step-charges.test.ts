/**
 * A workflow node's charge includes its job's steps (child jobs), and the
 * run's totals — the execution total, the app-run total, the creator fee base —
 * must not freeze a partial figure: a worker marks a job completed before it
 * commits, so a step can settle a moment after its parent completed, and a
 * read of the steps can fail. The executor notes what it counted
 * (`noteStepCharges`); the run's end settles the rest (`settleRunStepCharges`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { NodeExecutionState } from "../types.js"

type Fig = { stepsCharged: number | null; stepsSettled: boolean; complete: boolean }
const h = vi.hoisted(() => ({ answers: [] as Array<Record<string, Fig>>, reads: [] as string[][] }))
vi.mock("../../../lib/job-credit-status.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/job-credit-status.js")>()),
  runCreditsFor: async (rows: Array<{ id: string }>) => {
    h.reads.push(rows.map((r) => r.id))
    const answer = h.answers.length > 1 ? h.answers.shift()! : h.answers[0] ?? {}
    return new Map(rows.filter((r) => answer[r.id]).map((r) => [r.id, answer[r.id]]))
  },
}))

const { noteStepCharges, settleRunStepCharges } = await import("../run-step-charges.js")
const { runCreditsFor } = await import("../../../lib/job-credit-status.js")

const fig = (stepsCharged: number | null, stepsSettled = true, complete = true): Fig => ({ stepsCharged, stepsSettled, complete })
const ctxOf = () => ({ userId: "user-1", stepCharges: undefined as Map<string, { included: number; final: boolean }> | undefined })
const fast = { delayMs: 0 }

beforeEach(() => {
  h.answers = []
  h.reads = []
})

describe("settleRunStepCharges — the run's end counts what its nodes could not yet", () => {
  it("a step that settled after its parent completed reaches the node and the run's total", async () => {
    const ctx = ctxOf()
    // At the parent's completion: the video step still held (committed a moment later).
    h.answers = [{ run: fig(132, false) }]
    noteStepCharges(ctx, "run", await runCreditsFor([{ id: "run" }], "user-1"))
    const nodeStates: Record<string, NodeExecutionState> = { motion: { status: "completed", jobId: "run", creditsUsed: 44 + 132 } }
    // At the run's end: every step settled.
    h.answers = [{ run: fig(132 + 33 + 854) }]
    const delta = await settleRunStepCharges(ctx, nodeStates, fast)
    expect(delta).toBe(887)
    expect(nodeStates.motion!.creditsUsed).toBe(1063)
    // Once final, a second settle reads nothing.
    h.reads = []
    expect(await settleRunStepCharges(ctx, nodeStates, fast)).toBe(0)
    expect(h.reads).toEqual([])
  })

  it("waits, bounded, for a step still held at the run's end", async () => {
    const ctx = ctxOf()
    h.answers = [{ run: fig(0, false) }]
    noteStepCharges(ctx, "run", await runCreditsFor([{ id: "run" }], "user-1"))
    h.reads = []
    h.answers = [{ run: fig(0, false) }, { run: fig(854) }]
    const nodeStates: Record<string, NodeExecutionState> = { motion: { status: "completed", jobId: "run", creditsUsed: 44 } }
    expect(await settleRunStepCharges(ctx, nodeStates, fast)).toBe(854)
    expect(h.reads).toHaveLength(2)
  })

  it("a failed node's job: its settled steps are counted (the executor never did)", async () => {
    const ctx = ctxOf()
    h.answers = [{ failed: fig(66 + 66 + 33) }]
    const nodeStates: Record<string, NodeExecutionState> = { motion: { status: "failed", jobId: "failed", error: "boom" } }
    expect(await settleRunStepCharges(ctx, nodeStates, fast)).toBe(165)
    expect(nodeStates.motion!.creditsUsed).toBe(165)
  })

  it("steps that cannot be read keep what was counted — never a lower figure, never a guess", async () => {
    const ctx = ctxOf()
    h.answers = [{ run: fig(132) }]
    noteStepCharges(ctx, "run", await runCreditsFor([{ id: "run" }], "user-1"))
    // The note was final, so make the run's end read it again as if it was not.
    ctx.stepCharges!.set("run", { included: 132, final: false })
    vi.spyOn(console, "warn").mockImplementation(() => {})
    h.answers = [{ run: fig(null, false, false) }]
    const nodeStates: Record<string, NodeExecutionState> = { motion: { status: "completed", jobId: "run", creditsUsed: 176 } }
    expect(await settleRunStepCharges(ctx, nodeStates, { attempts: 3, delayMs: 0 })).toBe(0)
    expect(nodeStates.motion!.creditsUsed).toBe(176)
    expect(h.reads).toHaveLength(1 + 3)
  })

  it("a node whose job ran no steps costs no read and changes nothing", async () => {
    const ctx = ctxOf()
    h.answers = [{ plain: fig(null) }]
    noteStepCharges(ctx, "plain", await runCreditsFor([{ id: "plain" }], "user-1"))
    h.reads = []
    const nodeStates: Record<string, NodeExecutionState> = { img: { status: "completed", jobId: "plain", creditsUsed: 18 } }
    expect(await settleRunStepCharges(ctx, nodeStates, fast)).toBe(0)
    expect(nodeStates.img!.creditsUsed).toBe(18)
    expect(h.reads).toEqual([])
  })
})
