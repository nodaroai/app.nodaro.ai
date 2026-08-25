import { describe, it, expect, vi } from "vitest"
import { loadOverlay, OVERLAY_CONTRACT_VERSION } from "../load.js"

describe("loadOverlay — inert when unset", () => {
  it("returns { loaded: null } and never imports when packageName is undefined", async () => {
    const importer = vi.fn(async () => ({}))
    const exit = vi.fn(() => undefined as never)
    const result = await loadOverlay({ importer, exit, packageName: undefined })
    expect(result).toEqual({ loaded: null })
    expect(importer).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })

  it("treats a blank / whitespace env value as unset", async () => {
    const importer = vi.fn(async () => ({}))
    const exit = vi.fn(() => undefined as never)
    expect(await loadOverlay({ importer, exit, packageName: "" })).toEqual({ loaded: null })
    expect(await loadOverlay({ importer, exit, packageName: "   " })).toEqual({ loaded: null })
    expect(importer).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })
})

function goodModule(register: () => void | Promise<void> = () => {}) {
  return { overlayContractVersion: OVERLAY_CONTRACT_VERSION, register }
}

describe("loadOverlay — load, validate, register", () => {
  it("imports the named package and awaits register() exactly once", async () => {
    const register = vi.fn()
    const importer = vi.fn(async () => goodModule(register))
    const exit = vi.fn(() => undefined as never)
    const result = await loadOverlay({ importer, exit, packageName: "acme-overlay" })
    expect(importer).toHaveBeenCalledExactlyOnceWith("acme-overlay")
    expect(register).toHaveBeenCalledTimes(1)
    expect(exit).not.toHaveBeenCalled()
    expect(result).toEqual({ loaded: "acme-overlay" })
  })

  it("awaits an async register() before resolving", async () => {
    let done = false
    const register = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5))
      done = true
    })
    const importer = vi.fn(async () => goodModule(register))
    await loadOverlay({ importer, exit: (() => undefined) as never, packageName: "acme-overlay" })
    expect(done).toBe(true)
  })

  it("is FATAL when the import rejects (module named but unimportable)", async () => {
    const importer = vi.fn(async () => {
      throw new Error("Cannot find package 'acme-overlay'")
    })
    const exit = vi.fn(() => undefined as never)
    const result = await loadOverlay({ importer, exit, packageName: "acme-overlay" })
    expect(exit).toHaveBeenCalledExactlyOnceWith(1)
    expect(result).toEqual({ loaded: null })
  })

  it("is FATAL on an overlayContractVersion mismatch", async () => {
    const importer = vi.fn(async () => ({ overlayContractVersion: 999, register: () => {} }))
    const exit = vi.fn(() => undefined as never)
    await loadOverlay({ importer, exit, packageName: "acme-overlay" })
    expect(exit).toHaveBeenCalledExactlyOnceWith(1)
  })

  it("is FATAL when register is missing or not a function", async () => {
    const exit = vi.fn(() => undefined as never)
    await loadOverlay({
      importer: async () => ({ overlayContractVersion: OVERLAY_CONTRACT_VERSION }),
      exit,
      packageName: "acme-overlay",
    })
    expect(exit).toHaveBeenCalledWith(1)
  })

  it("is FATAL when register() throws", async () => {
    const importer = vi.fn(async () =>
      goodModule(() => {
        throw new Error("boom in register")
      }),
    )
    const exit = vi.fn(() => undefined as never)
    const result = await loadOverlay({ importer, exit, packageName: "acme-overlay" })
    expect(exit).toHaveBeenCalledExactlyOnceWith(1)
    expect(result).toEqual({ loaded: null })
  })
})
