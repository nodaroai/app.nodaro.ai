import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

const edition = vi.hoisted(() => ({ cloud: false }))
vi.mock("@/lib/edition", () => ({ isCloud: () => edition.cloud }))

const store = vi.hoisted(() => ({
  nodes: [] as Array<{ id: string; data: Record<string, unknown> }>,
  runSingleNode: null as ((id: string) => void) | null,
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: typeof store) => unknown) => selector(store),
}))

// The dialog itself is exercised by its own surface; here we assert only the
// DECISION — whether it opens, for which node, and with what blocked count.
vi.mock("@/components/editor/connect-provider-dialog", () => ({
  ConnectProviderDialog: ({
    nodeLabel,
    alsoBlockedCount,
    onOpenChange,
    onRetry,
  }: {
    nodeLabel: string
    alsoBlockedCount?: number
    onOpenChange: (open: boolean) => void
    onRetry?: () => void
  }) => (
    <div data-testid="dialog" data-label={nodeLabel} data-also={String(alsoBlockedCount ?? 0)}>
      <button data-testid="dismiss" onClick={() => onOpenChange(false)} />
      {onRetry && <button data-testid="retry" onClick={onRetry} />}
    </div>
  ),
}))

import { ConnectProviderWatcher } from "../connect-provider-watcher"

function readiness(ok: boolean) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify({ checks: { providers: { ok, nodaroCloud: false } } }), { status: 200 }),
  )
}

const failed = (id: string, label: string) => ({ id, data: { label, executionStatus: "failed" } })
const ok = (id: string, label: string) => ({ id, data: { label, executionStatus: "completed" } })
const running = (id: string, label: string) => ({ id, data: { label, executionStatus: "running" } })

describe("ConnectProviderWatcher (#771)", () => {
  beforeEach(() => {
    edition.cloud = false
    store.nodes = []
    store.runSingleNode = null
  })
  afterEach(() => vi.restoreAllMocks())

  it("opens on a failure when the install has no provider at all", async () => {
    readiness(false)
    store.nodes = [failed("n1", "Generate Video")]
    render(<ConnectProviderWatcher />)
    const el = await screen.findByTestId("dialog")
    expect(el.getAttribute("data-label")).toBe("Generate Video")
  })

  // The whole point of the capability trigger: a real provider failure (bad
  // key, upstream outage) must keep the normal toast and never be dressed up
  // as a configuration problem.
  it("stays out of the way when a provider IS configured", async () => {
    readiness(true)
    store.nodes = [failed("n1", "Generate Video")]
    render(<ConnectProviderWatcher />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId("dialog")).toBeNull()
  })

  it("treats an unknown answer as do-not-act", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"))
    store.nodes = [failed("n1", "Generate Video")]
    render(<ConnectProviderWatcher />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId("dialog")).toBeNull()
  })

  it("counts the other nodes the same connection would unblock", async () => {
    readiness(false)
    store.nodes = [failed("n1", "Generate Video"), failed("n2", "Suno Generate"), ok("n3", "Upload Video")]
    render(<ConnectProviderWatcher />)
    const el = await screen.findByTestId("dialog")
    expect(el.getAttribute("data-also")).toBe("1")
  })

  it("never fires on cloud, where a provider-less install is not a state", async () => {
    edition.cloud = true
    readiness(false)
    store.nodes = [failed("n1", "Generate Video")]
    render(<ConnectProviderWatcher />)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(screen.queryByTestId("dialog")).toBeNull()
  })

  // Regression: `seen` cleared only when NOTHING was failed. With a sibling
  // still failed the set never emptied, so re-running a node and failing again
  // was swallowed — the dialog, once dismissed, never came back. Only visible
  // after a dismissal, which is why the mock exposes onOpenChange.
  it("reopens after dismissal when a re-run fails again while a sibling stays failed", async () => {
    readiness(false)
    store.nodes = [failed("n1", "Generate Video"), failed("n2", "Suno Generate")]
    const view = render(<ConnectProviderWatcher />)
    await screen.findByTestId("dialog")

    // Dismiss whatever is showing, and keep dismissing while the effect works
    // through the already-failed nodes, so the end state is "nothing open".
    for (let i = 0; i < 4; i++) {
      const open = screen.queryByTestId("dismiss")
      if (open) fireEvent.click(open)
      view.rerender(<ConnectProviderWatcher />)
      await waitFor(() => expect(true).toBe(true))
    }
    expect(screen.queryByTestId("dialog")).toBeNull()

    // n1 is re-run — it leaves the failed set while n2 stays failed.
    store.nodes = [running("n1", "Generate Video"), failed("n2", "Suno Generate")]
    view.rerender(<ConnectProviderWatcher />)
    await waitFor(() => expect(screen.queryByTestId("dialog")).toBeNull())

    // …and fails again. That is a fresh failure and must reopen the dialog.
    store.nodes = [failed("n1", "Generate Video"), failed("n2", "Suno Generate")]
    view.rerender(<ConnectProviderWatcher />)
    const reopened = await screen.findByTestId("dialog")
    expect(reopened.getAttribute("data-label")).toBe("Generate Video")
  })

  it("does nothing when no node has failed", async () => {
    readiness(false)
    store.nodes = [ok("n1", "Generate Video")]
    render(<ConnectProviderWatcher />)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  // The Retry affordance was declared but never passed, so the button never
  // rendered and the dialog dead-ended after a key save (#771 review).
  it("offers Retry that re-runs the node that stopped", async () => {
    readiness(false)
    const runs: string[] = []
    store.runSingleNode = (id) => runs.push(id)
    store.nodes = [failed("n1", "Generate Video")]
    render(<ConnectProviderWatcher />)
    fireEvent.click(await screen.findByTestId("retry"))
    expect(runs).toEqual(["n1"])
  })

  it("hides Retry when the editor registered no runner, rather than offering a no-op", async () => {
    readiness(false)
    store.runSingleNode = null
    store.nodes = [failed("n1", "Generate Video")]
    render(<ConnectProviderWatcher />)
    await screen.findByTestId("dialog")
    expect(screen.queryByTestId("retry")).toBeNull()
  })
})
