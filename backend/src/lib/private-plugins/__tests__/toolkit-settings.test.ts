import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest"
import type { FaceMasking } from "../../cast-swap-face-masking.js"
import type { PluginFaceMasking, PluginNodaroMotionMasking } from "../types.js"
import type { NodaroMotionMaskingForPlugin } from "../../nodaro-motion-masking.js"

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

  it("answers each engine's setting under its current and its earlier key, each a copy the plugin may change", async () => {
    const saved = { "motion-prism": { mode: "auto", zone: { leftPct: 5 } }, "motion-pulse": { mode: "always", target: "face" } }
    h.masking = saved
    const got = await buildToolkit().settings!.nodaroMotionMasking!()
    // The transition shim: a plugin up to 0.397.0 reads only "motion-pro" / "motion-lite".
    expect(got).toEqual({ ...saved, "motion-pro": saved["motion-prism"], "motion-lite": saved["motion-pulse"] })
    got!["motion-prism"]!.mode = "off"
    got!["motion-prism"]!.zone!.leftPct = 40
    expect(got!["motion-pro"]).toEqual({ mode: "auto", zone: { leftPct: 5 } })
    expect(saved["motion-prism"]).toEqual({ mode: "auto", zone: { leftPct: 5 } })
  })

  it("answers only the engines that were saved, under both keys", async () => {
    h.masking = { "motion-pulse": { mode: "auto" } }
    expect(await buildToolkit().settings!.nodaroMotionMasking!()).toEqual({ "motion-pulse": { mode: "auto" }, "motion-lite": { mode: "auto" } })
  })
})

describe("the plugin-side types mirror the host's", () => {
  it("PluginFaceMasking is FaceMasking, both ways", () => {
    expectTypeOf<FaceMasking>().toEqualTypeOf<PluginFaceMasking>()
  })

  it("PluginNodaroMotionMasking is what the host answers (both key sets)", () => {
    expectTypeOf<NodaroMotionMaskingForPlugin>().toEqualTypeOf<PluginNodaroMotionMasking>()
  })
})
