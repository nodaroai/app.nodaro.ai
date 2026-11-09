/**
 * Loading a deployment's content guard from the private package's
 * `content-guard` subpath. On Cloud a missing, broken or older module stops the
 * boot, so a bad deploy fails its health check and the running version keeps
 * serving. Other editions have no package to look for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const edition = vi.hoisted(() => ({ credits: true }))
vi.mock("../config.js", () => ({ hasCredits: () => edition.credits, config: {} }))

import { loadContentGuard } from "../content-guard-load.js"
import { clearContentGuard, getContentGuardId, hasContentGuard } from "../content-guard.js"

const guard = { id: "deployment-guard", check: () => ({ refused: false as const }), proveReady: () => true }
const previousMode = process.env.PRIVATE_MODULES
const exit = vi.fn() as unknown as ((code: number) => never) & ReturnType<typeof vi.fn>

beforeEach(() => {
  edition.credits = true
  delete process.env.PRIVATE_MODULES
  exit.mockClear()
  clearContentGuard()
})

afterEach(() => {
  clearContentGuard()
  if (previousMode === undefined) delete process.env.PRIVATE_MODULES
  else process.env.PRIVATE_MODULES = previousMode
})

async function bootFails(raw: () => Promise<unknown>) {
  const error = vi.spyOn(console, "error").mockImplementation(() => {})
  await expect(loadContentGuard({ importer: raw, exit })).resolves.toBeNull()
  expect(exit).toHaveBeenCalledWith(1)
  expect(hasContentGuard()).toBe(false)
  error.mockRestore()
}

describe("loadContentGuard", () => {
  it("registers the module's guard and reports its id", async () => {
    const importer = vi.fn(async () => ({ contentGuard: guard }))
    await expect(loadContentGuard({ importer, exit })).resolves.toBe("deployment-guard")
    expect(importer).toHaveBeenCalledWith("@nodaroai/cloud-plugins/content-guard")
    expect(getContentGuardId()).toBe("deployment-guard")
    expect(exit).not.toHaveBeenCalled()
  })

  it("does nothing on an edition without the package: not even an import", async () => {
    edition.credits = false
    const importer = vi.fn(async () => ({ contentGuard: guard }))
    await expect(loadContentGuard({ importer, exit })).resolves.toBeNull()
    expect(importer).not.toHaveBeenCalled()
    expect(hasContentGuard()).toBe(false)
    expect(exit).not.toHaveBeenCalled()
  })

  it("on Cloud, a plugin build without the subpath stops the boot", async () => {
    await bootFails(async () => {
      throw new Error("Cannot find module")
    })
  })

  it("on Cloud, a module with no usable guard stops the boot", async () => {
    await bootFails(async () => ({ contentGuard: { id: "", check: "nope" } }))
  })

  it("on Cloud, an older module whose guard cannot prove itself stops the boot", async () => {
    await bootFails(async () => ({ contentGuard: { id: "older", check: () => ({ refused: false }) } }))
  })

  it("on Cloud, a guard with no vocabulary stops the boot", async () => {
    await bootFails(async () => ({ contentGuard: { ...guard, proveReady: () => false } }))
  })

  it("on Cloud, a proof that throws stops the boot", async () => {
    await bootFails(async () => ({
      contentGuard: {
        ...guard,
        proveReady: () => {
          throw new Error("boom")
        },
      },
    }))
  })

  it("PRIVATE_MODULES=optional is the same degraded boot the plugin loader allows", async () => {
    process.env.PRIVATE_MODULES = "optional"
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(
      loadContentGuard({
        importer: async () => {
          throw new Error("Cannot find module")
        },
        exit,
      }),
    ).resolves.toBeNull()
    expect(exit).not.toHaveBeenCalled()
    expect(hasContentGuard()).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
