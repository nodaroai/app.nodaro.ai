import { describe, it, expect, vi, beforeEach } from "vitest"

// buildApp imports the loader as `./lib/overlay/load.js`, which resolves to the
// same module id as `@/lib/overlay/load.js` — vitest keys mocks by the resolved
// id, so this intercepts buildApp's import regardless of specifier form.
const { mockLoadOverlay } = vi.hoisted(() => ({
  mockLoadOverlay: vi.fn(async () => ({ loaded: null })),
}))
vi.mock("@/lib/overlay/load.js", () => ({ loadOverlay: mockLoadOverlay }))

beforeEach(() => {
  mockLoadOverlay.mockClear()
  mockLoadOverlay.mockResolvedValue({ loaded: null })
})

// buildApp boots the whole Fastify app (~3 s alone, longer under a full-suite
// load); the default 5 s budget made this file the suite's one load-dependent
// flake, so it carries its own.
describe("buildApp overlay wiring", { timeout: 30_000 }, () => {
  it("calls loadOverlay exactly once during boot", async () => {
    const { buildApp } = await import("@/app.js")
    const app = await buildApp()
    expect(mockLoadOverlay).toHaveBeenCalledTimes(1)
    await app.close()
  })

  it("aborts boot before registering routes when the overlay fails", async () => {
    // A rejecting loadOverlay must abort buildApp before it returns an app — a
    // later placement would let routes register before the throw.
    mockLoadOverlay.mockRejectedValueOnce(new Error("overlay exit"))
    const { buildApp } = await import("@/app.js")
    await expect(buildApp()).rejects.toThrow("overlay exit")
  })
})
