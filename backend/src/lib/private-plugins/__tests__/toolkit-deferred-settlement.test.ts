/**
 * `tk.jobs.settleDeferredChild` / `releaseDeferredChild`
 * (capabilities.deferredChildSettlement): the caller is the running job — the
 * one whose handler runs (`getJobId()`), never an id the plugin names — and a
 * child that is not its own is refused before any money moves.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const deferred = vi.hoisted(() => ({
  resolveDeferredChild: vi.fn().mockResolvedValue("settled"),
  ownChildren: new Map<string, string>(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() } }))
vi.mock("../../deferred-child-settlement.js", () => ({
  resolveDeferredChild: deferred.resolveDeferredChild,
  assertOwnDeferredChild: vi.fn(async (caller: string | undefined, child: string) => {
    if (caller === undefined || deferred.ownChildren.get(child) !== caller) throw new Error(`Job ${child} is not a child of the running job`)
  }),
}))

import { buildToolkit } from "../toolkit.js"
import { runWithJobCancellation } from "../../job-cancellation.js"

const PARENT = "00000000-0000-4000-8000-0000000000a1"
const OTHER = "00000000-0000-4000-8000-0000000000a2"
const CHILD = "00000000-0000-4000-8000-0000000000c1"

beforeEach(() => {
  deferred.resolveDeferredChild.mockClear()
  deferred.ownChildren.clear()
  deferred.ownChildren.set(CHILD, PARENT)
})

describe("tk.jobs deferred child settlement", () => {
  it("is declared", () => {
    expect(buildToolkit().capabilities?.deferredChildSettlement).toBe(true)
  })

  it("declares the upscale step's deferral (/v1/video-upscale under the delivered rule) beside it", () => {
    expect(buildToolkit().capabilities?.deferredUpscaleSettlement).toBe(true)
  })

  it("the parent's own handler settles and releases its child", async () => {
    const tk = buildToolkit()
    const answers = await runWithJobCancellation(PARENT, "u", async () => [
      await tk.jobs.settleDeferredChild?.(CHILD),
      await tk.jobs.releaseDeferredChild?.(CHILD, "a face is still blurred"),
    ])
    // What happened is answered to the plugin.
    expect(answers).toEqual(["settled", "settled"])
    expect(deferred.resolveDeferredChild).toHaveBeenNthCalledWith(1, CHILD, "settled", { by: "plugin" })
    expect(deferred.resolveDeferredChild).toHaveBeenNthCalledWith(2, CHILD, "released", { reason: "a face is still blurred", by: "plugin" })
  })

  it.each([
    ["another job's handler", (fn: () => Promise<unknown>) => runWithJobCancellation(OTHER, "u", fn)],
    ["no running job", (fn: () => Promise<unknown>) => fn()],
  ])("%s is refused and moves no money", async (_label, inContext) => {
    const tk = buildToolkit()
    await expect(inContext(() => tk.jobs.settleDeferredChild!(CHILD))).rejects.toThrow("not a child")
    await expect(inContext(() => tk.jobs.releaseDeferredChild!(CHILD, "x"))).rejects.toThrow("not a child")
    expect(deferred.resolveDeferredChild).not.toHaveBeenCalled()
  })
})
