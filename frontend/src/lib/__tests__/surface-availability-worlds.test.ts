import { afterEach, describe, expect, it, vi } from "vitest"
import {
  availableWorlds,
  loadSurfaceAvailability,
  resetSurfaceAvailability,
  __resetSurfaceAvailabilityForTests,
} from "../surface-availability"

/**
 * The worlds this deployment offers the viewer (`worlds` on
 * GET /v1/surface/availability): the shared header's tabs in white-label
 * mode. Null until the answer lands, after sign-out, and from a server that
 * does not send them — the header then goes by the surface profile alone.
 */

afterEach(() => {
  __resetSurfaceAvailabilityForTests(null)
  vi.unstubAllGlobals()
})

function stubFetch(body: unknown): void {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body })))
}

const auth = async () => ({ Authorization: "Bearer t" })

describe("availableWorlds", () => {
  it("null before the answer lands", () => {
    expect(availableWorlds()).toBeNull()
  })

  it("the enabled worlds, in the answer's order, ignoring ids and entries it cannot read", async () => {
    stubFetch({
      nodes: { denied: [], hiddenFromUsers: [] },
      models: { denied: [] },
      worlds: [
        { id: "video", enabled: true },
        { id: "image", enabled: true },
        { id: "music", enabled: false },
        { id: "a-newer-world", enabled: true },
        { id: "trends" },
        null,
        { id: "app", enabled: true },
      ],
    })
    await loadSurfaceAvailability(auth, "viewer-1")
    expect(availableWorlds()).toEqual(["video", "image", "app"])
  })

  it("null from a server that sends no worlds", async () => {
    stubFetch({ nodes: { denied: [] }, models: { denied: [] } })
    await loadSurfaceAvailability(auth, "viewer-1")
    expect(availableWorlds()).toBeNull()
  })

  it("dropped with the rest of the answer on sign-out", async () => {
    stubFetch({ nodes: { denied: [] }, models: { denied: [] }, worlds: [{ id: "image", enabled: true }] })
    await loadSurfaceAvailability(auth, "viewer-1")
    expect(availableWorlds()).toEqual(["image"])
    resetSurfaceAvailability()
    expect(availableWorlds()).toBeNull()
  })

  it("the test seam can set them", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [], worlds: ["music"] })
    expect(availableWorlds()).toEqual(["music"])
    __resetSurfaceAvailabilityForTests({ nodes: [], models: [] })
    expect(availableWorlds()).toBeNull()
  })
})
