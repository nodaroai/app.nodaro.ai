import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from "vitest"
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

// The concurrency-lane registry is process-global and never cleared, so the
// jobLanes tests read it through spies wrapping the REAL functions: the calls
// (and their order) are asserted per test, the lookups stay real.
vi.mock(import("@/lib/concurrency-lanes/registry.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    notePluginJobTypes: vi.fn(actual.notePluginJobTypes),
    registerPluginJobLanes: vi.fn(actual.registerPluginJobLanes),
  }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { getPluginEngines, getPluginRecipes, getPluginServices, getPluginSupports, loadPrivatePlugins } from "../load.js"
import { pluginNodeVoiceReaderOf, pluginNodeVoiceReadersLoaded, _resetPluginNodeVoiceReadersForTests } from "../node-voices-registry.js"
import type { NodaroPrivatePlugin, PluginJobLaneClass, PluginNodeVoiceReader, PluginToolkit } from "../types.js"
import type { LaneClass } from "@/lib/concurrency-lanes/types.js"
import {
  laneClassOf,
  notePluginJobTypes,
  pluginJobTypesKnown,
  registerPluginJobLanes,
  undeclaredPluginJobTypes,
} from "@/lib/concurrency-lanes/registry.js"

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

    expect(result).toEqual({ handlers: {}, loaded: [], engines: {}, prompts: {}, services: {}, recipes: {}, supports: {} })
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
    expect(result).toEqual({ handlers: {}, loaded: [], engines: {}, prompts: {}, services: {}, recipes: {}, supports: {} })

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
    expect(result).toEqual({ handlers: {}, loaded: [], engines: {}, prompts: {}, services: {}, recipes: {}, supports: {} })

    warnSpy.mockRestore()
  })

  it("cloud + wrong contractVersion: logs fatal and calls exit(1)", async () => {
    const importer = vi.fn().mockResolvedValue({ contractVersion: 2, plugins: [] })
    const exit = vi.fn() as unknown as (code: number) => never
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const result = await loadPrivatePlugins({ importer, exit })

    expect(exit).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalled()
    expect(result).toEqual({ handlers: {}, loaded: [], engines: {}, prompts: {}, services: {}, recipes: {}, supports: {} })

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
    expect(result).toEqual({ handlers: {}, loaded: [], engines: {}, prompts: {}, services: {}, recipes: {}, supports: {} })

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

  it("publishes optional scene engines and clears them after a degraded reload", async () => {
    const scene3d = { capabilities: vi.fn(), generate: vi.fn(), edit: vi.fn() }
    await loadPrivatePlugins({ toolkit: fakeToolkit, importer: async () => ({
      contractVersion: 1, plugins: [makePlugin({ engines: () => ({ scene3d }) })],
    }) })
    expect(getPluginEngines().scene3d).toBe(scene3d)
    process.env.PRIVATE_MODULES = "optional"
    await loadPrivatePlugins({ toolkit: fakeToolkit, importer: async () => { throw new Error("unavailable") } })
    expect(getPluginEngines().scene3d).toBeUndefined()
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

  describe("tk.http.workerRequest binding", () => {
    async function load(opts: Parameters<typeof loadPrivatePlugins>[0]) {
      let seen: PluginToolkit | undefined
      const registerRoutes = vi.fn()
      const plugin = makePlugin({ registerRoutes, handlers: (tk) => { seen = tk; return {} } })
      const importer = vi.fn().mockResolvedValue({ contractVersion: 1, plugins: [plugin] })
      await loadPrivatePlugins({ ...opts, importer, exit: vi.fn() as unknown as (code: number) => never })
      return { tk: seen!, registerRoutes }
    }

    it("the worker's workerApp provider is what the plugin's workerRequest reaches; routes stay unregistered", async () => {
      const inject = vi.fn().mockResolvedValue({ statusCode: 200, body: "{}" })
      const workerApp = vi.fn(async () => ({ inject }) as unknown as FastifyInstance)
      const { tk, registerRoutes } = await load({ workerApp })
      expect(workerApp).not.toHaveBeenCalled() // lazy: nothing is built at load
      await tk.http.workerRequest!({ method: "GET", url: "/v1/jobs", userId: "u-1" })
      expect(registerRoutes).not.toHaveBeenCalled()
      expect(workerApp).toHaveBeenCalledTimes(1)
      expect(inject).toHaveBeenCalledTimes(1)
    })

    it("in the API process it is bound to the API app", async () => {
      const inject = vi.fn().mockResolvedValue({ statusCode: 200, body: "{}" })
      const { tk } = await load({ app: { inject } as unknown as FastifyInstance })
      await tk.http.workerRequest!({ method: "GET", url: "/v1/jobs", userId: "u-1" })
      expect(inject).toHaveBeenCalledTimes(1)
    })

    it("is absent when the process has no app to reach (the daemon host)", async () => {
      const { tk } = await load({})
      expect(tk.http.workerRequest).toBeUndefined()
    })
  })

  it("cloud + valid module with no plugins: resolves empty without exiting", async () => {
    const importer = vi.fn().mockResolvedValue({ contractVersion: 1, plugins: [] })
    const exit = vi.fn() as unknown as (code: number) => never

    const result = await loadPrivatePlugins({ app: fakeApp, importer, exit })

    expect(exit).not.toHaveBeenCalled()
    expect(result).toEqual({ handlers: {}, loaded: [], engines: {}, prompts: {}, services: {}, recipes: {}, supports: {}, pluginBuildId: null })
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

describe("recipes — plugin-provided get_recipe content", () => {
  const originalPrivateModules = process.env.PRIVATE_MODULES
  beforeEach(() => {
    mockHasCreditsRef.value = true
    delete process.env.PRIVATE_MODULES
  })
  afterEach(() => {
    if (originalPrivateModules === undefined) delete process.env.PRIVATE_MODULES
    else process.env.PRIVATE_MODULES = originalPrivateModules
  })

  it("merges plugin recipes and publishes them via getPluginRecipes()", async () => {
    const plugin = makePlugin({
      name: "p",
      recipes: () => ({ "x-core": { description: "d", triggers: ["t"], library: true, body: "B", files: { "a.md": "A" } } }),
    })
    const result = await loadPrivatePlugins({ importer: async () => ({ contractVersion: 1, plugins: [plugin] }), toolkit: fakeToolkit })
    expect(getPluginRecipes()["x-core"].files["a.md"]).toBe("A")
    expect(result.recipes["x-core"].body).toBe("B")
  })

  it("clears plugin recipes on a failed/optional load", async () => {
    await loadPrivatePlugins({
      importer: async () => ({
        contractVersion: 1,
        plugins: [makePlugin({ recipes: () => ({ r: { description: "d", triggers: ["t"], body: "B", files: {} } }) })],
      }),
      toolkit: fakeToolkit,
    })
    expect(getPluginRecipes().r).toBeTruthy()
    process.env.PRIVATE_MODULES = "optional"
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    await loadPrivatePlugins({ importer: async () => { throw new Error("nope") } })
    expect(getPluginRecipes()).toEqual({})
    warnSpy.mockRestore()
  })
})

describe("supports — what a plugin's own handlers can do (plugin → host)", () => {
  beforeEach(() => {
    mockHasCreditsRef.value = true
  })

  it("merges every plugin's declaration, last write wins per member", async () => {
    const result = await loadPrivatePlugins({
      importer: async () => ({
        contractVersion: 1,
        plugins: [
          makePlugin({ name: "a", supports: () => ({ editPlanModes: ["tighten"] }) }),
          makePlugin({ name: "edit-plan", supports: () => ({ editPlanModes: ["tighten", "clips", "chapters", "trailer"] }) }),
        ],
      }),
      toolkit: fakeToolkit,
    })
    expect(result.supports.editPlanModes).toEqual(["tighten", "clips", "chapters", "trailer"])
  })

  it("is an empty object when no plugin declares anything (an older plugin)", async () => {
    const result = await loadPrivatePlugins({
      importer: async () => ({ contractVersion: 1, plugins: [makePlugin({ name: "a" })] }),
      toolkit: fakeToolkit,
    })
    expect(result.supports).toEqual({})
  })

  // The API server reads the declaration at request time (GET
  // /v1/edit-plan/capabilities), with no path back to this result — so it is
  // published, like services/engines/recipes, and cleared by every outcome
  // that loads no plugin.
  it("is published to getPluginSupports() after a successful load", async () => {
    await loadPrivatePlugins({
      importer: async () => ({
        contractVersion: 1,
        plugins: [makePlugin({ name: "edit-plan", supports: () => ({ editPlanModes: ["trailer"] }) })],
      }),
      toolkit: fakeToolkit,
    })
    expect(getPluginSupports()).toEqual({ editPlanModes: ["trailer"] })
  })

  // Cast Swap face masking is additive-optional: an engine that predates it
  // declares no `faceMasking`, which reads as "not supported".
  it("publishes the Cast Swap engine's faceMasking flag, and an older engine's absence of it", async () => {
    const castSwap = {
      roleKinds: ["person", "location", "product", "pet"] as const,
      fixedReferences: true,
      fullQuality: true,
      resolutions: ["480p", "720p", "1080p"] as const,
      trendRun: true,
    }
    await loadPrivatePlugins({
      importer: async () => ({
        contractVersion: 1,
        plugins: [makePlugin({ name: "cast-swap", supports: () => ({ castSwap: { ...castSwap, faceMasking: true } }) })],
      }),
      toolkit: fakeToolkit,
    })
    expect(getPluginSupports().castSwap?.faceMasking).toBe(true)

    await loadPrivatePlugins({
      importer: async () => ({ contractVersion: 1, plugins: [makePlugin({ name: "cast-swap", supports: () => ({ castSwap }) })] }),
      toolkit: fakeToolkit,
    })
    expect(getPluginSupports().castSwap?.faceMasking).toBeUndefined()
  })

  // A trend's own pre prompt is additive-optional the same way: absent = not supported.
  it("publishes the Cast Swap engine's trendPrePrompt flag, and an older engine's absence of it", async () => {
    const castSwap = {
      roleKinds: ["person", "location", "product", "pet"] as const,
      fixedReferences: true,
      fullQuality: true,
      resolutions: ["480p", "720p", "1080p"] as const,
      trendRun: true,
    }
    await loadPrivatePlugins({
      importer: async () => ({
        contractVersion: 1,
        plugins: [makePlugin({ name: "cast-swap", supports: () => ({ castSwap: { ...castSwap, trendPrePrompt: true } }) })],
      }),
      toolkit: fakeToolkit,
    })
    expect(getPluginSupports().castSwap?.trendPrePrompt).toBe(true)

    await loadPrivatePlugins({
      importer: async () => ({ contractVersion: 1, plugins: [makePlugin({ name: "cast-swap", supports: () => ({ castSwap }) })] }),
      toolkit: fakeToolkit,
    })
    expect(getPluginSupports().castSwap?.trendPrePrompt).toBeUndefined()
  })

  it("is cleared from getPluginSupports() when a later load fails or loads nothing", async () => {
    const declaring = async () => ({
      contractVersion: 1,
      plugins: [makePlugin({ name: "edit-plan", supports: () => ({ editPlanModes: ["trailer"] }) })],
    })
    const exit = vi.fn() as unknown as (code: number) => never
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await loadPrivatePlugins({ importer: declaring, toolkit: fakeToolkit })
    await loadPrivatePlugins({ importer: async () => { throw new Error("boom") }, exit })
    expect(getPluginSupports()).toEqual({})

    await loadPrivatePlugins({ importer: declaring, toolkit: fakeToolkit })
    mockHasCreditsRef.value = false
    await loadPrivatePlugins({})
    expect(getPluginSupports()).toEqual({})

    errorSpy.mockRestore()
  })
})

describe("nodeVoices — how to read the voices a plugin's node speaks in (plugin → host)", () => {
  beforeEach(() => {
    mockHasCreditsRef.value = true
    _resetPluginNodeVoiceReadersForTests()
  })

  const reader = (voice: string): PluginNodeVoiceReader => () => [voice]

  it("publishes every plugin's readers, last write wins per node type", async () => {
    await loadPrivatePlugins({
      importer: async () => ({
        contractVersion: 1,
        plugins: [
          makePlugin({ name: "a", nodeVoices: () => ({ "speaker-node": reader("FromA"), "other-node": reader("Other") }) }),
          makePlugin({ name: "b", nodeVoices: () => ({ "speaker-node": reader("FromB") }) }),
        ],
      }),
      toolkit: fakeToolkit,
    })

    expect(pluginNodeVoiceReadersLoaded()).toBe(true)
    expect(pluginNodeVoiceReaderOf("speaker-node")?.({}, {})).toEqual(["FromB"])
    expect(pluginNodeVoiceReaderOf("other-node")?.({}, {})).toEqual(["Other"])
    expect(pluginNodeVoiceReaderOf("unknown-node")).toBeUndefined()
  })

  it("an older plugin that declares none loads unchanged, with no reader", async () => {
    const result = await loadPrivatePlugins({
      importer: async () => ({ contractVersion: 1, plugins: [makePlugin({ name: "a" })] }),
      toolkit: fakeToolkit,
    })

    expect(result.loaded).toEqual(["a"])
    expect(pluginNodeVoiceReadersLoaded()).toBe(true)
    expect(pluginNodeVoiceReaderOf("voice-changer-pro")).toBeUndefined()
  })

  it("a declaration that throws or is not an object is logged and dropped; the plugin still loads", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    for (const nodeVoices of [
      () => {
        throw new Error("boom")
      },
      () => null,
      () => [reader("X")],
    ] as unknown as Array<NonNullable<NodaroPrivatePlugin["nodeVoices"]>>) {
      const result = await loadPrivatePlugins({
        importer: async () => ({ contractVersion: 1, plugins: [makePlugin({ name: "a", nodeVoices })] }),
        toolkit: fakeToolkit,
      })
      expect(result.loaded).toEqual(["a"])
      expect(pluginNodeVoiceReaderOf("0")).toBeUndefined()
      expect(pluginNodeVoiceReaderOf("speaker-node")).toBeUndefined()
    }
    expect(warnSpy.mock.calls.filter(([message]) => String(message).includes("nodeVoices()"))).toHaveLength(3)
    warnSpy.mockRestore()
  })

  it("an entry that is not a function is refused (logged), and the plugin's other entries stand", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    await loadPrivatePlugins({
      importer: async () => ({
        contractVersion: 1,
        plugins: [makePlugin({ name: "a", nodeVoices: () => ({ "speaker-node": reader("Kept"), "bad-node": ["Voice"] as unknown as PluginNodeVoiceReader }) })],
      }),
      toolkit: fakeToolkit,
    })

    expect(pluginNodeVoiceReaderOf("speaker-node")?.({}, {})).toEqual(["Kept"])
    expect(pluginNodeVoiceReaderOf("bad-node")).toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("bad-node"))
    warnSpy.mockRestore()
  })

  it("is cleared when a later load fails or loads nothing, and still counts as loaded", async () => {
    const declaring = async () => ({
      contractVersion: 1,
      plugins: [makePlugin({ name: "a", nodeVoices: () => ({ "speaker-node": reader("X") }) })],
    })
    const exit = vi.fn() as unknown as (code: number) => never
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await loadPrivatePlugins({ importer: declaring, toolkit: fakeToolkit })
    await loadPrivatePlugins({ importer: async () => { throw new Error("boom") }, exit })
    expect(pluginNodeVoiceReaderOf("speaker-node")).toBeUndefined()
    expect(pluginNodeVoiceReadersLoaded()).toBe(true)

    await loadPrivatePlugins({ importer: declaring, toolkit: fakeToolkit })
    mockHasCreditsRef.value = false
    await loadPrivatePlugins({})
    expect(pluginNodeVoiceReaderOf("speaker-node")).toBeUndefined()
    expect(pluginNodeVoiceReadersLoaded()).toBe(true)

    errorSpy.mockRestore()
  })

  it("a reader declared by a plugin whose load then fails is not published", async () => {
    const exit = vi.fn() as unknown as (code: number) => never
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const result = await loadPrivatePlugins({
      importer: async () => ({
        contractVersion: 1,
        plugins: [
          makePlugin({ name: "a", nodeVoices: () => ({ "speaker-node": reader("X") }) }),
          makePlugin({
            name: "b",
            handlers: () => {
              throw new Error("init failed")
            },
          }),
        ],
      }),
      toolkit: fakeToolkit,
      exit,
    })

    // A failed load (fatal on cloud, degraded under PRIVATE_MODULES=optional)
    // loads no plugin, so none of its readers may stand either.
    expect(result.loaded).toEqual([])
    expect(pluginNodeVoiceReaderOf("speaker-node")).toBeUndefined()
    expect(pluginNodeVoiceReadersLoaded()).toBe(true)
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })
})

describe("pluginBuildId — which plugin build this process runs", () => {
  beforeEach(() => {
    mockHasCreditsRef.value = true
  })

  it("surfaces the module's pluginBuildId on a successful load", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const result = await loadPrivatePlugins({
      importer: async () => ({ contractVersion: 1, pluginBuildId: "@nodaroai/cloud-plugins@1.2.3", plugins: [] }),
      toolkit: fakeToolkit,
    })
    expect(result.pluginBuildId).toBe("@nodaroai/cloud-plugins@1.2.3")
    logSpy.mockRestore()
  })

  it("is null when the module does not export one (a pre-0.7.3 build)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const result = await loadPrivatePlugins({
      importer: async () => ({ contractVersion: 1, pluginBuildId: 7, plugins: [] }),
      toolkit: fakeToolkit,
    })
    expect(result.pluginBuildId).toBeNull()
    logSpy.mockRestore()
  })
})

describe("jobLanes — the lane each plugin job type declares", () => {
  const noteSpy = vi.mocked(notePluginJobTypes)
  const registerSpy = vi.mocked(registerPluginJobLanes)
  const exit = vi.fn() as unknown as (code: number) => never
  const handler = vi.fn()
  const load = (plugins: NodaroPrivatePlugin[]) =>
    loadPrivatePlugins({ importer: async () => ({ contractVersion: 1, plugins }), toolkit: fakeToolkit, exit })

  beforeEach(() => {
    mockHasCreditsRef.value = true
    delete process.env.PRIVATE_MODULES
    noteSpy.mockClear()
    registerSpy.mockClear()
    vi.mocked(exit).mockClear()
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.PRIVATE_MODULES
  })

  it("PluginJobLaneClass is LaneClass, both ways", () => {
    expectTypeOf<PluginJobLaneClass>().toEqualTypeOf<LaneClass>()
  })

  it("the loader merges a plugin's jobLanes", async () => {
    const result = await load([
      makePlugin({
        name: "lanes-a",
        handlers: () => ({ "jl-merge-leaf": handler, "jl-merge-coord": handler }),
        jobLanes: () => ({
          "jl-merge-leaf": { kind: "leaf", lane: "provider" },
          "jl-merge-coord": { kind: "coordinator" },
        }),
      }),
      makePlugin({
        name: "lanes-b",
        handlers: () => ({ "jl-merge-llm": handler }),
        jobLanes: () => ({ "jl-merge-llm": { kind: "leaf", lane: "llm" } }),
      }),
    ])

    expect(exit).not.toHaveBeenCalled()
    expect(result.loaded).toEqual(["lanes-a", "lanes-b"])
    expect(laneClassOf("video-generation", "jl-merge-leaf", {})).toEqual({ kind: "leaf", lane: "provider" })
    expect(laneClassOf("video-generation", "jl-merge-llm", {})).toEqual({ kind: "leaf", lane: "llm" })
    expect(laneClassOf("video-generation", "jl-merge-coord", {})).toEqual({ kind: "coordinator" })
    expect(undeclaredPluginJobTypes().filter((t) => t.startsWith("jl-merge-"))).toEqual([])
    // The handler keys are noted first, then the declarations registered — once each.
    expect(noteSpy).toHaveBeenCalledTimes(1)
    expect(noteSpy).toHaveBeenCalledWith(["jl-merge-leaf", "jl-merge-coord", "jl-merge-llm"])
    expect(registerSpy).toHaveBeenCalledTimes(1)
    expect(noteSpy.mock.invocationCallOrder[0]).toBeLessThan(registerSpy.mock.invocationCallOrder[0]!)
  })

  it("a plugin without jobLanes loads unchanged and its types are listed undeclared", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const result = await load([makePlugin({ name: "no-lanes", handlers: () => ({ "jl-plain": handler }) })])

    expect(exit).not.toHaveBeenCalled()
    expect(result.loaded).toEqual(["no-lanes"])
    expect(result.handlers["jl-plain"]).toBe(handler)
    expect(pluginJobTypesKnown()).toBe(true)
    expect(undeclaredPluginJobTypes()).toContain("jl-plain")
    expect(laneClassOf("video-generation", "jl-plain", {})).toEqual({ kind: "coordinator" })
    // Listed at boot.
    expect(warn.mock.calls.some((c) => String(c[0]).includes("jl-plain"))).toBe(true)
  })

  it("a throwing jobLanes() is logged and the plugin still loads, its types undeclared", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const result = await load([
      makePlugin({
        name: "lanes-throw",
        handlers: () => ({ "jl-throw": handler }),
        jobLanes: () => { throw new Error("boom") },
      }),
    ])

    expect(exit).not.toHaveBeenCalled()
    expect(result.loaded).toEqual(["lanes-throw"])
    expect(result.handlers["jl-throw"]).toBe(handler)
    expect(undeclaredPluginJobTypes()).toContain("jl-throw")
    expect(warn.mock.calls.some((c) => String(c[0]).includes("lanes-throw") && String(c[0]).includes("boom"))).toBe(true)
  })

  it.each([
    ["null", null],
    ["an array", [["jl-shape", { kind: "coordinator" }]]],
    ["a string", "coordinator"],
  ])("a jobLanes() that returns %s is refused and its types stay undeclared", async (_label, value) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const type = `jl-shape-${_label.replace(/\s/g, "-")}`
    const result = await load([
      makePlugin({
        name: "lanes-shape",
        handlers: () => ({ [type]: handler }),
        jobLanes: (() => value) as unknown as NodaroPrivatePlugin["jobLanes"],
      }),
    ])

    expect(exit).not.toHaveBeenCalled()
    expect(result.loaded).toEqual(["lanes-shape"])
    expect(undeclaredPluginJobTypes()).toContain(type)
    expect(warn).toHaveBeenCalled()
  })

  it("an entry that is not a valid lane class is refused, and the plugin's other entries stand", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    await load([
      makePlugin({
        name: "lanes-bad-entry",
        handlers: () => ({ "jl-bad": handler, "jl-good": handler }),
        jobLanes: () => ({
          "jl-bad": { kind: "leaf", lane: "run" } as unknown as PluginJobLaneClass,
          "jl-good": { kind: "leaf", lane: "local" },
        }),
      }),
    ])

    expect(undeclaredPluginJobTypes()).toContain("jl-bad")
    expect(undeclaredPluginJobTypes()).not.toContain("jl-good")
    expect(laneClassOf("video-generation", "jl-good", {})).toEqual({ kind: "leaf", lane: "local" })
  })

  it("a declaration for a type the plugin's own handlers() do not return is refused, so it cannot reclassify a core job", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await load([
      makePlugin({
        name: "lanes-foreign",
        handlers: () => ({ "jl-own": handler }),
        jobLanes: () => ({ "jl-own": { kind: "leaf", lane: "provider" }, "combine-videos": { kind: "coordinator" } }),
      }),
    ])

    expect(laneClassOf("video-generation", "combine-videos", {})).toEqual({ kind: "leaf", lane: "local" })
    expect(laneClassOf("video-generation", "jl-own", {})).toEqual({ kind: "leaf", lane: "provider" })
    expect(warn.mock.calls.some((c) => String(c[0]).includes("combine-videos"))).toBe(true)
  })

  it("a plugin cannot declare another plugin's job type", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await load([
      makePlugin({ name: "lanes-owner", handlers: () => ({ "jl-others": handler }) }),
      makePlugin({
        name: "lanes-meddler",
        handlers: () => ({ "jl-meddler-own": handler }),
        jobLanes: () => ({ "jl-others": { kind: "leaf", lane: "provider" }, "jl-meddler-own": { kind: "leaf", lane: "llm" } }),
      }),
    ])

    expect(undeclaredPluginJobTypes()).toContain("jl-others")
    expect(laneClassOf("video-generation", "jl-others", {})).toEqual({ kind: "coordinator" })
    expect(laneClassOf("video-generation", "jl-meddler-own", {})).toEqual({ kind: "leaf", lane: "llm" })
    expect(warn.mock.calls.some((c) => String(c[0]).includes("lanes-meddler") && String(c[0]).includes("jl-others"))).toBe(true)
  })

  it("a later plugin that takes over a handler without declaring it drops the earlier declaration", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    await load([
      makePlugin({
        name: "lanes-first",
        handlers: () => ({ "jl-taken-over": handler }),
        jobLanes: () => ({ "jl-taken-over": { kind: "leaf", lane: "provider" } }),
      }),
      makePlugin({ name: "lanes-second", handlers: () => ({ "jl-taken-over": handler }) }),
    ])

    expect(undeclaredPluginJobTypes()).toContain("jl-taken-over")
  })

  it("a module with no plugins records that there are no plugin job types", async () => {
    await load([])
    expect(noteSpy).toHaveBeenCalledWith([])
  })

  describe("with a fresh registry (it is process-global and never cleared)", () => {
    // A fresh, REAL registry: vi.resetModules() alone would hand back the cached
    // spy-wrapped mock above, state and all, so the mock is dropped first.
    async function fresh() {
      vi.doUnmock("@/lib/concurrency-lanes/registry.js")
      vi.resetModules()
      const loader = await import("../load.js")
      const registry = await import("@/lib/concurrency-lanes/registry.js")
      const { unmetPreconditions } = await import("@/lib/concurrency-lanes/enforcement.js")
      const pluginItemUnmet = () => unmetPreconditions({
        available: true,
        columnsPresent: true,
        pluginTypesKnown: registry.pluginJobTypesKnown(),
        undeclaredPluginTypes: registry.undeclaredPluginJobTypes(),
        pluginLoadFailed: registry.pluginLoadFailed(),
        liveCeilingMeasured: true,
        measureDays: 7,
      }).includes("plugins")
      const loadPlugins = (plugins: NodaroPrivatePlugin[]) =>
        loader.loadPrivatePlugins({ importer: async () => ({ contractVersion: 1, plugins }), toolkit: fakeToolkit, exit })
      return { loader, registry, pluginItemUnmet, loadPlugins }
    }

    it("community/business (no plugins at all) records that there are no plugin job types", async () => {
      mockHasCreditsRef.value = false
      const { loader, registry, pluginItemUnmet } = await fresh()
      expect(registry.pluginJobTypesKnown()).toBe(false)

      await loader.loadPrivatePlugins({ importer: vi.fn(), exit })

      expect(registry.pluginJobTypesKnown()).toBe(true)
      expect(registry.undeclaredPluginJobTypes()).toEqual([])
      expect(registry.pluginLoadFailed()).toBe(false)
      expect(pluginItemUnmet()).toBe(false)
    })

    it("an optional-mode failure records no plugin job types and leaves the plugin item unmet", async () => {
      process.env.PRIVATE_MODULES = "optional"
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const { registry, pluginItemUnmet, loadPlugins } = await fresh()

      const result = await loadPlugins([
        makePlugin({
          name: "lanes-ok",
          handlers: () => ({ "jl-before-failure": handler }),
          jobLanes: () => ({ "jl-before-failure": { kind: "leaf", lane: "provider" } }),
        }),
        makePlugin({ name: "lanes-broken", handlers: () => { throw new Error("broken") } }),
      ])

      expect(result.loaded).toEqual([])
      expect(registry.pluginJobTypesKnown()).toBe(false)
      expect(registry.undeclaredPluginJobTypes()).toEqual([])
      expect(registry.pluginLoadFailed()).toBe(true)
      expect(registry.laneClassOf("video-generation", "jl-before-failure", {})).toEqual({ kind: "coordinator" })
      expect(pluginItemUnmet()).toBe(true)
    })

    it("an optional-mode import failure leaves the plugin item unmet", async () => {
      process.env.PRIVATE_MODULES = "optional"
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const { loader, registry, pluginItemUnmet } = await fresh()

      await loader.loadPrivatePlugins({ importer: async () => { throw new Error("unavailable") }, exit })

      expect(registry.pluginJobTypesKnown()).toBe(false)
      expect(registry.pluginLoadFailed()).toBe(true)
      expect(pluginItemUnmet()).toBe(true)
    })

    it("a plugin that takes over a core job and declares it a provider leaf runs it as one", async () => {
      const { registry, pluginItemUnmet, loadPlugins } = await fresh()
      expect(registry.laneClassOf("video-generation", "combine-videos", {})).toEqual({ kind: "leaf", lane: "local" })

      await loadPlugins([
        makePlugin({
          name: "lanes-core-takeover",
          handlers: () => ({ "combine-videos": handler }),
          jobLanes: () => ({ "combine-videos": { kind: "leaf", lane: "provider" } }),
        }),
      ])

      expect(registry.laneClassOf("video-generation", "combine-videos", {})).toEqual({ kind: "leaf", lane: "provider" })
      expect(registry.undeclaredPluginJobTypes()).toEqual([])
      expect(pluginItemUnmet()).toBe(false)
    })

    it("a plugin that takes over a core job without declaring it runs it as a coordinator, listed undeclared", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const { registry, pluginItemUnmet, loadPlugins } = await fresh()

      await loadPlugins([makePlugin({ name: "lanes-core-undeclared", handlers: () => ({ "combine-videos": handler }) })])

      expect(registry.laneClassOf("video-generation", "combine-videos", {})).toEqual({ kind: "coordinator" })
      expect(registry.undeclaredPluginJobTypes()).toEqual(["combine-videos"])
      expect(pluginItemUnmet()).toBe(true)
    })
  })
})
