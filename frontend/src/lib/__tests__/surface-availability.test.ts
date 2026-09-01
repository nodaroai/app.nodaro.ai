import { describe, it, expect, afterEach } from "vitest"
import {
  isNodeUnavailable,
  isModelUnavailable,
  __resetSurfaceAvailabilityForTests,
} from "../surface-availability"

afterEach(() => {
  __resetSurfaceAvailabilityForTests(null)
  delete window.__NODARO_RUNTIME__
})

describe("surface-availability — fetched effective set with static-profile fallback", () => {
  it("pre-fetch: falls back to the static profile's explicit deny only", () => {
    window.__NODARO_RUNTIME__ = { surface: { nodes: { deny: ["suno-generate"], allow: ["generate-image"] } } }
    expect(isNodeUnavailable("suno-generate")).toBe(true)
    // allow-inversion is deliberately NOT applied client-side pre-fetch — the
    // gateable-universe scoping lives backend-side; a brief over-show is
    // harmless because the backend refuses at write/run.
    expect(isNodeUnavailable("generate-video")).toBe(false)
  })

  it("post-fetch: the fetched effective set replaces the fallback entirely", () => {
    window.__NODARO_RUNTIME__ = { surface: { nodes: { deny: ["suno-generate"], allow: [] } } }
    __resetSurfaceAvailabilityForTests({ nodes: ["generate-video"], models: ["kling"] })
    expect(isNodeUnavailable("generate-video")).toBe(true)
    // The fetched set is the whole answer — a profile deny the server no
    // longer reports (e.g. lifted by an admin override) stops hiding.
    expect(isNodeUnavailable("suno-generate")).toBe(false)
    expect(isModelUnavailable("kling")).toBe(true)
    expect(isModelUnavailable("flux")).toBe(false)
  })

  it("models pre-fetch fallback mirrors nodes", () => {
    window.__NODARO_RUNTIME__ = { surface: { models: { deny: ["kling"], allow: [] } } }
    expect(isModelUnavailable("kling")).toBe(true)
    expect(isModelUnavailable("flux")).toBe(false)
  })
})
