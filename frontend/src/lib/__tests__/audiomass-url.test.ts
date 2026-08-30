import { describe, it, expect, afterEach } from "vitest"
import { DEFAULT_AUDIOMASS_URL, runtimeAudiomassUrl, runtimeAudiomassOrigin } from "../runtime-config"

/**
 * The AudioMass editor URL used to be inlined by Vite with a
 * `http://localhost:5175` fallback — a dev server on a developer's laptop,
 * which is broken on every deployed install. It is now a runtime value so a
 * tenant / self-hoster can point it at their own AudioMass (or leave it off)
 * without rebuilding the image, mirroring FreeCut (#767).
 *
 * Unlike FreeCut there is no public hosted AudioMass, so the default is ""
 * (disabled) rather than a hosted URL: an unconfigured install has no editor
 * and the modal says so, instead of framing a dead localhost frame.
 */
function setRuntime(audiomassUrl?: string) {
  window.__NODARO_RUNTIME__ = audiomassUrl === undefined ? {} : { audiomassUrl }
}

describe("runtimeAudiomassUrl", () => {
  afterEach(() => {
    delete window.__NODARO_RUNTIME__
  })

  it("is disabled ('') when nothing is configured — there is no hosted default", () => {
    setRuntime()
    expect(DEFAULT_AUDIOMASS_URL).toBe("")
    expect(runtimeAudiomassUrl()).toBe("")
  })

  it("never falls back to a dev-server URL", () => {
    setRuntime()
    expect(runtimeAudiomassUrl()).not.toContain("localhost")
  })

  it("uses an operator's own editor when one is configured", () => {
    setRuntime("https://audiomass.example.internal")
    expect(runtimeAudiomassUrl()).toBe("https://audiomass.example.internal")
  })

  it("trims surrounding whitespace rather than producing an unusable URL", () => {
    setRuntime("  https://audiomass.example.internal  ")
    expect(runtimeAudiomassUrl()).toBe("https://audiomass.example.internal")
  })

  // An empty value is "no preference"; with no hosted default that resolves to
  // disabled — but it is NOT a silent regression the way it was for FreeCut,
  // because there was never a working hosted editor to remove.
  it("treats an empty value as unset → disabled", () => {
    setRuntime("   ")
    expect(runtimeAudiomassUrl()).toBe("")
  })

  it.each(["off", "OFF", " none ", "false", "disabled"])(
    "treats %j as an explicit opt-out so callers can hide the action",
    (value) => {
      setRuntime(value)
      expect(runtimeAudiomassUrl()).toBe("")
    },
  )

  // A junk value must not resolve against the page — new URL(junk, location.href)
  // succeeds by treating it as a relative path, which would make the editor our
  // OWN origin and have the postMessage check trust messages from ourselves.
  it("returns '' for a value that is not an absolute http URL", () => {
    setRuntime("::::not a url")
    expect(runtimeAudiomassUrl()).toBe("")
  })

  it("rejects a same-origin relative path", () => {
    setRuntime("/editor")
    expect(runtimeAudiomassUrl()).toBe("")
  })
})

describe("runtimeAudiomassOrigin", () => {
  afterEach(() => {
    delete window.__NODARO_RUNTIME__
  })

  // The origin is the postMessage security check. Deriving it from the same
  // getter is what stops a URL and an origin from disagreeing — which would
  // drop every inbound message silently.
  it("is the origin of the URL actually being framed", () => {
    setRuntime("https://audiomass.example.internal/editor?x=1")
    expect(runtimeAudiomassOrigin()).toBe("https://audiomass.example.internal")
  })

  it("is empty when no editor is configured, so nothing is trusted", () => {
    setRuntime()
    expect(runtimeAudiomassOrigin()).toBe("")
  })

  it("is empty when the editor is switched off", () => {
    setRuntime("off")
    expect(runtimeAudiomassOrigin()).toBe("")
  })
})
