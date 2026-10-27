import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest"
import type { FaceMasking } from "../../cast-swap-face-masking.js"
import type { CastSwapPromptPartId } from "@nodaro/render-rules"
import type {
  NodaroMotionMotion as PluginNodaroMotionMotion,
  NodaroMotionPromptParts as PluginNodaroMotionPromptParts,
  PluginFaceMasking,
  PluginNodaroMotionMasking,
  PluginPromptPartId,
} from "../types.js"
import type { NodaroMotionMotionForPlugin } from "../../nodaro-motion-motion.js"
import type { NodaroMotionMaskingForPlugin } from "../../nodaro-motion-masking.js"
import type { NodaroMotionPromptPartsForPlugin } from "../../nodaro-motion-prompt-parts.js"

/**
 * `tk.settings.nodaroMotionMasking()` — the admin's face masking per Nodaro
 * Motion engine, which the Cast Swap engine applies to every DIRECT run. It is
 * the settings cache's own read (`getAppSettings`, ~60 s, cleared on an admin
 * write), handed out as a copy, and null when never saved.
 */
const h = vi.hoisted(() => ({ masking: null as unknown, promptParts: null as unknown, motion: null as unknown, reads: 0, failed: false }))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../app-settings.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return {
    ...orig,
    getAppSettings: async () => {
      h.reads++
      return { nodaro_motion_masking: h.masking, nodaro_motion_prompt_parts: h.promptParts, nodaro_motion_motion: h.motion }
    },
    settingsReadFailed: () => h.failed,
  }
})

const { buildToolkit } = await import("../toolkit.js")

describe("tk.settings.nodaroMotionMasking", () => {
  beforeEach(() => {
    h.masking = null
    h.promptParts = null
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

/**
 * `tk.settings.nodaroMotionPromptParts()` — the admin's prompt part overrides
 * per Nodaro Motion engine and style, for every DIRECT run. Same rules as the
 * masking read: the settings cache's own read, a copy, null when never saved,
 * and a rejection (never null) when the settings could not be read.
 */
describe("tk.settings.nodaroMotionPromptParts", () => {
  beforeEach(() => {
    h.promptParts = null
    h.reads = 0
    h.failed = false
  })

  it("is advertised", () => {
    expect(buildToolkit().capabilities?.nodaroMotionPromptParts).toBe(true)
    expect(typeof buildToolkit().settings?.nodaroMotionPromptParts).toBe("function")
  })

  it("rejects when the settings could not be read, never answering null (the defaults)", async () => {
    h.failed = true
    await expect(buildToolkit().settings!.nodaroMotionPromptParts!()).rejects.toThrow(/could not be read/)
  })

  it("answers null when it was never saved", async () => {
    expect(await buildToolkit().settings!.nodaroMotionPromptParts!()).toBeNull()
    expect(h.reads).toBe(1)
  })

  it("answers the saved overrides under each engine's current and earlier key, each a copy the plugin may change", async () => {
    const saved = { "motion-prism": { motion: { avoid: "-" } }, "motion-pulse": { precise: { face: "Keep faces." } } }
    h.promptParts = saved
    const got = await buildToolkit().settings!.nodaroMotionPromptParts!()
    expect(got).toEqual({ ...saved, "motion-pro": saved["motion-prism"], "motion-lite": saved["motion-pulse"] })
    got!["motion-prism"]!.motion!.avoid = "changed"
    expect(got!["motion-pro"]!.motion!.avoid).toBe("-")
    expect(saved["motion-prism"].motion.avoid).toBe("-")
  })
})

/**
 * `tk.settings.nodaroMotionMotion()` — the admin's Motion setting per Nodaro
 * Motion engine, for direct runs with `style: "motion"`. Same rules as the
 * masking read.
 */
describe("tk.settings.nodaroMotionMotion", () => {
  beforeEach(() => {
    h.motion = null
    h.reads = 0
    h.failed = false
  })

  it("is advertised", () => {
    expect(buildToolkit().capabilities?.nodaroMotionMotion).toBe(true)
    expect(typeof buildToolkit().settings?.nodaroMotionMotion).toBe("function")
  })

  it("rejects when the settings could not be read, never answering null (the defaults)", async () => {
    h.failed = true
    await expect(buildToolkit().settings!.nodaroMotionMotion!()).rejects.toThrow(/could not be read/)
  })

  it("answers null when it was never saved, through the settings cache", async () => {
    expect(await buildToolkit().settings!.nodaroMotionMotion!()).toBeNull()
    expect(h.reads).toBe(1)
  })

  it("answers the saved setting under each engine's current and earlier key, each a copy the plugin may change", async () => {
    const saved = { "motion-prism": { masking: { mode: "always", source: "full-depth", scene: "none" }, promptStyle: "precise" }, "motion-pulse": { promptStyle: "flexible" } }
    h.motion = saved
    const got = await buildToolkit().settings!.nodaroMotionMotion!()
    expect(got).toEqual({ ...saved, "motion-pro": saved["motion-prism"], "motion-lite": saved["motion-pulse"] })
    ;(got!["motion-prism"]!.masking as { scene: string }).scene = "original"
    expect(got!["motion-pro"]!.masking!.scene).toBe("none")
    expect(saved["motion-prism"].masking.scene).toBe("none")
  })
})

describe("the plugin-side types mirror the host's", () => {
  it("what the host answers for the Motion setting (both key sets) is the plugin's NodaroMotionMotion", () => {
    expectTypeOf<NodaroMotionMotionForPlugin>().toExtend<PluginNodaroMotionMotion>()
  })

  it("PluginPromptPartId is render-rules' part id, both ways", () => {
    expectTypeOf<CastSwapPromptPartId>().toEqualTypeOf<PluginPromptPartId>()
  })

  it("what the host answers (both key sets) is the plugin's NodaroMotionPromptParts (its engine-keyed index shape)", () => {
    expectTypeOf<NodaroMotionPromptPartsForPlugin>().toExtend<PluginNodaroMotionPromptParts>()
  })

  it("PluginFaceMasking is FaceMasking, both ways", () => {
    expectTypeOf<FaceMasking>().toEqualTypeOf<PluginFaceMasking>()
  })

  it("PluginNodaroMotionMasking is what the host answers (both key sets)", () => {
    expectTypeOf<NodaroMotionMaskingForPlugin>().toEqualTypeOf<PluginNodaroMotionMasking>()
  })
})
