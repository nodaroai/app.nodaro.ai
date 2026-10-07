/**
 * Which Edit Plan modes this server can plan (GET /v1/edit-plan/capabilities).
 *
 * Trailer is greyed out until the server says its plugin plans it. The default
 * direction is "not yet": before the answer lands, after a failed fetch, and on
 * an older backend without the route, Trailer stays greyed out. The three
 * Phase-1 modes are never greyed out.
 */
import { describe, it, expect, afterEach, vi } from "vitest"
import {
  editPlanModeUnavailableReason,
  isEditPlanModeSupported,
  loadEditPlanModes,
  refreshEditPlanModesIfStale,
  watchEditPlanModes,
  EDIT_PLAN_MODES_MAX_AGE_MS,
  __setEditPlanModesForTests,
} from "../edit-plan-modes"

const headers = async () => ({ Authorization: "Bearer t" })

afterEach(() => {
  __setEditPlanModesForTests(null)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const answer = (modes: string[]) => vi.fn(async () => new Response(JSON.stringify({ modes })))

describe("edit-plan-modes", () => {
  it("before the answer: the Phase-1 modes are offered, Trailer is not", () => {
    for (const m of ["tighten", "clips", "chapters"]) expect(isEditPlanModeSupported(m)).toBe(true)
    expect(isEditPlanModeSupported("trailer")).toBe(false)
  })

  it("offers Trailer once the server lists it", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ modes: ["tighten", "clips", "chapters", "trailer"] })))
    vi.stubGlobal("fetch", fetchMock)
    await loadEditPlanModes(headers)
    expect(fetchMock).toHaveBeenCalledWith("/v1/edit-plan/capabilities", { headers: { Authorization: "Bearer t" } })
    expect(isEditPlanModeSupported("trailer")).toBe(true)
  })

  it("keeps Trailer greyed out when the server does not list it (older plugin, community)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ modes: ["tighten", "clips", "chapters"] }))))
    await loadEditPlanModes(headers)
    expect(isEditPlanModeSupported("trailer")).toBe(false)
    expect(isEditPlanModeSupported("tighten")).toBe(true)
  })

  it("keeps Trailer greyed out on an error answer or a network failure, and never greys a Phase-1 mode", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })))
    await loadEditPlanModes(headers)
    expect(isEditPlanModeSupported("trailer")).toBe(false)

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline") }))
    await loadEditPlanModes(headers)
    expect(isEditPlanModeSupported("trailer")).toBe(false)
    expect(isEditPlanModeSupported("clips")).toBe(true)
  })

  it("a malformed answer never greys out a Phase-1 mode", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ modes: ["trailer"] }))))
    await loadEditPlanModes(headers)
    expect(isEditPlanModeSupported("trailer")).toBe(true)
    expect(isEditPlanModeSupported("tighten")).toBe(true)
  })

  // R6-1: a connected self-host's answer follows nodaro.ai's, so it can change
  // while a session is open. The editor asks again — at most once per
  // EDIT_PLAN_MODES_MAX_AGE_MS — when the panel opens or the tab regains focus.
  describe("refreshing a stale answer", () => {
    it("asks again once the answer is older than the max age, and not before", async () => {
      vi.useFakeTimers({ toFake: ["Date"] })
      const first = answer(["tighten", "clips", "chapters"])
      vi.stubGlobal("fetch", first)
      await loadEditPlanModes(headers)
      expect(isEditPlanModeSupported("trailer")).toBe(false)

      const second = answer(["tighten", "clips", "chapters", "trailer"])
      vi.stubGlobal("fetch", second)
      vi.advanceTimersByTime(EDIT_PLAN_MODES_MAX_AGE_MS - 1)
      await refreshEditPlanModesIfStale()
      expect(second).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      await refreshEditPlanModesIfStale()
      expect(second).toHaveBeenCalledWith("/v1/edit-plan/capabilities", { headers: { Authorization: "Bearer t" } })
      expect(isEditPlanModeSupported("trailer")).toBe(true)
    })

    it("a failed attempt also counts, so an outage is not hammered", async () => {
      vi.useFakeTimers({ toFake: ["Date"] })
      const failing = vi.fn(async () => { throw new TypeError("offline") })
      vi.stubGlobal("fetch", failing)
      await loadEditPlanModes(headers)
      await refreshEditPlanModesIfStale()
      expect(failing).toHaveBeenCalledTimes(1)
    })

    it("does nothing before a signed-in session has loaded the answer once", async () => {
      const fetchMock = answer(["tighten", "clips", "chapters", "trailer"])
      vi.stubGlobal("fetch", fetchMock)
      await refreshEditPlanModesIfStale()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("the session watcher loads at once, refreshes a stale answer when the window regains focus, and stops when disposed", async () => {
      vi.useFakeTimers({ toFake: ["Date"] })
      const first = answer(["tighten", "clips", "chapters"])
      vi.stubGlobal("fetch", first)
      const stop = watchEditPlanModes(headers)
      await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1))

      const second = answer(["tighten", "clips", "chapters", "trailer"])
      vi.stubGlobal("fetch", second)
      window.dispatchEvent(new Event("focus"))
      expect(second).not.toHaveBeenCalled() // still fresh

      vi.advanceTimersByTime(EDIT_PLAN_MODES_MAX_AGE_MS)
      window.dispatchEvent(new Event("focus"))
      await vi.waitFor(() => expect(isEditPlanModeSupported("trailer")).toBe(true))
      expect(second).toHaveBeenCalledTimes(1)

      stop()
      vi.advanceTimersByTime(EDIT_PLAN_MODES_MAX_AGE_MS)
      window.dispatchEvent(new Event("focus"))
      await Promise.resolve()
      expect(second).toHaveBeenCalledTimes(1)
    })
  })
})

// Round 7 (decided 2026-10-06): the reason a greyed-out mode shows depends on
// who answered. The server says so (`source`); the list itself — what is greyed
// out — is unchanged and still fails closed.
describe("editPlanModeUnavailableReason", () => {
  const load = async (body: unknown) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body))))
    await loadEditPlanModes(headers)
  }
  const PHASE1 = ["tighten", "clips", "chapters"]

  it("is null for a mode the server plans, and for every Phase-1 mode", async () => {
    await load({ modes: [...PHASE1, "trailer"], source: "nodaro.ai" })
    expect(editPlanModeUnavailableReason("trailer")).toBeNull()
    for (const m of PHASE1) expect(editPlanModeUnavailableReason(m)).toBeNull()
  })

  it("nodaro.ai (the server plans for itself): needs a plugin update", async () => {
    await load({ modes: PHASE1, source: "server" })
    expect(editPlanModeUnavailableReason("trailer")).toBe("plugin-update")
  })

  it("a connected self-host whose nodaro.ai does not plan it yet: available once nodaro.ai supports it", async () => {
    await load({ modes: PHASE1, source: "nodaro.ai" })
    expect(editPlanModeUnavailableReason("trailer")).toBe("nodaro-unsupported")
    expect(isEditPlanModeSupported("trailer")).toBe(false)
  })

  it("a connected self-host that can't reach nodaro.ai: couldn't reach nodaro.ai", async () => {
    await load({ modes: PHASE1, source: "nodaro.ai-unreachable" })
    expect(editPlanModeUnavailableReason("trailer")).toBe("nodaro-unreachable")
    expect(isEditPlanModeSupported("trailer")).toBe(false)
  })

  it("no answer yet, an older backend without `source`, or an unknown source: needs a plugin update", async () => {
    expect(editPlanModeUnavailableReason("trailer")).toBe("plugin-update")
    await load({ modes: PHASE1 })
    expect(editPlanModeUnavailableReason("trailer")).toBe("plugin-update")
    await load({ modes: PHASE1, source: "elsewhere" })
    expect(editPlanModeUnavailableReason("trailer")).toBe("plugin-update")
  })

  it("the test seam sets who answered", () => {
    __setEditPlanModesForTests(PHASE1, "nodaro.ai-unreachable")
    expect(editPlanModeUnavailableReason("trailer")).toBe("nodaro-unreachable")
    __setEditPlanModesForTests(null)
    expect(editPlanModeUnavailableReason("trailer")).toBe("plugin-update")
  })
})
