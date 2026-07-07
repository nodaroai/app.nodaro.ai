import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — must use vi.hoisted() for variables referenced inside vi.mock()
// ---------------------------------------------------------------------------

const { mockHasCreditsRef, mockRegisterStaticCreditCosts } = vi.hoisted(() => {
  return {
    mockHasCreditsRef: { value: true },
    mockRegisterStaticCreditCosts: vi.fn(),
  }
})

// Partial mock (importOriginal) — NOT a full module replacement. Task 8 wrote
// this as `() => ({ hasCredits: ... })`, which was safe while toolkit.ts was
// still a throwing stub (`./toolkit.js` had no other real imports). Task 9
// replaced the stub with a real `buildToolkit()` that statically imports the
// app's provider/lib modules (e.g. `providers/replicate/client.ts` reads
// `config.REPLICATE_API_TOKEN` at module-eval time), and `load.ts` imports
// `buildToolkit` from `./toolkit.js` at its own top level — so merely
// importing `load.ts` now drags in that whole graph. A full-replacement mock
// here blew away `config` entirely (`Cannot read properties of undefined`);
// preserving the real module and overriding only `hasCredits` keeps this
// test's control over edition-gating while letting the real (defaulted)
// `config` object flow through to every transitively-imported module.
vi.mock(import("@/lib/config.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    hasCredits: () => mockHasCreditsRef.value,
  }
})

// The credits hook lives behind a dynamic import gated on hasCredits() (the
// same shim pattern as middleware/credit-guard.ts), so it must be mockable
// even though load.ts never statically imports ee/.
vi.mock("@/ee/billing/credits.js", () => ({
  registerStaticCreditCosts: mockRegisterStaticCreditCosts,
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { loadPrivatePlugins } from "../load.js"
import type { NodaroPrivatePlugin, PluginToolkit } from "../types.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeApp = {} as FastifyInstance
const fakeToolkit = {} as PluginToolkit

function makePlugin(overrides: Partial<NodaroPrivatePlugin> = {}): NodaroPrivatePlugin {
  return {
    name: "voice-changer-pro",
    ...overrides,
  }
}

describe("loadPrivatePlugins", () => {
  const originalPrivateModules = process.env.PRIVATE_MODULES

  beforeEach(() => {
    mockHasCreditsRef.value = true
    mockRegisterStaticCreditCosts.mockClear()
    delete process.env.PRIVATE_MODULES
  })

  afterEach(() => {
    if (originalPrivateModules === undefined) {
      delete process.env.PRIVATE_MODULES
    } else {
      process.env.PRIVATE_MODULES = originalPrivateModules
    }
  })

  it("community/business (hasCredits() false): resolves empty, importer never called", async () => {
    mockHasCreditsRef.value = false
    const importer = vi.fn()
    const exit = vi.fn() as unknown as (code: number) => never

    const result = await loadPrivatePlugins({ importer, exit })

    expect(result).toEqual({ handlers: {}, loaded: [] })
    expect(importer).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })

  it("cloud + importer rejects: logs fatal and calls exit(1)", async () => {
    const importer = vi.fn().mockRejectedValue(new Error("network fail"))
    const exit = vi.fn() as unknown as (code: number) => never
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const result = await loadPrivatePlugins({ importer, exit })

    expect(exit).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalled()
    expect(result).toEqual({ handlers: {}, loaded: [] })

    errorSpy.mockRestore()
  })

  it("cloud + PRIVATE_MODULES=optional + importer rejects: warns, resolves empty, never exits", async () => {
    process.env.PRIVATE_MODULES = "optional"
    const importer = vi.fn().mockRejectedValue(new Error("network fail"))
    const exit = vi.fn() as unknown as (code: number) => never
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const result = await loadPrivatePlugins({ importer, exit })

    expect(exit).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    expect(result).toEqual({ handlers: {}, loaded: [] })

    warnSpy.mockRestore()
  })

  it("cloud + wrong contractVersion: logs fatal and calls exit(1)", async () => {
    const importer = vi.fn().mockResolvedValue({ contractVersion: 2, plugins: [] })
    const exit = vi.fn() as unknown as (code: number) => never
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const result = await loadPrivatePlugins({ importer, exit })

    expect(exit).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalled()
    expect(result).toEqual({ handlers: {}, loaded: [] })

    errorSpy.mockRestore()
  })

  it("cloud + PRIVATE_MODULES=optional + wrong contractVersion: warns, resolves empty, never exits", async () => {
    process.env.PRIVATE_MODULES = "optional"
    const importer = vi.fn().mockResolvedValue({ contractVersion: 2, plugins: [] })
    const exit = vi.fn() as unknown as (code: number) => never
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const result = await loadPrivatePlugins({ importer, exit })

    expect(exit).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    expect(result).toEqual({ handlers: {}, loaded: [] })

    warnSpy.mockRestore()
  })

  it("cloud + valid module: registers routes on the passed app, merges handlers, applies staticCreditCosts via the credits hook", async () => {
    const registerRoutes = vi.fn().mockResolvedValue(undefined)
    const handlerFn = vi.fn()
    const plugin = makePlugin({
      registerRoutes,
      handlers: () => ({ "voice-changer-pro": handlerFn }),
      staticCreditCosts: () => ({ "some-plugin-node": 3 }),
    })
    const importer = vi.fn().mockResolvedValue({ contractVersion: 1, plugins: [plugin] })
    const exit = vi.fn() as unknown as (code: number) => never

    const result = await loadPrivatePlugins({
      app: fakeApp,
      importer,
      exit,
      toolkit: fakeToolkit,
    })

    expect(exit).not.toHaveBeenCalled()
    expect(registerRoutes).toHaveBeenCalledWith(fakeApp, fakeToolkit)
    expect(result.handlers["voice-changer-pro"]).toBe(handlerFn)
    expect(result.loaded).toEqual(["voice-changer-pro"])
    expect(mockRegisterStaticCreditCosts).toHaveBeenCalledWith({ "some-plugin-node": 3 })
  })

  it("cloud + valid module + no app passed: does not register routes, still merges handlers (worker-only load)", async () => {
    const registerRoutes = vi.fn().mockResolvedValue(undefined)
    const handlerFn = vi.fn()
    const plugin = makePlugin({
      registerRoutes,
      handlers: () => ({ "voice-changer-pro": handlerFn }),
    })
    const importer = vi.fn().mockResolvedValue({ contractVersion: 1, plugins: [plugin] })
    const exit = vi.fn() as unknown as (code: number) => never

    const result = await loadPrivatePlugins({ importer, exit, toolkit: fakeToolkit })

    expect(registerRoutes).not.toHaveBeenCalled()
    expect(result.handlers["voice-changer-pro"]).toBe(handlerFn)
    expect(result.loaded).toEqual(["voice-changer-pro"])
  })

  it("cloud + valid module with no plugins: resolves empty without exiting", async () => {
    const importer = vi.fn().mockResolvedValue({ contractVersion: 1, plugins: [] })
    const exit = vi.fn() as unknown as (code: number) => never

    const result = await loadPrivatePlugins({ app: fakeApp, importer, exit })

    expect(exit).not.toHaveBeenCalled()
    expect(result).toEqual({ handlers: {}, loaded: [] })
  })
})
