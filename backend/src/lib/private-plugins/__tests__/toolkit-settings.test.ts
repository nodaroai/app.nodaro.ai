import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest"
import type { FaceMasking } from "../../cast-swap-face-masking.js"
import type { PluginFaceMasking, PluginNodaroMotionMasking } from "../types.js"
import type { NodaroMotionMasking } from "../../nodaro-motion-masking.js"

/**
 * `tk.settings.nodaroMotionMasking()` — the admin's face masking per Nodaro
 * Motion engine, which the Cast Swap engine applies to every DIRECT run. It is
 * the settings cache's own read (`getAppSettings`, ~60 s, cleared on an admin
 * write), handed out as a copy, and null when never saved.
 */
const h = vi.hoisted(() => ({ masking: null as unknown, reads: 0, failed: false }))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../app-settings.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return {
    ...orig,
    getAppSettings: async () => {
      h.reads++
      return { nodaro_motion_masking: h.masking }
    },
    settingsReadFailed: () => h.failed,
  }
})

const { buildToolkit } = await import("../toolkit.js")

describe("tk.settings.nodaroMotionMasking", () => {
  beforeEach(() => {
    h.masking = null
    h.reads = 0
    h.failed = false
  })

  it("rejects when the settings could not be read, never answering null (never saved)", async () => {
    h.failed = true
    await expect(buildToolkit().settings!.nodaroMotionMasking!()).rejects.toThrow(/could not be read/)
  })

  it("answers null when it was never saved", async () => {
    expect(await buildToolkit().settings!.nodaroMotionMasking!()).toBeNull()
    expect(h.reads).toBe(1)
  })

  it("answers each engine's setting, as a copy the plugin may change", async () => {
    const saved = { "motion-pro": { mode: "auto", zone: { leftPct: 5 } }, "motion-lite": { mode: "always", target: "face" } }
    h.masking = saved
    const got = await buildToolkit().settings!.nodaroMotionMasking!()
    expect(got).toEqual(saved)
    got!["motion-pro"]!.mode = "off"
    got!["motion-pro"]!.zone!.leftPct = 40
    expect(saved["motion-pro"]).toEqual({ mode: "auto", zone: { leftPct: 5 } })
  })
})

describe("the plugin-side types mirror the host's", () => {
  it("PluginFaceMasking is FaceMasking, both ways", () => {
    expectTypeOf<FaceMasking>().toEqualTypeOf<PluginFaceMasking>()
  })

  it("PluginNodaroMotionMasking is the stored setting", () => {
    expectTypeOf<NodaroMotionMasking>().toEqualTypeOf<PluginNodaroMotionMasking>()
  })
})
