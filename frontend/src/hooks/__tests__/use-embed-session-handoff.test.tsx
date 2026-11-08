import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, renderHook } from "@testing-library/react"

const setAuthFromTokens = vi.fn(async (_access: string, _refresh: string) => {})
vi.mock("@/hooks/use-auth", () => ({
  setAuthFromTokens: (access: string, refresh: string) => setAuthFromTokens(access, refresh),
}))
// The real check, spied on: the hook must hand it this page's own origin.
vi.mock("@/lib/embed-origins", async (orig) => {
  const real = await orig<typeof import("@/lib/embed-origins")>()
  return { ...real, classifyEmbedSessionMessage: vi.fn(real.classifyEmbedSessionMessage) }
})

import { useEmbedSessionHandoff } from "../use-embed-session-handoff"
import { classifyEmbedSessionMessage } from "@/lib/embed-origins"

/**
 * When the app runs framed inside another Nodaro surface, the page that frames
 * it hands over the session with a `message`. Any window able to post to the
 * frame can send one, so only the frame's own parent, on a first-party origin,
 * may hand over a session, and never a host that serves stored files (anyone
 * can put a page there). Everything else is ignored and changes nothing.
 */
describe("useEmbedSessionHandoff", () => {
  const PARENT_ORIGIN = "https://studio.nodaro.ai"
  const handOver = { type: "nodaro:setSession", access_token: "access-1", refresh_token: "refresh-1" }

  /** The page that frames this one. */
  let parent: { postMessage: ReturnType<typeof vi.fn> }
  const undo: Array<() => void> = []

  /** Replace a window property for one test, and put it back afterwards. */
  function override(key: "parent" | "self", value: unknown) {
    const before = Object.getOwnPropertyDescriptor(window, key)
    Object.defineProperty(window, key, { configurable: true, value })
    undo.push(() => {
      if (before) Object.defineProperty(window, key, before)
    })
  }

  beforeEach(() => {
    setAuthFromTokens.mockClear()
    parent = { postMessage: vi.fn() }
    // Framed: `parent` is the embedding page, and `self` is no longer `top`.
    override("parent", parent)
    override("self", {})
  })

  afterEach(() => {
    while (undo.length) undo.pop()!()
  })

  /** Deliver a `message` event the way the browser does: `source` is the window that sent it. */
  function deliver(data: unknown, { origin = PARENT_ORIGIN, source = parent as unknown } = {}) {
    const event = new MessageEvent("message", { data, origin })
    // jsdom's constructor only takes a real window as `source`.
    Object.defineProperty(event, "source", { value: source })
    act(() => {
      window.dispatchEvent(event)
    })
  }

  it("announces itself to the parent, and adopts the session the parent hands over", () => {
    renderHook(() => useEmbedSessionHandoff())
    expect(parent.postMessage).toHaveBeenCalledWith({ type: "nodaro:embedReady" }, "*")

    deliver(handOver)
    expect(setAuthFromTokens).toHaveBeenCalledTimes(1)
    expect(setAuthFromTokens).toHaveBeenCalledWith("access-1", "refresh-1")
  })

  it("ignores a session handed over by a window that is not the parent", () => {
    renderHook(() => useEmbedSessionHandoff())
    const anotherWindow = { postMessage: vi.fn() }

    deliver(handOver, { origin: "https://recast.nodaro.ai", source: anotherWindow })
    expect(setAuthFromTokens).not.toHaveBeenCalled()
  })

  it("ignores a session from the parent's own origin that the parent did not send", () => {
    renderHook(() => useEmbedSessionHandoff())
    const siblingFrame = { postMessage: vi.fn() }

    deliver(handOver, { source: siblingFrame })
    deliver(handOver, { source: null })
    expect(setAuthFromTokens).not.toHaveBeenCalled()

    // The parent's own hand-over still lands.
    deliver(handOver)
    expect(setAuthFromTokens).toHaveBeenCalledTimes(1)
  })

  it("never takes a session from a host that serves stored files, even as the parent", () => {
    renderHook(() => useEmbedSessionHandoff())

    deliver(handOver, { origin: "https://cdn.nodaro.ai" })
    deliver(handOver, { origin: "https://assets.nodaro.ai" })
    expect(setAuthFromTokens).not.toHaveBeenCalled()
  })

  it("stops waiting only when the parent itself says it has no session", () => {
    const { result } = renderHook(() => useEmbedSessionHandoff())
    expect(result.current.awaitingHandoff).toBe(true)

    deliver({ type: "nodaro:noSession" }, { source: { postMessage: vi.fn() } })
    deliver({ type: "nodaro:noSession" }, { origin: "https://cdn.nodaro.ai" })
    expect(result.current.awaitingHandoff).toBe(true)

    deliver({ type: "nodaro:noSession" })
    expect(result.current.awaitingHandoff).toBe(false)
  })

  it("ignores a hand-over that is missing a token or has another shape", () => {
    renderHook(() => useEmbedSessionHandoff())

    deliver({ ...handOver, refresh_token: undefined })
    deliver({ ...handOver, access_token: 42 })
    deliver({ ...handOver, access_token: "" })
    deliver({ type: "nodaro:somethingElse", access_token: "a", refresh_token: "r" })
    deliver("nodaro:setSession")
    deliver(null)
    expect(setAuthFromTokens).not.toHaveBeenCalled()
  })

  // A product on this page's own origin (one host serving every product)
  // frames an account page: the check is told this page's origin.
  it("hands the check this page's own origin", () => {
    renderHook(() => useEmbedSessionHandoff())
    deliver(handOver)
    expect(vi.mocked(classifyEmbedSessionMessage)).toHaveBeenLastCalledWith(
      expect.objectContaining({ origin: PARENT_ORIGIN }),
      parent,
      { selfOrigin: window.location.origin },
    )
  })
})
