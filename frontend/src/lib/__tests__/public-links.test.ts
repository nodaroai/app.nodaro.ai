import { describe, it, expect, afterEach } from "vitest"
import { embedPageUrl, presentationShareUrl, publicLinkOrigin, publishedAppUrl } from "../public-links"

const FLOW = "https://flow.example.test"
const APP = "https://app.example.test"
const ON = { linkOrigin: APP, flowUiOrigin: FLOW, legacyUiHosts: ["app.example.test"] }

describe("public links", () => {
  afterEach(() => {
    delete window.__NODARO_RUNTIME__
  })

  it("name the page's own origin on a one-host deployment (no setting: exactly as before)", () => {
    expect(publicLinkOrigin()).toBe(window.location.origin)
    expect(publishedAppUrl("my-app")).toBe(`${window.location.origin}/app/my-app`)
    expect(embedPageUrl("my-app")).toBe(`${window.location.origin}/embed/my-app`)
    expect(presentationShareUrl("t1")).toBe(`${window.location.origin}/present/t1`)
  })

  it("name the deployment's public host, never the Flow host, when the app's pages have moved", () => {
    window.__NODARO_RUNTIME__ = ON
    expect(publicLinkOrigin(FLOW)).toBe(APP)
    expect(publicLinkOrigin(APP)).toBe(APP)
    expect(publishedAppUrl("my-app", FLOW)).toBe("https://app.example.test/app/my-app")
    expect(embedPageUrl("my-app", FLOW)).toBe("https://app.example.test/embed/my-app")
    expect(presentationShareUrl("t1", FLOW)).toBe("https://app.example.test/present/t1")
  })

  it("on a host the deployment does not name (another name the service answers on), name that page's own origin, as before", () => {
    window.__NODARO_RUNTIME__ = ON
    expect(publicLinkOrigin("https://sai.example.test")).toBe("https://sai.example.test")
    expect(publishedAppUrl("x", "https://sai.example.test")).toBe("https://sai.example.test/app/x")
  })

  it("never use a malformed or insecure link origin, or one without the rest of the move", () => {
    window.__NODARO_RUNTIME__ = { ...ON, linkOrigin: "http://insecure.example.test" }
    expect(publishedAppUrl("x")).toBe(`${window.location.origin}/app/x`)
    window.__NODARO_RUNTIME__ = { linkOrigin: APP }
    expect(publishedAppUrl("x")).toBe(`${window.location.origin}/app/x`)
  })
})
