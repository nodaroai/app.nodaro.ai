import { describe, it, expect, afterEach } from "vitest"
import { DEFAULT_FREECUT_URL, runtimeFreecutUrl, runtimeFreecutOrigin } from "../runtime-config"

/**
 * The editor URL used to be inlined by Vite with a `http://localhost:5174`
 * fallback — a dev server on a developer's laptop, which is what every
 * self-hoster's "Edit video" button pointed at. It is now a runtime value so an
 * install can repoint it (or switch it off) without rebuilding the image (#767).
 */
function setRuntime(freecutUrl?: string) {
  window.__NODARO_RUNTIME__ = freecutUrl === undefined ? {} : { freecutUrl }
}

describe("runtimeFreecutUrl", () => {
  afterEach(() => {
    delete window.__NODARO_RUNTIME__
  })

  it("defaults to the hosted editor when nothing is configured", () => {
    setRuntime()
    expect(runtimeFreecutUrl()).toBe(DEFAULT_FREECUT_URL)
  })

  it("never falls back to a dev-server URL", () => {
    setRuntime()
    expect(runtimeFreecutUrl()).not.toContain("localhost")
  })

  it("uses an operator's own editor when one is configured", () => {
    setRuntime("https://freecut.example.internal")
    expect(runtimeFreecutUrl()).toBe("https://freecut.example.internal")
  })

  it("trims surrounding whitespace rather than producing an unusable URL", () => {
    setRuntime("  https://freecut.example.internal  ")
    expect(runtimeFreecutUrl()).toBe("https://freecut.example.internal")
  })

  // An empty value means "no preference" and must NOT disable the feature —
  // otherwise every install that declares the var without setting it loses the
  // editor silently.
  it("treats an empty value as unset, not as off", () => {
    setRuntime("   ")
    expect(runtimeFreecutUrl()).toBe(DEFAULT_FREECUT_URL)
  })

  it.each(["off", "OFF", " none ", "false", "disabled"])(
    "treats %j as an explicit opt-out so callers can hide the action",
    (value) => {
      setRuntime(value)
      expect(runtimeFreecutUrl()).toBe("")
    },
  )
})

describe("runtimeFreecutOrigin", () => {
  afterEach(() => {
    delete window.__NODARO_RUNTIME__
  })

  // The origin is the postMessage security check. Deriving it from the same
  // getter is what stops a URL and an origin from disagreeing — which would
  // drop every inbound message silently.
  it("is the origin of the URL actually being framed", () => {
    setRuntime("https://freecut.example.internal/editor?x=1")
    expect(runtimeFreecutOrigin()).toBe("https://freecut.example.internal")
  })

  it("matches the default URL's origin when unconfigured", () => {
    setRuntime()
    expect(runtimeFreecutOrigin()).toBe(new URL(DEFAULT_FREECUT_URL).origin)
  })

  it("is empty when the editor is switched off, so nothing is trusted", () => {
    setRuntime("off")
    expect(runtimeFreecutOrigin()).toBe("")
  })

  // A junk value must not resolve against the page — new URL(junk, location.href)
  // succeeds by treating it as a relative path, which would make the editor our
  // OWN origin and have the postMessage check trust messages from ourselves.
  it("falls back to the default for a value that is not an absolute http URL", () => {
    setRuntime("::::not a url")
    expect(runtimeFreecutUrl()).toBe(DEFAULT_FREECUT_URL)
    expect(runtimeFreecutOrigin()).toBe(new URL(DEFAULT_FREECUT_URL).origin)
  })

  it("rejects a same-origin relative path", () => {
    setRuntime("/editor")
    expect(runtimeFreecutUrl()).toBe(DEFAULT_FREECUT_URL)
  })
})
