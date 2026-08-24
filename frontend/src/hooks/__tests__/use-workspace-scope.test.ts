import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"

/**
 * The one fact every scoped list reads.
 *
 * Both halves of a scoped query come from here in the same render — the cache
 * key and the row filter — so what this returns decides whether a list can
 * ever be labelled one workspace while holding another's rows.
 */

const mockHasOrganizations = vi.fn(() => true)
vi.mock("@/lib/edition", () => ({ hasOrganizations: () => mockHasOrganizations() }))

import { useWorkspaceScope } from "../use-workspace-scope"
import { awaitWorkspaceScope, hydrateWorkspaces, resetWorkspaceState, setActiveWorkspace } from "@/lib/workspace-context"

const WS = "b0000000-0000-4000-8000-000000000001"

beforeEach(() => {
  mockHasOrganizations.mockReturnValue(true)
  resetWorkspaceState()
  window.localStorage.clear()
})

afterEach(() => {
  resetWorkspaceState()
})

describe("awaitWorkspaceScope", () => {
  it("returns at once when organizations are off", async () => {
    mockHasOrganizations.mockReturnValue(false)
    await expect(awaitWorkspaceScope()).resolves.toBeUndefined()
  })

  it("WAITS for a hydration already in flight", async () => {
    // The half a plain function needs, since it has no render to hold. A
    // store that does not wait fills its list with private work while the
    // person is standing in a class — the same defect the React side holds
    // behind `ready`.
    let release: (v: unknown) => void = () => {}
    const inFlight = new Promise((r) => { release = r })
    vi.stubGlobal("fetch", vi.fn(() => inFlight.then(() => ({
      ok: true,
      json: async () => ({ data: { organizations: [], workspaces: [] } }),
    }))))

    const hydration = hydrateWorkspaces()
    let settled = false
    const waiter = awaitWorkspaceScope().then(() => { settled = true })

    // Give the microtask queue a turn: without a real wait it resolves here.
    await Promise.resolve()
    await Promise.resolve()
    expect(settled, "resolved before hydration finished").toBe(false)

    release(null)
    await hydration
    await waiter
    expect(settled).toBe(true)
    vi.unstubAllGlobals()
  })
})

describe("useWorkspaceScope", () => {
  it("is the personal space, settled, when organizations are off", () => {
    // Every other edition. Nothing to wait for, so a hook that held here would
    // freeze every list on installs that have no workspaces at all.
    mockHasOrganizations.mockReturnValue(false)
    const { result } = renderHook(() => useWorkspaceScope())
    expect(result.current).toEqual({ workspaceId: null, ready: true })
  })

  it("holds while the remembered selection is still unconfirmed", () => {
    // A workspace id in this browser's storage is not yet a workspace: the
    // server has to confirm the caller still belongs to it. Answering
    // "personal" in the meantime is what makes a reload inside a class paint
    // the person's private work first.
    const { result } = renderHook(() => useWorkspaceScope())
    expect(result.current.ready).toBe(false)
  })

  it("reports the workspace once one is selected", () => {
    const { result, rerender } = renderHook(() => useWorkspaceScope())
    setActiveWorkspace(WS)
    rerender()
    expect(result.current.workspaceId).toBe(WS)
  })

  it("re-renders on a switch — the subscription is the point", () => {
    // Without it a component would keep its first key forever and go on
    // showing the previous workspace with nothing to say so.
    const { result, rerender } = renderHook(() => useWorkspaceScope())
    setActiveWorkspace(WS)
    rerender()
    expect(result.current.workspaceId).toBe(WS)
    setActiveWorkspace(null)
    rerender()
    expect(result.current.workspaceId).toBeNull()
  })

  it("never reports a workspace when organizations are off, whatever was stored", () => {
    // The flag is the outer gate. A value left in storage from a cloud session
    // must not leak into a self-hosted build.
    setActiveWorkspace(WS)
    mockHasOrganizations.mockReturnValue(false)
    const { result } = renderHook(() => useWorkspaceScope())
    expect(result.current.workspaceId).toBeNull()
  })
})
