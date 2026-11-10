import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import table from "../../../../tools/__tests__/fixtures/route-home-addresses.json"
import { hopAllowed, installPageHomeGuard, pageHomeTarget, proxyMatchPath } from "../page-homes"

const FLOW = "https://flow.example.test"
const APP = "https://app.example.test"
const LEGACY = "app.example.test"
const ON = { flowUiOrigin: FLOW, legacyUiHosts: [LEGACY], linkOrigin: APP }
const at = (pathname: string, search = "", hash = "") => ({ pathname, search, hash })
const onLegacy = { framed: false, origin: APP }
const onFlow = { framed: false, origin: FLOW }

afterEach(() => {
  delete window.__NODARO_RUNTIME__
  vi.unstubAllGlobals()
})

describe("one address table, the proxy's and this guard's (tools/__tests__/fixtures/route-home-addresses.json)", () => {
  beforeEach(() => {
    window.__NODARO_RUNTIME__ = ON
  })

  for (const { path, legacy, flow } of table.addresses) {
    it(`${path}: on a legacy host ${legacy}, on the Flow host ${flow}`, () => {
      expect(pageHomeTarget(at(path, "?q=1"), onLegacy)).toBe(legacy === "move" ? `${FLOW}${path}?q=1` : null)
      expect(pageHomeTarget(at(path, "?q=1"), onFlow)).toBe(flow === "back" ? `${APP}${path}?q=1` : null)
    })
  }
})

describe("proxyMatchPath: a path as the proxy's path matcher compares it", () => {
  it("decodes, lowers case, merges slashes, resolves dot segments and keeps a trailing slash", () => {
    expect(proxyMatchPath("/App%2Fx")).toBe("/app/x")
    expect(proxyMatchPath("//Projects//p1/")).toBe("/projects/p1/")
    expect(proxyMatchPath("/projects/../app/./x")).toBe("/app/x")
    expect(proxyMatchPath("/..")).toBe("/")
    expect(proxyMatchPath("/")).toBe("/")
  })

  it("cannot decode a malformed escape (the proxy refuses that request): null", () => {
    expect(proxyMatchPath("/projects/%E0%A4%A")).toBeNull()
  })
})

describe("pageHomeTarget", () => {
  it("is null on every path when the deployment has no separate app host", () => {
    for (const path of ["/", "/projects", "/app/x", "/login"]) {
      expect(pageHomeTarget(at(path), onLegacy)).toBeNull()
      expect(pageHomeTarget(at(path), onFlow)).toBeNull()
    }
  })

  it("keeps the query and hash of a moved page", () => {
    window.__NODARO_RUNTIME__ = ON
    expect(pageHomeTarget(at("/projects", "?a=1", "#x"), onLegacy)).toBe(`${FLOW}/projects?a=1#x`)
  })

  it("never moves a framed page or a pop-up window: every product's account pop-up frames these", () => {
    window.__NODARO_RUNTIME__ = ON
    expect(pageHomeTarget(at("/billing"), { framed: true, origin: APP })).toBeNull()
    expect(pageHomeTarget(at("/embed/x"), { framed: true, origin: FLOW })).toBeNull()
    vi.stubGlobal("opener", {})
    expect(pageHomeTarget(at("/projects"), { origin: APP })).toBeNull()
  })

  it("a host the deployment does not name is left alone, as the proxy leaves it", () => {
    window.__NODARO_RUNTIME__ = ON
    expect(pageHomeTarget(at("/projects"), { framed: false, origin: "https://sai.example.test" })).toBeNull()
  })

  it("acts only when the move is on as the proxy reads it: a Flow origin, a legacy host that is not the Flow host, and a kept origin", () => {
    for (const runtime of [
      { flowUiOrigin: FLOW, linkOrigin: APP },
      { flowUiOrigin: FLOW, legacyUiHosts: ["flow.example.test"], linkOrigin: APP },
      { flowUiOrigin: FLOW, legacyUiHosts: [LEGACY] },
      { flowUiOrigin: FLOW, legacyUiHosts: [LEGACY], linkOrigin: FLOW },
      { flowUiOrigin: `${FLOW}/`, legacyUiHosts: [LEGACY], linkOrigin: APP },
    ]) {
      window.__NODARO_RUNTIME__ = runtime
      expect(pageHomeTarget(at("/projects"), onLegacy), JSON.stringify(runtime)).toBeNull()
      expect(pageHomeTarget(at("/app/x"), onFlow), JSON.stringify(runtime)).toBeNull()
    }
  })
})

describe("hopAllowed: a loop breaker", () => {
  beforeEach(() => window.sessionStorage.clear())

  it("refuses a second hop to the same address within seconds, so two hosts that disagree cannot bounce a visitor forever", () => {
    expect(hopAllowed(`${FLOW}/projects`, 1_000)).toBe(true)
    expect(hopAllowed(`${FLOW}/projects`, 3_000)).toBe(false)
    expect(hopAllowed(`${FLOW}/billing`, 3_500)).toBe(true)
  })

  it("allows the same hop again after the window", () => {
    expect(hopAllowed(`${FLOW}/projects`, 1_000)).toBe(true)
    expect(hopAllowed(`${FLOW}/projects`, 60_000)).toBe(true)
  })

  it("with no storage there is nothing to remember: the hop goes ahead, and nothing throws", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    })
    expect(hopAllowed(`${FLOW}/projects`, 1_000)).toBe(true)
  })
})

describe("installPageHomeGuard", () => {
  beforeEach(() => window.sessionStorage.clear())

  function fakeRouter(pathname: string) {
    const listeners: Array<(state: { location: ReturnType<typeof at> }) => void> = []
    const state = { location: at(pathname) }
    return {
      state,
      subscribe: (fn: (s: typeof state) => void) => void listeners.push(fn),
      navigate: (p: string) => {
        state.location = at(p)
        for (const fn of listeners) fn(state)
      },
    }
  }

  it("does nothing on a deployment without the move: no listener, no redirect", () => {
    const router = fakeRouter("/projects")
    const subscribe = vi.spyOn(router, "subscribe")
    const leave = vi.fn()
    installPageHomeGuard(router, leave)
    expect(subscribe).not.toHaveBeenCalled()
    expect(leave).not.toHaveBeenCalled()
  })

  it("on a named legacy host, a sign-in that lands on /projects leaves for the Flow host, once", () => {
    window.__NODARO_RUNTIME__ = { ...ON, legacyUiHosts: [window.location.hostname] }
    const router = fakeRouter("/login")
    const leave = vi.fn()
    installPageHomeGuard(router, leave)
    expect(leave).not.toHaveBeenCalled()
    router.navigate("/projects")
    expect(leave).toHaveBeenCalledWith(`${FLOW}/projects`)
    router.navigate("/projects")
    expect(leave).toHaveBeenCalledTimes(1)
  })
})
