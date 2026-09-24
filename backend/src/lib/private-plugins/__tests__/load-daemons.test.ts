/**
 * `daemons()` in the loader: collected only when the caller asks (the daemon
 * host), validated as a list, and a malformed list is a load failure with the
 * loader's usual semantics — fatal on cloud, survivable under
 * PRIVATE_MODULES=optional.
 *
 * Its own file (not load.test.ts) so the shared loader suite is not edited by
 * every capability that lands.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { mockHasCreditsRef } = vi.hoisted(() => ({ mockHasCreditsRef: { value: true } }))

// Partial mock, same reasoning as load.test.ts: load.ts drags in the real
// toolkit graph, which needs the real (defaulted) config.
vi.mock(import("@/lib/config.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, hasCredits: () => mockHasCreditsRef.value }
})
vi.mock("@/ee/billing/credits.js", () => ({ registerStaticCreditCosts: vi.fn() }))
vi.mock("@/ee/pipelines/llms/prompt-registry.js", () => ({ registerPipelinePrompts: vi.fn() }))

import { loadPrivatePlugins } from "../load.js"
import type { NodaroPrivatePlugin, PluginDaemon, PluginToolkit } from "../types.js"

const toolkit = { marker: "daemon-toolkit" } as unknown as PluginToolkit

function daemon(name: string): PluginDaemon {
  return { name, start: async () => undefined }
}

function moduleWith(plugins: NodaroPrivatePlugin[]) {
  return vi.fn().mockResolvedValue({ contractVersion: 1, plugins })
}

describe("loadPrivatePlugins — daemons", () => {
  const originalPrivateModules = process.env.PRIVATE_MODULES

  beforeEach(() => {
    mockHasCreditsRef.value = true
    delete process.env.PRIVATE_MODULES
  })

  afterEach(() => {
    if (originalPrivateModules === undefined) delete process.env.PRIVATE_MODULES
    else process.env.PRIVATE_MODULES = originalPrivateModules
    vi.restoreAllMocks()
  })

  it("never constructs daemons unless the caller asks — the API server and workers don't", async () => {
    const daemons = vi.fn(() => [daemon("alpha")])
    const exit = vi.fn() as unknown as (code: number) => never

    const result = await loadPrivatePlugins({ importer: moduleWith([{ name: "p", daemons }]), exit, toolkit })

    expect(daemons).not.toHaveBeenCalled()
    expect(result).not.toHaveProperty("daemons")
    expect(exit).not.toHaveBeenCalled()
  })

  it("collects every plugin's daemons, in order, built with the caller's toolkit", async () => {
    const first = vi.fn(() => [daemon("alpha"), daemon("beta")])
    const second = vi.fn(() => [daemon("gamma")])
    const exit = vi.fn() as unknown as (code: number) => never

    const result = await loadPrivatePlugins({
      importer: moduleWith([{ name: "one", daemons: first }, { name: "two" }, { name: "three", daemons: second }]),
      exit,
      toolkit,
      daemons: true,
    })

    expect(result.daemons?.map((d) => d.name)).toEqual(["alpha", "beta", "gamma"])
    expect(first).toHaveBeenCalledWith(toolkit)
    expect(second).toHaveBeenCalledWith(toolkit)
    expect(result.loaded).toEqual(["one", "two", "three"])
    expect(exit).not.toHaveBeenCalled()
  })

  it("a plugin set with no daemons still answers an empty list to the host", async () => {
    const exit = vi.fn() as unknown as (code: number) => never
    const result = await loadPrivatePlugins({ importer: moduleWith([{ name: "p" }]), exit, toolkit, daemons: true })
    expect(result.daemons).toEqual([])
  })

  it.each([
    ["a name registered twice across plugins", [{ name: "one", daemons: () => [daemon("alpha")] }, { name: "two", daemons: () => [daemon("alpha")] }], /twice/],
    ["a malformed name", [{ name: "one", daemons: () => [daemon("Not Valid")] }], /name/],
    ["a daemon without start()", [{ name: "one", daemons: () => [{ name: "alpha" } as unknown as PluginDaemon] }], /start/],
    ["daemons() returning something other than a list", [{ name: "one", daemons: () => ({}) as unknown as PluginDaemon[] }], /list/],
    [
      "daemons() throwing",
      [
        {
          name: "one",
          daemons: () => {
            throw new Error("constructor exploded")
          },
        },
      ],
      /constructor exploded/,
    ],
  ] as const)("%s is a fatal load failure on cloud", async (_label, plugins, reason) => {
    const exit = vi.fn() as unknown as (code: number) => never
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const result = await loadPrivatePlugins({
      importer: moduleWith(plugins as unknown as NodaroPrivatePlugin[]),
      exit,
      toolkit,
      daemons: true,
    })

    expect(exit).toHaveBeenCalledWith(1)
    expect(String(errorSpy.mock.calls[0]?.[0])).toMatch(reason)
    expect(result.daemons ?? []).toEqual([])
  })

  it("PRIVATE_MODULES=optional keeps the escape hatch: warn, host nothing, never exit", async () => {
    process.env.PRIVATE_MODULES = "optional"
    const exit = vi.fn() as unknown as (code: number) => never
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const result = await loadPrivatePlugins({
      importer: moduleWith([{ name: "one", daemons: () => [daemon("alpha"), daemon("alpha")] }]),
      exit,
      toolkit,
      daemons: true,
    })

    expect(exit).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    expect(result.daemons ?? []).toEqual([])
  })

  it("community/business: nothing is imported and nothing is hosted", async () => {
    mockHasCreditsRef.value = false
    const importer = vi.fn()
    const exit = vi.fn() as unknown as (code: number) => never

    const result = await loadPrivatePlugins({ importer, exit, toolkit, daemons: true })

    expect(importer).not.toHaveBeenCalled()
    expect(result.daemons ?? []).toEqual([])
  })
})
