/**
 * The editor's watch for runs it did not start: it follows the newest
 * live-lane run still going when nothing else is followed, paints the newest
 * that ended unseen (with the listing it came from), never hands the same run
 * over twice, holds while the editor is busy, and does not look at all while
 * disabled (a read-only flow, a workflow still loading).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import React from "react"

const api = vi.hoisted(() => ({ pages: [] as unknown[][], calls: 0 }))
vi.mock("@/lib/api", () => ({
  listWorkflowExecutions: vi.fn(async () => {
    const page = api.pages[Math.min(api.calls, api.pages.length - 1)] ?? []
    api.calls += 1
    return { data: page }
  }),
}))

import { useTriggeredRunFollow } from "../use-triggered-run-follow"

const run = (id: string, status: string, triggerType = "telegram_account") => ({ id, status, triggerType, nodeStates: {} })
const key = ["workflow-executions", "wf-1", undefined]

function setup(initial: { enabled?: boolean; busy?: boolean; cachedPage?: unknown[] } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Cached a minute before this editor opened, as a page from an earlier visit would be.
  if (initial.cachedPage) qc.setQueryData(key, { data: initial.cachedPage }, { updatedAt: Date.now() - 60_000 })
  const follow = vi.fn()
  const paintEnded = vi.fn()
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const hook = renderHook(
    ({ enabled, busy }: { enabled: boolean; busy: boolean }) => useTriggeredRunFollow("wf-1", enabled, busy, { follow, paintEnded }),
    { wrapper, initialProps: { enabled: initial.enabled ?? true, busy: initial.busy ?? false } },
  )
  const looked = async (n: number) => {
    await waitFor(() => expect(qc.getQueryState(key)?.dataUpdateCount).toBe(n))
    await act(async () => {})
  }
  const poll = async () => {
    const before = qc.getQueryState(key)?.dataUpdateCount ?? 0
    await act(async () => {
      await qc.refetchQueries({ queryKey: key })
    })
    await looked(before + 1)
  }
  return { follow, paintEnded, hook, looked, poll }
}

beforeEach(() => {
  api.pages = []
  api.calls = 0
})

describe("useTriggeredRunFollow", () => {
  it("follows the newest Telegram run still going — once", async () => {
    api.pages = [[run("new", "running"), run("old", "completed")]]
    const { follow, paintEnded, looked, poll } = setup()
    await looked(1)
    expect(follow).toHaveBeenCalledTimes(1)
    expect(follow.mock.calls[0]![0]).toMatchObject({ id: "new" })
    await poll()
    expect(follow).toHaveBeenCalledTimes(1)
    expect(paintEnded).not.toHaveBeenCalled()
  })

  it("paints the newest one that ended while nobody looked (the flow was closed) — once", async () => {
    api.pages = [[run("done", "completed")]]
    const { follow, paintEnded, looked, poll } = setup()
    await looked(1)
    expect(paintEnded).toHaveBeenCalledTimes(1)
    expect(paintEnded.mock.calls[0]![0]).toMatchObject({ id: "done" })
    // …with the listing it came from, for the newer-run holds.
    expect(paintEnded.mock.calls[0]![1]).toEqual([expect.objectContaining({ id: "done" })])
    await poll()
    expect(paintEnded).toHaveBeenCalledTimes(1)
    expect(follow).not.toHaveBeenCalled()
  })

  it("holds while the editor is busy, and picks the run up once it is free", async () => {
    api.pages = [[run("new", "running")]]
    const { follow, hook, looked } = setup({ busy: true })
    await looked(1)
    expect(follow).not.toHaveBeenCalled()
    hook.rerender({ enabled: true, busy: false })
    await act(async () => {})
    expect(follow).toHaveBeenCalledTimes(1)
  })

  it("never follows a schedule or a webhook run; paints the one that ended", async () => {
    api.pages = [[run("s", "running", "schedule"), run("w", "completed", "webhook")]]
    const { follow, paintEnded, looked } = setup()
    await looked(1)
    expect(follow).not.toHaveBeenCalled()
    expect(paintEnded).toHaveBeenCalledTimes(1)
    expect(paintEnded.mock.calls[0]![0]).toMatchObject({ id: "w" })
  })

  it("leaves an app run alone", async () => {
    api.pages = [[run("a", "running", "app_run"), run("b", "completed", "app_run")]]
    const { follow, paintEnded, looked } = setup()
    await looked(1)
    expect(follow).not.toHaveBeenCalled()
    expect(paintEnded).not.toHaveBeenCalled()
  })

  it("does not look at all while disabled (read-only, or the workflow still loading)", async () => {
    api.pages = [[run("new", "running")]]
    setup({ enabled: false })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(api.calls).toBe(0)
  })
})

describe("useTriggeredRunFollow — several Telegram runs at once", () => {
  it("follows the newest only: the older ones still going are not followed after it", async () => {
    api.pages = [
      [run("newest", "running"), run("older", "running")],
      [run("newest", "completed"), run("older", "running")],
    ]
    const { follow, paintEnded, looked, poll } = setup()
    await looked(1)
    expect(follow.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(["newest"])
    await poll()
    expect(follow).toHaveBeenCalledTimes(1)
    expect(paintEnded).not.toHaveBeenCalled()
  })
})

describe("useTriggeredRunFollow — review round 2", () => {
  it("a run the editor streams by another way (marked handled) is not followed again", async () => {
    api.pages = [[run("attached", "running")]]
    const { follow, hook, looked } = setup({ busy: true })
    act(() => hook.result.current.markHandled("attached"))
    await looked(1)
    hook.rerender({ enabled: true, busy: false })
    await act(async () => {})
    expect(follow).not.toHaveBeenCalled()
  })

  it("a page cached before the editor opened is not acted on: the first fresh look is", async () => {
    api.pages = [[run("t", "completed")]]
    const { follow, paintEnded, looked } = setup({ cachedPage: [run("t", "running")] })
    await looked(2)
    expect(follow).not.toHaveBeenCalled()
    expect(paintEnded).toHaveBeenCalledTimes(1)
  })
})

describe("useTriggeredRunFollow — review round 3", () => {
  it("a failed first fetch does not make the page cached before opening a look", async () => {
    const { listWorkflowExecutions } = await import("@/lib/api")
    vi.mocked(listWorkflowExecutions).mockRejectedValueOnce(new Error("offline"))
    const { follow, paintEnded } = setup({ cachedPage: [run("old", "running")] })
    await new Promise((resolve) => setTimeout(resolve, 50))
    await act(async () => {})
    expect(follow).not.toHaveBeenCalled()
    expect(paintEnded).not.toHaveBeenCalled()
  })
})
