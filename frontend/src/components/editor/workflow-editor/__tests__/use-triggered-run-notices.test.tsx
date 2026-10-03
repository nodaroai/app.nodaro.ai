/**
 * The open editor's notices for runs it did not start: polled only while the
 * workflow has a trigger node, silent on the first look, one toast per run
 * (started, then finished in place), a summary for a burst, and View hands
 * the run to the editor.
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

interface ToastCall {
  kind: string
  message: string
  options: { id?: string; action?: { label: string; onClick: () => void } }
}
const toasts = vi.hoisted(() => ({ calls: [] as ToastCall[] }))
vi.mock("sonner", () => {
  const record = (kind: string) => (message: string, options: ToastCall["options"]) => {
    toasts.calls.push({ kind, message, options })
  }
  return { toast: Object.assign(record("plain"), { success: record("success"), error: record("error") }) }
})

import { useTriggeredRunNotices } from "../use-triggered-run-notices"

const run = (id: string, status: string, triggerType = "telegram_account") => ({ id, status, triggerType })

/** The Executions tab's first page: the notices share its cache entry. */
const key = ["workflow-executions", "wf-1", undefined]

function setup(listening = true, cachedPage?: unknown[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (cachedPage) qc.setQueryData(key, { data: cachedPage })
  const onView = vi.fn()
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  renderHook(() => useTriggeredRunNotices("wf-1", listening, onView), { wrapper })
  /** Wait until the hook has SEEN page n (its effect ran), so the next page is news, not history. */
  const seenPage = async (n: number) => {
    await waitFor(() => expect(qc.getQueryState(key)?.dataUpdateCount).toBe(n))
    await act(async () => {})
  }
  const poll = async () => {
    const before = qc.getQueryState(key)?.dataUpdateCount ?? 0
    await act(async () => {
      await qc.refetchQueries({ queryKey: key })
    })
    await seenPage(before + 1)
  }
  return { onView, poll, seenPage }
}

beforeEach(() => {
  api.pages = []
  api.calls = 0
  toasts.calls = []
})

describe("useTriggeredRunNotices", () => {
  it("says nothing on the first look, then one toast per run — started, then finished in place", async () => {
    api.pages = [[run("old", "completed")], [run("new", "running"), run("old", "completed")], [run("new", "completed"), run("old", "completed")]]
    const { poll, seenPage } = setup()
    await seenPage(1)
    expect(toasts.calls).toEqual([])

    await poll()
    await waitFor(() => expect(toasts.calls).toHaveLength(1))
    expect(toasts.calls[0]).toMatchObject({ kind: "plain", options: { id: "run-notice-new" } })
    expect(toasts.calls[0].message).toContain("Telegram account")

    await poll()
    await waitFor(() => expect(toasts.calls).toHaveLength(2))
    expect(toasts.calls[1]).toMatchObject({ kind: "success", options: { id: "run-notice-new" } })
  })

  it("View hands that run to the editor", async () => {
    api.pages = [[], [run("new", "failed")]]
    const { onView, poll, seenPage } = setup()
    await seenPage(1)
    await poll()
    await waitFor(() => expect(toasts.calls).toHaveLength(1))
    expect(toasts.calls[0].kind).toBe("error")
    toasts.calls[0].options.action?.onClick()
    expect(onView).toHaveBeenCalledWith("new", true)
  })

  it("View on a started run opens it without asking for a result that is not there yet", async () => {
    api.pages = [[], [run("new", "running")]]
    const { onView, poll, seenPage } = setup()
    await seenPage(1)
    await poll()
    await waitFor(() => expect(toasts.calls).toHaveLength(1))
    toasts.calls[0].options.action?.onClick()
    expect(onView).toHaveBeenCalledWith("new", false)
  })

  it("a burst is summed up per kind (a failure stays an error), and its View opens the list", async () => {
    api.pages = [[], [run("a", "running"), run("b", "running"), run("c", "completed"), run("d", "failed"), run("e", "failed")]]
    const { onView, poll, seenPage } = setup()
    await seenPage(1)
    await poll()
    await waitFor(() => expect(toasts.calls).toHaveLength(3))
    expect(toasts.calls.map((c) => [c.kind, c.options.id])).toEqual([
      ["plain", "run-notice-many-started"],
      ["success", "run-notice-many-finished"],
      ["error", "run-notice-many-failed"],
    ])
    expect(toasts.calls[2].message).toContain("2")
    toasts.calls[2].options.action?.onClick()
    expect(onView).toHaveBeenCalledWith(null, false)
  })

  it("a page cached before the editor opened is not history: the first fresh look is", async () => {
    api.pages = [[run("new", "running")], [run("new", "completed")]]
    const { poll, seenPage } = setup(true, [])
    await seenPage(2)
    expect(toasts.calls).toEqual([])
    await poll()
    await waitFor(() => expect(toasts.calls).toHaveLength(1))
    expect(toasts.calls[0]).toMatchObject({ kind: "success", options: { id: "run-notice-new" } })
  })

  it("does not look at all while the workflow has no trigger node", async () => {
    api.pages = [[run("new", "running")]]
    setup(false)
    await new Promise((r) => setTimeout(r, 50))
    expect(api.calls).toBe(0)
  })
})
