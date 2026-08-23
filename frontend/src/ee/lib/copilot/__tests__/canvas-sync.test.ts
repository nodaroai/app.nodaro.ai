/**
 * The fallback in `ensureCanvasVersion` is the difference between the chat
 * claiming "Added 3 nodes" over an empty canvas and the user actually seeing
 * them, so each branch gets a test — including the one where we deliberately
 * do NOT adopt the remote graph because it would eat the user's edits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const reconcileFromRemote = vi.fn()
const state = {
  loadedVersion: 6 as number | null,
  isDirty: false,
  reconcileFromRemote,
}

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => state },
}))
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({}) }))

const { ensureCanvasVersion, focusNodes } = await import("../canvas-sync")

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(state, { loadedVersion: 6, isDirty: false })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ensureCanvasVersion", () => {
  it("returns immediately when realtime already delivered the version", async () => {
    state.loadedVersion = 7
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    await expect(ensureCanvasVersion("wf-1", 7)).resolves.toBe("realtime")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("treats a newer canvas as satisfied — versions only move forward", async () => {
    state.loadedVersion = 9
    await expect(ensureCanvasVersion("wf-1", 7)).resolves.toBe("realtime")
  })

  it("fetches the row when realtime never arrives", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: { nodes: [{ id: "n1" }], edges: [], updatedAt: "2026-08-23T00:00:00Z", version: 7 },
        }),
      })),
    )

    await expect(ensureCanvasVersion("wf-1", 7)).resolves.toBe("fetched")
    expect(reconcileFromRemote).toHaveBeenCalledWith(
      expect.objectContaining({ version: 7, nodes: [{ id: "n1" }] }),
    )
  }, 10_000)

  it("refuses to adopt a remote graph over unsaved local edits", async () => {
    state.isDirty = true
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    await expect(ensureCanvasVersion("wf-1", 7)).resolves.toBe("dirty")
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(reconcileFromRemote).not.toHaveBeenCalled()
  }, 10_000)

  it("reports failure rather than reconciling a malformed row", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { version: 7 } }) })))

    await expect(ensureCanvasVersion("wf-1", 7)).resolves.toBe("failed")
    expect(reconcileFromRemote).not.toHaveBeenCalled()
  }, 10_000)

  it("reports failure on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    await expect(ensureCanvasVersion("wf-1", 7)).resolves.toBe("failed")
  }, 10_000)

  it("gives up quietly when the turn was aborted while waiting", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(ensureCanvasVersion("wf-1", 7, controller.signal)).resolves.toBe("failed")
  })
})

describe("focusNodes", () => {
  it("asks the canvas to frame the nodes instead of touching React Flow directly", () => {
    const listener = vi.fn()
    window.addEventListener("nodaro:focus-nodes", listener)
    focusNodes(["n1", "n2"])
    window.removeEventListener("nodaro:focus-nodes", listener)

    expect(listener).toHaveBeenCalledOnce()
    expect((listener.mock.calls[0]![0] as CustomEvent).detail).toEqual({ nodeIds: ["n1", "n2"] })
  })

  it("stays silent when there is nothing to show", () => {
    const listener = vi.fn()
    window.addEventListener("nodaro:focus-nodes", listener)
    focusNodes([])
    window.removeEventListener("nodaro:focus-nodes", listener)
    expect(listener).not.toHaveBeenCalled()
  })
})
