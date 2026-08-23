import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — must use vi.hoisted() for variables referenced inside vi.mock()
// ---------------------------------------------------------------------------

const { mockHasCreditsRef, mockRegisterStaticCreditCosts, mockRegisterPipelinePrompts } = vi.hoisted(() => {
  return {
    mockHasCreditsRef: { value: true },
    mockRegisterStaticCreditCosts: vi.fn(),
    mockRegisterPipelinePrompts: vi.fn(),
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

// Same shim pattern (S9) for the pipeline-prompt registry.
vi.mock("@/ee/pipelines/llms/prompt-registry.js", () => ({
  registerPipelinePrompts: mockRegisterPipelinePrompts,
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { getPluginServices, loadPrivatePlugins } from "../load.js"
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
    mockRegisterPipelinePrompts.mockClear()
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

    expect(result).toEqual({ handlers: {}, loaded: [], engines: {}, prompts: {}, services: {} })
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
    expect(result).toEqual({ handlers: {}, loaded: [], engines: {}, prompts: {}, services: {} })

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
    expect(result).toEqual({ handlers: {}, loaded: [], engines: {}, prompts: {}, services: {} })

    warnSpy.mockRestore()
  })

  it("cloud + wrong contractVersion: logs fatal and calls exit(1)", async () => {
    const importer = vi.fn().mockResolvedValue({ contractVersion: 2, plugins: [] })
    const exit = vi.fn() as unknown as (code: number) => never
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const result = await loadPrivatePlugins({ importer, exit })

    expect(exit).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalled()
    expect(result).toEqual({ handlers: {}, loaded: [], engines: {}, prompts: {}, services: {} })

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
    expect(result).toEqual({ handlers: {}, loaded: [], engines: {}, prompts: {}, services: {} })

    warnSpy.mockRestore()
  })

  it("cloud + valid module: registers routes on the passed app, merges handlers, applies staticCreditCosts via the credits hook, merges engines, collects prompts", async () => {
    const registerRoutes = vi.fn().mockResolvedValue(undefined)
    const handlerFn = vi.fn()
    const buildSurroundComposite = vi.fn()
    const harmonizeSurround = vi.fn()
    const plugin = makePlugin({
      registerRoutes,
      handlers: () => ({ "voice-changer-pro": handlerFn }),
      staticCreditCosts: () => ({ "some-plugin-node": 3 }),
      engines: () => ({ surround: { buildSurroundComposite, harmonizeSurround } }),
      prompts: () => ({ "some.prompt.key": "You are a test prompt." }),
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
    expect(result.engines.surround?.buildSurroundComposite).toBe(buildSurroundComposite)
    expect(result.engines.surround?.harmonizeSurround).toBe(harmonizeSurround)
    expect(result.prompts).toEqual({ "some.prompt.key": "You are a test prompt." })
    expect(mockRegisterPipelinePrompts).toHaveBeenCalledWith({
      "some.prompt.key": "You are a test prompt.",
    })
  })

  it("cloud + valid module + two plugins: engines and prompts merge additively (last write wins per key)", async () => {
    const pluginA = makePlugin({
      name: "plugin-a",
      prompts: () => ({ "shared.key": "from A", "a.only": "only A" }),
    })
    const surroundEngine = { buildSurroundComposite: vi.fn(), harmonizeSurround: vi.fn() }
    const pluginB = makePlugin({
      name: "plugin-b",
      engines: () => ({ surround: surroundEngine }),
      prompts: () => ({ "shared.key": "from B", "b.only": "only B" }),
    })
    const importer = vi.fn().mockResolvedValue({ contractVersion: 1, plugins: [pluginA, pluginB] })
    const exit = vi.fn() as unknown as (code: number) => never

    const result = await loadPrivatePlugins({ importer, exit, toolkit: fakeToolkit })

    expect(exit).not.toHaveBeenCalled()
    expect(result.loaded).toEqual(["plugin-a", "plugin-b"])
    expect(result.engines.surround).toBe(surroundEngine)
    expect(result.prompts).toEqual({ "shared.key": "from B", "a.only": "only A", "b.only": "only B" })
    // registerPipelinePrompts is called once PER PLUGIN with that plugin's own
    // slice (not the merged accumulator) — the registry itself does the
    // additive last-write-wins merge, mirroring applyStaticCreditCosts.
    expect(mockRegisterPipelinePrompts).toHaveBeenCalledTimes(2)
    expect(mockRegisterPipelinePrompts).toHaveBeenNthCalledWith(1, {
      "shared.key": "from A",
      "a.only": "only A",
    })
    expect(mockRegisterPipelinePrompts).toHaveBeenNthCalledWith(2, {
      "shared.key": "from B",
      "b.only": "only B",
    })
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
    expect(result).toEqual({ handlers: {}, loaded: [], engines: {}, prompts: {}, services: {} })
  })
})

describe("services — the surface core seams delegate to", () => {
  beforeEach(() => {
    mockHasCreditsRef.value = true
  })

  it("merges services from every plugin, last write wins per member, and publishes them", async () => {
    const orgsA = { name: "a" } as never
    const orgsB = { name: "b" } as never
    const billing = { resolve: vi.fn() } as never
    const result = await loadPrivatePlugins({
      importer: async () => ({
        contractVersion: 1,
        plugins: [
          { name: "a", services: () => ({ orgs: orgsA, billing }) },
          { name: "b", services: () => ({ orgs: orgsB }) },
        ] as NodaroPrivatePlugin[],
      }),
      toolkit: {} as PluginToolkit,
    })
    expect(result.services.orgs).toBe(orgsB)
    expect(result.services.billing).toBe(billing)
    expect(getPluginServices()).toBe(result.services)
  })

  it("is an empty object when no plugin provides one", async () => {
    const result = await loadPrivatePlugins({
      importer: async () => ({ contractVersion: 1, plugins: [{ name: "a" }] as NodaroPrivatePlugin[] }),
      toolkit: {} as PluginToolkit,
    })
    expect(result.services).toEqual({})
    expect(getPluginServices()).toEqual({})
  })

  it("leaves the published surface empty on community/business", async () => {
    mockHasCreditsRef.value = false
    const result = await loadPrivatePlugins({
      importer: async () => {
        throw new Error("importer must not be called")
      },
      toolkit: {} as PluginToolkit,
    })
    expect(result.services).toEqual({})
    expect(getPluginServices()).toEqual({})
  })
})

describe("services — failure and edition paths clear the published surface", () => {
  const load = (over: Partial<Parameters<typeof loadPrivatePlugins>[0]> = {}) =>
    loadPrivatePlugins({
      importer: async () => ({
        contractVersion: 1,
        plugins: [{ name: "a", services: () => ({ orgs: { tag: "real" } as never }) }] as NodaroPrivatePlugin[],
      }),
      exit: vi.fn() as unknown as (code: number) => never,
      toolkit: fakeToolkit,
      ...over,
    })

  // The suite-wide setup defaults PRIVATE_MODULES=optional (so nothing in the
  // test run can hit the real exit path by accident); the fatal cases below
  // need it cleared, exactly as the first describe does.
  const originalPrivateModules = process.env.PRIVATE_MODULES
  beforeEach(() => {
    mockHasCreditsRef.value = true
    delete process.env.PRIVATE_MODULES
  })
  afterEach(() => {
    if (originalPrivateModules === undefined) delete process.env.PRIVATE_MODULES
    else process.env.PRIVATE_MODULES = originalPrivateModules
  })

  it("a later community/business load clears services a cloud load published", async () => {
    await load()
    expect(getPluginServices().orgs).toBeTruthy()
    mockHasCreditsRef.value = false
    await load()
    expect(getPluginServices(), "a stale surface would let a non-cloud process act on cloud services").toEqual({})
  })

  it("a later FAILED load clears them too", async () => {
    await load()
    expect(getPluginServices().orgs).toBeTruthy()
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    await load({
      importer: async () => {
        throw new Error("not installed")
      },
    })
    expect(getPluginServices()).toEqual({})
    errorSpy.mockRestore()
  })

  it("a plugin whose capability THROWS is a load failure, not an unhandled rejection", async () => {
    // The whole point of additive-optional members is that a plugin built
    // against a newer host still loads on an older one. A capability that
    // throws while being constructed must therefore go through the same
    // fatal-or-optional path as any other load failure — otherwise the
    // rejection escapes into app.ts, which awaits with no catch, and the API
    // server dies at boot past the operator's escape hatch.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const exit = vi.fn() as unknown as (code: number) => never
    const result = await load({
      exit,
      importer: async () => ({
        contractVersion: 1,
        plugins: [
          {
            name: "needy",
            services: () => {
              throw new Error("the host does not provide tk.db")
            },
          },
        ] as NodaroPrivatePlugin[],
      }),
    })
    expect(exit).toHaveBeenCalledWith(1)
    expect(errorSpy.mock.calls.flat().join(" ")).toContain('plugin "needy" failed to initialise')
    expect(result.services).toEqual({})
    expect(getPluginServices()).toEqual({})
    errorSpy.mockRestore()
  })

  it("PRIVATE_MODULES=optional keeps the escape hatch open for a throwing capability", async () => {
    process.env.PRIVATE_MODULES = "optional"
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const exit = vi.fn() as unknown as (code: number) => never
    const result = await load({
      exit,
      importer: async () => ({
        contractVersion: 1,
        plugins: [
          {
            name: "needy",
            services: () => {
              throw new Error("the host does not provide tk.db")
            },
          },
        ] as NodaroPrivatePlugin[],
      }),
    })
    expect(exit, "optional mode must never take the process down").not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    expect(result.services).toEqual({})
    warnSpy.mockRestore()
  })
})
