/**
 * No run confirmation outlives its editor, nor the workflow it was asked for
 * (useRunConfirm). A dialog open when the editor goes away (browser Back with
 * it up) or switches to another workflow in place is answered "no", and so is
 * one asked after the editor went (a run that was still being priced when it
 * left): every run waiting on one takes its own abort path and releases what it
 * holds, so no node stays un-runnable until a reload. StrictMode's mount,
 * unmount and mount again leaves a working hook, and so does a switch.
 */
import { StrictMode, type ReactNode } from "react"
import { describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useRunConfirm } from "../run-confirm-dialog"
import type { RunConfirmInfo } from "../types"

const INFO: RunConfirmInfo = { trigger: "single", nodeCount: 1, estimatedCredits: 120, alwaysConfirm: false }
const ASK = { title: "Run it?", body: "It will run.", confirmLabel: "Run" }

/** Resolves to the promise's value, or "pending" when it has not settled by the next turns of the loop. */
async function settledOf<T>(p: Promise<T>): Promise<T | "pending"> {
  let out: T | "pending" = "pending"
  void p.then((v) => { out = v })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  return out
}

describe("a run confirmation and its editor going away", () => {
  it("a confirmation open when the editor goes is answered no", async () => {
    const { result, unmount } = renderHook(() => useRunConfirm())
    let answer!: Promise<boolean>
    act(() => { answer = result.current.confirmRun(INFO) })
    expect(await settledOf(answer)).toBe("pending")
    unmount()
    expect(await settledOf(answer)).toBe(false)
  })

  it("a question open when the editor goes is answered no", async () => {
    const { result, unmount } = renderHook(() => useRunConfirm())
    let answer!: Promise<boolean>
    act(() => { answer = result.current.askConfirm(ASK) })
    unmount()
    expect(await settledOf(answer)).toBe(false)
  })

  it("one asked after the editor went is answered no at once", async () => {
    const { result, unmount } = renderHook(() => useRunConfirm())
    const { confirmRun, askConfirm } = result.current
    unmount()
    expect(await settledOf(confirmRun(INFO))).toBe(false)
    expect(await settledOf(askConfirm(ASK))).toBe(false)
  })

  it("StrictMode's second mount leaves the dialog asking, not answering no", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
    const { result } = renderHook(() => useRunConfirm(), { wrapper })
    let answer!: Promise<boolean>
    act(() => { answer = result.current.confirmRun(INFO) })
    expect(await settledOf(answer)).toBe("pending")
    expect(result.current.isConfirming).toBe(true)
  })
})

describe("a run confirmation and its editor switching to another workflow in place", () => {
  const editorOn = () => renderHook(({ workflowId }: { workflowId: string }) => useRunConfirm(workflowId), { initialProps: { workflowId: "wf-1" } })

  it("a confirmation open when the editor switches is answered no and closes; the next workflow's run asks again", async () => {
    const { result, rerender } = editorOn()
    let answer!: Promise<boolean>
    act(() => { answer = result.current.confirmRun(INFO) })
    expect(await settledOf(answer)).toBe("pending")
    rerender({ workflowId: "wf-2" })
    expect(await settledOf(answer)).toBe(false)
    expect(result.current.isConfirming).toBe(false)
    let next!: Promise<boolean>
    act(() => { next = result.current.confirmRun(INFO) })
    expect(await settledOf(next)).toBe("pending")
    expect(result.current.isConfirming).toBe(true)
  })

  it("a question open when the editor switches is answered no and closes", async () => {
    const { result, rerender } = editorOn()
    let answer!: Promise<boolean>
    act(() => { answer = result.current.askConfirm(ASK) })
    rerender({ workflowId: "wf-2" })
    expect(await settledOf(answer)).toBe(false)
    expect(result.current.isConfirming).toBe(false)
  })

  it("the editor rendering again on the same workflow leaves the dialog asking", async () => {
    const { result, rerender } = editorOn()
    let answer!: Promise<boolean>
    act(() => { answer = result.current.confirmRun(INFO) })
    rerender({ workflowId: "wf-1" })
    expect(await settledOf(answer)).toBe("pending")
    expect(result.current.isConfirming).toBe(true)
  })
})
