import { describe, it, expect, afterEach, vi } from "vitest"

import { rememberSiblingOrigin, rememberedSiblingOrigin, resolveSiblingUrl, ssoEntryPath } from "@/lib/sibling-origin"
import { otherNodaroApps } from "@/lib/nodaro-apps"
import type { SurfaceSibling } from "@/lib/surface-profile"

const CHAT: SurfaceSibling = {
  label: "Chat",
  url: "https://a.example",
  urlByHost: { "studio.b.example": "https://b.example" },
}

function setup({ host, referrer, siblings = [CHAT] }: { host: string; referrer?: string; siblings?: SurfaceSibling[] }) {
  window.__NODARO_RUNTIME__ = { surface: { siblings: { apps: siblings }, brand: { productName: "X", platformLinks: false } } }
  vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, hostname: host } as Location)
  vi.spyOn(document, "referrer", "get").mockReturnValue(referrer ?? "")
}

afterEach(() => {
  vi.restoreAllMocks()
  delete window.__NODARO_RUNTIME__
  window.localStorage.clear()
})

describe("resolveSiblingUrl — the configured URL per hostname", () => {
  it("uses urlByHost for a mapped hostname", () => {
    setup({ host: "studio.b.example" })
    expect(resolveSiblingUrl(CHAT)).toBe("https://b.example")
  })

  it("falls back to url for any other hostname", () => {
    setup({ host: "studio.a.example" })
    expect(resolveSiblingUrl(CHAT)).toBe("https://a.example")
  })

  it("never reads an inherited key", () => {
    setup({ host: "constructor" })
    expect(resolveSiblingUrl(CHAT)).toBe("https://a.example")
  })
})

describe("rememberSiblingOrigin — the site the user came from", () => {
  it("remembers a community subdomain of this host's sibling and moves the link onto it", () => {
    setup({ host: "studio.b.example", referrer: "https://gur.b.example/" })
    rememberSiblingOrigin()
    expect(rememberedSiblingOrigin()).toBe("https://gur.b.example")
    expect(resolveSiblingUrl(CHAT)).toBe("https://gur.b.example/")
    expect(ssoEntryPath("librechat")).toBe("/v1/sso/librechat?via=https%3A%2F%2Fgur.b.example")
  })

  it("remembers the sibling's own host too", () => {
    setup({ host: "studio.b.example", referrer: "https://b.example/" })
    rememberSiblingOrigin()
    expect(rememberedSiblingOrigin()).toBe("https://b.example")
  })

  it.each([
    ["no referrer", ""],
    ["the studio itself (a re-login round trip)", "https://studio.b.example/login"],
    ["another sibling family", "https://gur.a.example/"],
    ["an unrelated site", "https://evil.test/"],
    ["a look-alike suffix", "https://evilb.example/"],
    ["plain http", "http://gur.b.example/"],
  ])("ignores %s and keeps what is stored", (_label, referrer) => {
    window.localStorage.setItem("nodaro.siblingOrigin", "https://kept.b.example")
    setup({ host: "studio.b.example", referrer })
    rememberSiblingOrigin()
    expect(rememberedSiblingOrigin()).toBe("https://kept.b.example")
  })

  it("ignores everything when the deployment configures no siblings", () => {
    setup({ host: "app.example", referrer: "https://studio.example/", siblings: [] })
    rememberSiblingOrigin()
    expect(rememberedSiblingOrigin()).toBeNull()
    expect(ssoEntryPath("x")).toBe("/v1/sso/x")
  })

  it("does not move a link onto an origin outside it", () => {
    // Remembered on the b family; the a family's link stays configured.
    window.localStorage.setItem("nodaro.siblingOrigin", "https://gur.b.example")
    setup({ host: "studio.a.example" })
    expect(resolveSiblingUrl(CHAT)).toBe("https://a.example")
  })

  it("ignores a tampered stored value", () => {
    window.localStorage.setItem("nodaro.siblingOrigin", "javascript:alert(1)")
    setup({ host: "studio.b.example" })
    expect(rememberedSiblingOrigin()).toBeNull()
    expect(resolveSiblingUrl(CHAT)).toBe("https://b.example")
    expect(ssoEntryPath("librechat")).toBe("/v1/sso/librechat")
  })

  it("survives blocked storage", () => {
    setup({ host: "studio.b.example", referrer: "https://gur.b.example/" })
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    expect(() => rememberSiblingOrigin()).not.toThrow()
    expect(resolveSiblingUrl(CHAT)).toBe("https://b.example")
  })
})

describe("otherNodaroApps — the sidebar list", () => {
  it("renders the resolved URL", () => {
    window.localStorage.setItem("nodaro.siblingOrigin", "https://gur.b.example")
    setup({ host: "studio.b.example" })
    expect(otherNodaroApps("flow")).toEqual([{ label: "Chat", url: "https://gur.b.example/" }])
  })
})
