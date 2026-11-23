import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest"
import type { FaceMasking } from "../../cast-swap-face-masking.js"
import type { CastSwapPromptPartId } from "@nodaro/render-rules"
import type {
  NodaroMotionMotion as PluginNodaroMotionMotion,
  NodaroMotionPromptParts as PluginNodaroMotionPromptParts,
  PluginFaceMasking,
  PluginNodaroMotionMasking,
  PluginNodaroMotionPromptWording,
  PluginNodaroMotionStyle,
  PluginNodaroMotionStyleOnly,
  PluginNodaroMotionPreciseArtStyle,
  PluginNodaroMotionNoPerson,
  PluginNodaroMotionPreviz,
  PluginNodaroMotionShotLock,
  PluginNodaroMotionShotListFps,
  PluginNodaroMotionFlashModel,
  PluginPromptPartId,
  PluginSupports,
} from "../types.js"
import type { NodaroMotionMotionForPlugin } from "../../nodaro-motion-motion.js"
import type { NodaroMotionMaskingForPlugin } from "../../nodaro-motion-masking.js"
import type { NodaroMotionPromptPartsForPlugin } from "../../nodaro-motion-prompt-parts.js"
import type { NodaroMotionStyleForPlugin } from "../../nodaro-motion-style.js"
import type { NodaroMotionPromptWordingForPlugin } from "../../nodaro-motion-prompt-wording.js"
import type { NodaroMotionStyleOnlyEntry } from "../../nodaro-motion-style-only.js"
import type { NodaroMotionPreciseArtStyleForPlugin } from "../../nodaro-motion-precise-art-style.js"
import type { NodaroMotionNoPersonEntry } from "../../nodaro-motion-no-person.js"
import type { ByEngineForPlugin } from "../../nodaro-motion-engine-keys.js"
import type { NodaroMotionPrevizForPlugin } from "../../nodaro-motion-previz.js"
import type { NodaroMotionShotLockForPlugin } from "../../nodaro-motion-shot-lock.js"
import type { NodaroMotionShotListFpsForPlugin } from "../../nodaro-motion-shot-list-fps.js"
import type { NodaroMotionFlashModelForPlugin } from "../../nodaro-motion-flash-model.js"

/**
 * `tk.settings.nodaroMotionMasking()` — the admin's face masking per Video
 * Remake engine, which the Cast Swap engine applies to every DIRECT run. It is
 * the settings cache's own read (`getAppSettings`, ~60 s, cleared on an admin
 * write), handed out as a copy, and null when never saved.
 */
const h = vi.hoisted(() => ({ masking: null as unknown, promptParts: null as unknown, motion: null as unknown, steps: null as unknown, style: null as unknown, wording: null as unknown, styleOnly: null as unknown, preciseArtStyle: null as unknown, noPerson: null as unknown, preciseStyleRoute: null as unknown, preciseUpscale: null as unknown, topazDisabled: false, customStyle: null as unknown, planRoles: null as unknown, planRolesByDefault: true, previz: null as unknown, previzByDefault: true, shotLock: null as unknown, shotListFps: null as unknown, geminiKey: true, flashModel: null as unknown, faceGrow: null as unknown, admins: [] as string[], adminCheckFails: false, adminChecks: 0, offeredByDefault: true, reads: 0, failed: false }))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../app-settings.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return {
    ...orig,
    getAppSettings: async () => {
      h.reads++
      return { nodaro_motion_masking: h.masking, nodaro_motion_prompt_parts: h.promptParts, nodaro_motion_motion: h.motion, nodaro_motion_steps: h.steps, nodaro_motion_style: h.style, nodaro_motion_prompt_wording: h.wording, nodaro_motion_style_only: h.styleOnly, nodaro_motion_precise_art_style: h.preciseArtStyle, nodaro_motion_no_person: h.noPerson, nodaro_motion_precise_style_route: h.preciseStyleRoute, nodaro_motion_precise_upscale: h.preciseUpscale, nodaro_motion_custom_style: h.customStyle, nodaro_motion_plan_roles: h.planRoles, nodaro_motion_previz: h.previz, nodaro_motion_shot_lock: h.shotLock, nodaro_motion_shot_list_fps: h.shotListFps, nodaro_motion_flash_model: h.flashModel, nodaro_motion_face_grow: h.faceGrow }
    },
    settingsReadFailed: () => h.failed,
  }
})

vi.mock("../../llm/anthropic-availability.js", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  geminiKeySet: () => h.geminiKey,
}))

vi.mock("../../admin-check.js", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  checkIsAdmin: async (userId: string) => {
    h.adminChecks++
    if (h.adminCheckFails) throw new Error("Admin check failed: db down")
    return h.admins.includes(userId)
  },
}))
vi.mock("../../topaz-video-availability.js", () => ({ topazVideoDisabledHere: () => h.topazDisabled }))
vi.mock("../../nodaro-motion-custom-style-default.js", () => ({ customStyleOfferedByDefault: () => h.offeredByDefault }))
vi.mock("../../nodaro-motion-plan-roles-default.js", () => ({ planRolesOfferedByDefault: () => h.planRolesByDefault }))
vi.mock("../../nodaro-motion-previz-default.js", () => ({ previzOfferedByDefault: () => h.previzByDefault }))

const { buildToolkit } = await import("../toolkit.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../private-plugins/supports-registry.js")
const { filmedStyleIds } = await import("../../nodaro-motion-precise-style-route-engine.js")

/** A loaded Cast Swap engine that draws the face mesh, or one from before it (`castSwap.faceMesh` absent). */
const CS = { roleKinds: ["person"], fixedReferences: true, fullQuality: true, resolutions: ["480p"], trendRun: true } as const
const meshEngine = (faceMesh: boolean | undefined) =>
  setPluginSupports({ castSwap: { ...CS, ...(faceMesh === undefined ? {} : { faceMesh }) } } as never)

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
    const saved = { "nodaro-prism": { mode: "auto", zone: { leftPct: 5 } }, "nodaro-pulse": { mode: "always", target: "face" } }
    h.masking = saved
    const got = await buildToolkit().settings!.nodaroMotionMasking!()
    // The transition shim: a plugin up to 0.397.0 reads only "motion-pro" / "motion-lite".
    expect(got).toEqual({ ...saved, "motion-prism": saved["nodaro-prism"], "motion-pro": saved["nodaro-prism"], "motion-pulse": saved["nodaro-pulse"], "motion-lite": saved["nodaro-pulse"] })
    got!["nodaro-prism"]!.mode = "off"
    got!["nodaro-prism"]!.zone!.leftPct = 40
    expect(got!["motion-pro"]).toEqual({ mode: "auto", zone: { leftPct: 5 } })
    expect(saved["nodaro-prism"]).toEqual({ mode: "auto", zone: { leftPct: 5 } })
  })

  it("merges the face grow (its own row) into each engine's masking, answered only where it grows and only to an engine that declares castSwap.faceGrow", async () => {
    h.masking = { "nodaro-prism": { mode: "always", target: "face" }, "nodaro-pulse": { mode: "always", target: "head" } }
    h.faceGrow = { "nodaro-prism": 18, "nodaro-pulse": 18 }
    try {
      setPluginSupports({ castSwap: { ...CS, faceGrow: true } } as never)
      const got = await buildToolkit().settings!.nodaroMotionMasking!()
      expect(got!["nodaro-prism"]).toEqual({ mode: "always", target: "face", growPct: 18 })
      // The head target is covered whole: the grow changes nothing there, so it is never sent.
      expect(got!["nodaro-pulse"]).toEqual({ mode: "always", target: "head" })
      // An engine from before it: no key at all, the setting exactly as before the key existed.
      setPluginSupports({ castSwap: { ...CS } } as never)
      const older = await buildToolkit().settings!.nodaroMotionMasking!()
      expect(older!["nodaro-prism"]).toEqual({ mode: "always", target: "face" })
      // No grow saved: the masking exactly as stored.
      h.faceGrow = null
      setPluginSupports({ castSwap: { ...CS, faceGrow: true } } as never)
      expect((await buildToolkit().settings!.nodaroMotionMasking!())!["nodaro-prism"]).toEqual({ mode: "always", target: "face" })
    } finally {
      h.faceGrow = null
      _resetPluginSupportsForTests()
    }
  })

  it("answers only the engines that were saved, under both keys", async () => {
    h.masking = { "nodaro-pulse": { mode: "auto" } }
    expect(await buildToolkit().settings!.nodaroMotionMasking!()).toEqual({ "nodaro-pulse": { mode: "auto" }, "motion-pulse": { mode: "auto" }, "motion-lite": { mode: "auto" } })
  })

  it("answers the face mesh only to an engine that draws it, and only as true (an older engine's strict schema would refuse the entry)", async () => {
    h.masking = { "nodaro-prism": { mode: "always", faceMesh: true }, "nodaro-pulse": { mode: "auto", faceMesh: false } }
    try {
      meshEngine(true)
      expect(await buildToolkit().settings!.nodaroMotionMasking!()).toEqual({
        "nodaro-prism": { mode: "always", faceMesh: true },
        "motion-prism": { mode: "always", faceMesh: true },
        "motion-pro": { mode: "always", faceMesh: true },
        "nodaro-pulse": { mode: "auto" },
        "motion-pulse": { mode: "auto" },
        "motion-lite": { mode: "auto" },
      })
      for (const faceMesh of [undefined, false]) {
        meshEngine(faceMesh)
        const got = await buildToolkit().settings!.nodaroMotionMasking!()
        expect(got, String(faceMesh)).toEqual({ "nodaro-prism": { mode: "always" }, "motion-prism": { mode: "always" }, "motion-pro": { mode: "always" }, "nodaro-pulse": { mode: "auto" }, "motion-pulse": { mode: "auto" }, "motion-lite": { mode: "auto" } })
        expect(Object.values(got!).some((m) => m && Object.hasOwn(m, "faceMesh"))).toBe(false)
      }
    } finally {
      _resetPluginSupportsForTests()
    }
  })
})

/**
 * `tk.settings.nodaroMotionPromptParts()` — the admin's prompt part overrides
 * per Video Remake engine and style, for every DIRECT run. Same rules as the
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
    const saved = { "nodaro-prism": { motion: { avoid: "-" } }, "nodaro-pulse": { precise: { face: "Keep faces." } } }
    h.promptParts = saved
    const got = await buildToolkit().settings!.nodaroMotionPromptParts!()
    expect(got).toEqual({ ...saved, "motion-prism": saved["nodaro-prism"], "motion-pro": saved["nodaro-prism"], "motion-pulse": saved["nodaro-pulse"], "motion-lite": saved["nodaro-pulse"] })
    got!["nodaro-prism"]!.motion!.avoid = "changed"
    expect(got!["motion-pro"]!.motion!.avoid).toBe("-")
    expect(saved["nodaro-prism"].motion.avoid).toBe("-")
  })
})

/**
 * `tk.settings.nodaroMotionMotion()` — the admin's Motion setting per Video
 * Remake engine, for direct runs with `style: "motion"`. Same rules as the
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
    const saved = { "nodaro-prism": { masking: { mode: "always", source: "full-depth", scene: "none" }, promptStyle: "precise" }, "nodaro-pulse": { promptStyle: "flexible" } }
    h.motion = saved
    const got = await buildToolkit().settings!.nodaroMotionMotion!()
    expect(got).toEqual({ ...saved, "motion-prism": saved["nodaro-prism"], "motion-pro": saved["nodaro-prism"], "motion-pulse": saved["nodaro-pulse"], "motion-lite": saved["nodaro-pulse"] })
    ;(got!["nodaro-prism"]!.masking as { scene: string }).scene = "original"
    expect(got!["motion-pro"]!.masking!.scene).toBe("none")
    expect(saved["nodaro-prism"].masking.scene).toBe("none")
  })

  it("answers each masking's face mesh only to an engine that draws it, the rest of the entry as saved", async () => {
    h.motion = {
      "nodaro-prism": { masking: { mode: "always", source: "full-depth", faceMesh: true }, promptStyle: "precise" },
      "nodaro-pulse": { promptStyle: "flexible" },
    }
    try {
      meshEngine(true)
      const drawn = await buildToolkit().settings!.nodaroMotionMotion!()
      expect(drawn!["nodaro-prism"]).toEqual({ masking: { mode: "always", source: "full-depth", faceMesh: true }, promptStyle: "precise" })
      expect(drawn!["motion-pro"]).toEqual(drawn!["nodaro-prism"])
      meshEngine(undefined)
      const older = await buildToolkit().settings!.nodaroMotionMotion!()
      expect(older!["nodaro-prism"]).toEqual({ masking: { mode: "always", source: "full-depth" }, promptStyle: "precise" })
      expect(older!["motion-pro"]).toEqual({ masking: { mode: "always", source: "full-depth" }, promptStyle: "precise" })
      expect(older!["nodaro-pulse"]).toEqual({ promptStyle: "flexible" })
    } finally {
      _resetPluginSupportsForTests()
    }
  })
})

describe("tk.settings: the depth colormap", () => {
  beforeEach(() => {
    h.masking = null
    h.motion = null
    h.failed = false
  })

  it("answers a colormap only to an engine that lists the map, and only where it changes what is drawn", async () => {
    h.masking = {
      "nodaro-prism": { mode: "always", fill: "depth", depthColormap: "inferno" },
      // The default of a depth fill: never answered, whatever the engine lists.
      "nodaro-pulse": { mode: "always", fill: "depth", depthColormap: "turbo" },
    }
    h.motion = { "nodaro-prism": { masking: { mode: "always", source: "full-depth", depthColormap: "magma" } } }
    try {
      setPluginSupports({ castSwap: { ...CS, depthColormaps: ["turbo", "inferno", "magma"] } } as never)
      const masking = await buildToolkit().settings!.nodaroMotionMasking!()
      expect(masking!["nodaro-prism"]).toEqual({ mode: "always", fill: "depth", depthColormap: "inferno" })
      expect(masking!["motion-pro"]).toEqual(masking!["nodaro-prism"])
      expect(masking!["nodaro-pulse"]).toEqual({ mode: "always", fill: "depth" })
      const motion = await buildToolkit().settings!.nodaroMotionMotion!()
      expect(motion!["nodaro-prism"]).toEqual({ masking: { mode: "always", source: "full-depth", depthColormap: "magma" } })
      for (const castSwap of [CS, { ...CS, depthColormaps: ["grayscale"] }]) {
        setPluginSupports({ castSwap } as never)
        const older = await buildToolkit().settings!.nodaroMotionMasking!()
        expect(older!["nodaro-prism"], JSON.stringify(castSwap)).toEqual({ mode: "always", fill: "depth" })
        expect(Object.values(older!).some((m) => m && Object.hasOwn(m, "depthColormap"))).toBe(false)
        const olderMotion = await buildToolkit().settings!.nodaroMotionMotion!()
        expect(olderMotion!["nodaro-prism"]).toEqual({ masking: { mode: "always", source: "full-depth" } })
      }
    } finally {
      _resetPluginSupportsForTests()
    }
  })
})

describe("tk.settings: the depth model size", () => {
  beforeEach(() => {
    h.masking = null
    h.motion = null
    h.failed = false
  })

  it("answers a size only to an engine that lists it, and only where it changes the render", async () => {
    h.masking = {
      "nodaro-prism": { mode: "always", fill: "depth", depthModelSize: "small" },
      // Large (the default): never answered, whatever the engine lists.
      "nodaro-pulse": { mode: "always", fill: "depth", depthModelSize: "large" },
    }
    h.motion = {
      "nodaro-prism": { masking: { mode: "always", source: "full-depth", depthModelSize: "base" } },
      // A blur fill draws no depth: never answered.
      "nodaro-pulse": { masking: { mode: "always", depthModelSize: "small" } },
    }
    try {
      setPluginSupports({ castSwap: { ...CS, depthModelSizes: ["small", "base", "large"] } } as never)
      const masking = await buildToolkit().settings!.nodaroMotionMasking!()
      expect(masking!["nodaro-prism"]).toEqual({ mode: "always", fill: "depth", depthModelSize: "small" })
      expect(masking!["nodaro-pulse"]).toEqual({ mode: "always", fill: "depth" })
      expect(masking!["motion-pro"]).toEqual(masking!["nodaro-prism"])
      const motion = await buildToolkit().settings!.nodaroMotionMotion!()
      expect(motion!["nodaro-prism"]).toEqual({ masking: { mode: "always", source: "full-depth", depthModelSize: "base" } })
      expect(motion!["nodaro-pulse"]).toEqual({ masking: { mode: "always" } })
      for (const castSwap of [CS, { ...CS, depthModelSizes: ["large"] }]) {
        setPluginSupports({ castSwap } as never)
        const older = await buildToolkit().settings!.nodaroMotionMasking!()
        expect(older!["nodaro-prism"], JSON.stringify(castSwap)).toEqual({ mode: "always", fill: "depth" })
        expect(Object.values(older!).some((m) => m && Object.hasOwn(m, "depthModelSize"))).toBe(false)
        const olderMotion = await buildToolkit().settings!.nodaroMotionMotion!()
        expect(olderMotion!["nodaro-prism"]).toEqual({ masking: { mode: "always", source: "full-depth" } })
      }
    } finally {
      _resetPluginSupportsForTests()
    }
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

/**
 * `tk.settings.nodaroMotionSteps()` — the admin's preparation steps per Video
 * Remake engine, for every DIRECT run: only to an engine that takes steps
 * (`castSwap.steps`), null otherwise and when never saved.
 */
describe("tk.settings.nodaroMotionSteps", () => {
  beforeEach(() => {
    h.steps = null
    h.reads = 0
    h.failed = false
    _resetPluginSupportsForTests()
  })
  const stepsEngine = (steps: boolean | undefined) =>
    setPluginSupports({ castSwap: { ...CS, ...(steps === undefined ? {} : { steps }) } } as never)
  const saved = { "nodaro-prism": { enginePrompt: { mode: "template" } }, "nodaro-pulse": { sceneDescription: { mode: "template" } } }

  it("is advertised", () => {
    expect(buildToolkit().capabilities?.nodaroMotionSteps).toBe(true)
    expect(typeof buildToolkit().settings?.nodaroMotionSteps).toBe("function")
  })

  it("rejects when the settings could not be read, never answering null (today's run)", async () => {
    stepsEngine(true)
    h.failed = true
    await expect(buildToolkit().settings!.nodaroMotionSteps!()).rejects.toThrow(/could not be read/)
  })

  it("answers null when it was never saved, or nothing is set", async () => {
    stepsEngine(true)
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toBeNull()
    h.steps = { "nodaro-prism": {} }
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toBeNull()
  })

  it("reads the saved row under the current and the earlier keys, each a copy the plugin may change", async () => {
    stepsEngine(true)
    h.steps = saved
    const got = await buildToolkit().settings!.nodaroMotionSteps!()
    expect(got).toEqual({ ...saved, "motion-prism": saved["nodaro-prism"], "motion-pro": saved["nodaro-prism"], "motion-pulse": saved["nodaro-pulse"], "motion-lite": saved["nodaro-pulse"] })
    ;(got!["nodaro-prism"] as { enginePrompt?: unknown }).enginePrompt = undefined
    expect(saved["nodaro-prism"]).toEqual({ enginePrompt: { mode: "template" } })
  })

  it("answers clipBody only to an engine that declares castSwap.clipBodySheet, dropping an entry left empty", async () => {
    h.steps = {
      "nodaro-prism": { enginePrompt: { mode: "template" }, clipBody: { mode: "off" } },
      "nodaro-pulse": { clipBody: { mode: "on", prompt: "A test prompt." } },
    }
    setPluginSupports({ castSwap: { ...CS, steps: true, clipBodySheet: true } } as never)
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toEqual({
      "nodaro-prism": { enginePrompt: { mode: "template" }, clipBody: { mode: "off" } },
      "motion-prism": { enginePrompt: { mode: "template" }, clipBody: { mode: "off" } },
      "motion-pro": { enginePrompt: { mode: "template" }, clipBody: { mode: "off" } },
      "nodaro-pulse": { clipBody: { mode: "on", prompt: "A test prompt." } },
      "motion-pulse": { clipBody: { mode: "on", prompt: "A test prompt." } },
      "motion-lite": { clipBody: { mode: "on", prompt: "A test prompt." } },
    })
    stepsEngine(true)
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toEqual({
      "nodaro-prism": { enginePrompt: { mode: "template" } },
      "motion-prism": { enginePrompt: { mode: "template" } },
      "motion-pro": { enginePrompt: { mode: "template" } },
    })
    h.steps = { "nodaro-pulse": { clipBody: { mode: "off" } } }
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toBeNull()
  })

  it("answers shotList only to an engine that declares castSwap.shotList", async () => {
    h.steps = { "nodaro-prism": { enginePrompt: { mode: "template" }, shotList: { precise: { mode: "on" } } } }
    setPluginSupports({ castSwap: { ...CS, steps: true, shotList: true } } as never)
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toEqual({
      "nodaro-prism": { enginePrompt: { mode: "template" }, shotList: { precise: { mode: "on" } } },
      "motion-prism": { enginePrompt: { mode: "template" }, shotList: { precise: { mode: "on" } } },
      "motion-pro": { enginePrompt: { mode: "template" }, shotList: { precise: { mode: "on" } } },
    })
    stepsEngine(true)
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toEqual({
      "nodaro-prism": { enginePrompt: { mode: "template" } },
      "motion-prism": { enginePrompt: { mode: "template" } },
      "motion-pro": { enginePrompt: { mode: "template" } },
    })
  })

  it("answers a shot list style's speech only to an engine that declares castSwap.shotListSpeech (the rest of the shot list kept)", async () => {
    const speech = { shotList: { precise: { mode: "on", speech: "who" }, flex: { mode: "on", speech: "words" } } }
    h.steps = { "nodaro-prism": speech }
    setPluginSupports({ castSwap: { ...CS, steps: true, shotList: true, shotListSpeech: true } } as never)
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toEqual({ "nodaro-prism": speech, "motion-prism": speech, "motion-pro": speech })
    setPluginSupports({ castSwap: { ...CS, steps: true, shotList: true } } as never)
    const without = { shotList: { precise: { mode: "on" }, flex: { mode: "on" } } }
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toEqual({ "nodaro-prism": without, "motion-prism": without, "motion-pro": without })
  })

  it("answers styleRefs only to an engine that declares castSwap.styleRefs", async () => {
    h.steps = { "nodaro-prism": { enginePrompt: { mode: "template" }, styleRefs: { mode: "on", send: "styled" } } }
    setPluginSupports({ castSwap: { ...CS, steps: true, styleRefs: true } } as never)
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toEqual({
      "nodaro-prism": { enginePrompt: { mode: "template" }, styleRefs: { mode: "on", send: "styled" } },
      "motion-prism": { enginePrompt: { mode: "template" }, styleRefs: { mode: "on", send: "styled" } },
      "motion-pro": { enginePrompt: { mode: "template" }, styleRefs: { mode: "on", send: "styled" } },
    })
    stepsEngine(true)
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toEqual({
      "nodaro-prism": { enginePrompt: { mode: "template" } },
      "motion-prism": { enginePrompt: { mode: "template" } },
      "motion-pro": { enginePrompt: { mode: "template" } },
    })
    h.steps = { "nodaro-pulse": { styleRefs: { mode: "off" } } }
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toBeNull()
  })

  it("answers null to an engine without castSwap.steps", async () => {
    h.steps = saved
    stepsEngine(undefined)
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toBeNull()
    stepsEngine(false)
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toBeNull()
  })
})

/**
 * `tk.settings.nodaroMotionStyle()` — the admin's Style choice per Video
 * Remake engine, which the Cast Swap engine enforces on every DIRECT run and
 * quote: null when never saved or nothing is forced (the request's `style`
 * decides, exactly as before), else only the forced engines.
 */
describe("tk.settings.nodaroMotionStyle", () => {
  beforeEach(() => {
    h.style = null
    h.reads = 0
    h.failed = false
  })

  it("is advertised", () => {
    expect(buildToolkit().capabilities?.nodaroMotionStyle).toBe(true)
    expect(typeof buildToolkit().settings?.nodaroMotionStyle).toBe("function")
  })

  it("rejects when the settings could not be read, never answering null (people choose)", async () => {
    h.failed = true
    await expect(buildToolkit().settings!.nodaroMotionStyle!()).rejects.toThrow(/could not be read/)
  })

  it("answers null when it was never saved, or nothing is forced", async () => {
    expect(await buildToolkit().settings!.nodaroMotionStyle!()).toBeNull()
    h.style = {}
    expect(await buildToolkit().settings!.nodaroMotionStyle!()).toBeNull()
    expect(h.reads).toBe(2)
  })

  it("answers each forced engine under the current and the earlier key, a copy the plugin may change", async () => {
    h.style = { "nodaro-pulse": "flex" }
    const got = await buildToolkit().settings!.nodaroMotionStyle!()
    expect(got).toEqual({ "nodaro-pulse": "flex", "motion-pulse": "flex", "motion-lite": "flex" })
    ;(got as Record<string, string>)["nodaro-pulse"] = "precise"
    expect(h.style).toEqual({ "nodaro-pulse": "flex" })
  })

  it("what the host answers is the plugin's PluginNodaroMotionStyle", () => {
    expectTypeOf<NodaroMotionStyleForPlugin>().toExtend<PluginNodaroMotionStyle>()
  })
})

/**
 * `tk.settings.nodaroMotionPromptWording()` — the admin's Flex prompt wording
 * per Video Remake engine, which the Cast Swap engine reads for every DIRECT
 * Flex run: null when never saved or every engine is current (today's
 * wording, exactly as before), else only the engines on the new wording.
 */
describe("tk.settings.nodaroMotionPromptWording", () => {
  beforeEach(() => {
    h.wording = null
    h.reads = 0
    h.failed = false
  })

  it("is advertised", () => {
    expect(buildToolkit().capabilities?.nodaroMotionPromptWording).toBe(true)
    expect(typeof buildToolkit().settings?.nodaroMotionPromptWording).toBe("function")
  })

  it("rejects when the settings could not be read, never answering null (the current wording)", async () => {
    h.failed = true
    await expect(buildToolkit().settings!.nodaroMotionPromptWording!()).rejects.toThrow(/could not be read/)
  })

  it("answers null when it was never saved, or every engine is current", async () => {
    expect(await buildToolkit().settings!.nodaroMotionPromptWording!()).toBeNull()
    h.wording = {}
    expect(await buildToolkit().settings!.nodaroMotionPromptWording!()).toBeNull()
    h.wording = { "nodaro-prism": "current" }
    expect(await buildToolkit().settings!.nodaroMotionPromptWording!()).toBeNull()
    expect(h.reads).toBe(3)
  })

  it("answers each engine on the new wording under the current and the earlier key, a copy the plugin may change", async () => {
    h.wording = { "nodaro-pulse": "new" }
    const got = await buildToolkit().settings!.nodaroMotionPromptWording!()
    expect(got).toEqual({ "nodaro-pulse": "new", "motion-pulse": "new", "motion-lite": "new" })
    ;(got as Record<string, string>)["nodaro-pulse"] = "current"
    expect(h.wording).toEqual({ "nodaro-pulse": "new" })
  })

  it("what the host answers is the plugin's PluginNodaroMotionPromptWording", () => {
    expectTypeOf<NodaroMotionPromptWordingForPlugin>().toExtend<PluginNodaroMotionPromptWording>()
  })
})

/**
 * `tk.settings.nodaroMotionStyleOnly()` — the admin's style-only setting per
 * Video Remake engine (its path and its engine-prompt step), read by the Cast
 * Swap engine for a DIRECT style-only run: null when never saved, nothing
 * differs from the defaults, or this host's engine does not declare
 * `castSwap.styleOnly`.
 */
describe("tk.settings.nodaroMotionStyleOnly", () => {
  beforeEach(() => {
    h.styleOnly = null
    h.reads = 0
    h.failed = false
    _resetPluginSupportsForTests()
  })
  const styleOnlyEngine = () => setPluginSupports({ castSwap: { ...CS, styleOnly: true } } as never)

  it("advertises nodaroMotionStyleOnly and answers null to an engine without castSwap.styleOnly", async () => {
    expect(buildToolkit().capabilities?.nodaroMotionStyleOnly).toBe(true)
    expect(typeof buildToolkit().settings?.nodaroMotionStyleOnly).toBe("function")
    h.styleOnly = { "nodaro-prism": { path: "flex" } }
    expect(await buildToolkit().settings!.nodaroMotionStyleOnly!()).toBeNull()
    setPluginSupports({ castSwap: { ...CS, styleOnly: false } } as never)
    expect(await buildToolkit().settings!.nodaroMotionStyleOnly!()).toBeNull()
    expect(h.reads).toBe(2)
  })

  it("rejects when the settings could not be read, never answering null (the original path)", async () => {
    styleOnlyEngine()
    h.failed = true
    await expect(buildToolkit().settings!.nodaroMotionStyleOnly!()).rejects.toThrow(/could not be read/)
  })

  it("answers null when it was never saved, or nothing differs from the defaults", async () => {
    styleOnlyEngine()
    expect(await buildToolkit().settings!.nodaroMotionStyleOnly!()).toBeNull()
    h.styleOnly = {}
    expect(await buildToolkit().settings!.nodaroMotionStyleOnly!()).toBeNull()
    h.styleOnly = { "nodaro-prism": { path: "original", enginePrompt: { mode: "template" } } }
    expect(await buildToolkit().settings!.nodaroMotionStyleOnly!()).toBeNull()
  })

  it("answers each changed engine under its current and its earlier key, a copy the plugin may change", async () => {
    styleOnlyEngine()
    const llm = { mode: "llm", llm: { model: "gemini-3.8-flash", inputs: ["clip"], maxChars: 900 } }
    h.styleOnly = { "nodaro-prism": { path: "flex", enginePrompt: llm } }
    const got = await buildToolkit().settings!.nodaroMotionStyleOnly!()
    expect(got).toStrictEqual({ "nodaro-prism": { path: "flex", enginePrompt: llm }, "motion-prism": { path: "flex", enginePrompt: llm }, "motion-pro": { path: "flex", enginePrompt: llm } })
    ;(got as Record<string, { path?: string }>)["nodaro-prism"]!.path = "original"
    expect(h.styleOnly).toEqual({ "nodaro-prism": { path: "flex", enginePrompt: llm } })
    expect(got!["motion-pro"]!.path).toBe("flex")
  })

  it("what the host answers is the plugin's PluginNodaroMotionStyleOnly", () => {
    expectTypeOf<ByEngineForPlugin<NodaroMotionStyleOnlyEntry>>().toExtend<PluginNodaroMotionStyleOnly>()
  })
})

/**
 * `tk.settings.nodaroMotionNoPerson()` — whether a DIRECT Precise run with no
 * pictured person sends its source clip, per Video Remake engine: null when
 * never saved, nothing is switched off, or this host's engine does not declare
 * `castSwap.noPersonSourceClip`.
 */
describe("tk.settings.nodaroMotionNoPerson", () => {
  beforeEach(() => {
    h.noPerson = null
    h.reads = 0
    h.failed = false
    _resetPluginSupportsForTests()
  })
  const noPersonEngine = () => setPluginSupports({ castSwap: { ...CS, noPersonSourceClip: true } } as never)

  it("advertises nodaroMotionNoPerson and answers null to an engine without castSwap.noPersonSourceClip", async () => {
    expect(buildToolkit().capabilities?.nodaroMotionNoPerson).toBe(true)
    expect(typeof buildToolkit().settings?.nodaroMotionNoPerson).toBe("function")
    h.noPerson = { "nodaro-prism": { sourceClip: false } }
    expect(await buildToolkit().settings!.nodaroMotionNoPerson!()).toBeNull()
    setPluginSupports({ castSwap: { ...CS, noPersonSourceClip: false } } as never)
    expect(await buildToolkit().settings!.nodaroMotionNoPerson!()).toBeNull()
    expect(h.reads).toBe(2)
  })

  it("rejects when the settings could not be read, never answering null (on for every engine)", async () => {
    noPersonEngine()
    h.failed = true
    await expect(buildToolkit().settings!.nodaroMotionNoPerson!()).rejects.toThrow(/could not be read/)
  })

  it("answers null when it was never saved, or nothing is switched off", async () => {
    noPersonEngine()
    expect(await buildToolkit().settings!.nodaroMotionNoPerson!()).toBeNull()
    h.noPerson = {}
    expect(await buildToolkit().settings!.nodaroMotionNoPerson!()).toBeNull()
    h.noPerson = { "nodaro-prism": {} }
    expect(await buildToolkit().settings!.nodaroMotionNoPerson!()).toBeNull()
  })

  it("answers each engine switched off under its current and its earlier key, a copy the plugin may change", async () => {
    noPersonEngine()
    h.noPerson = { "nodaro-pulse": { sourceClip: false } }
    const got = await buildToolkit().settings!.nodaroMotionNoPerson!()
    expect(got).toStrictEqual({ "nodaro-pulse": { sourceClip: false }, "motion-pulse": { sourceClip: false }, "motion-lite": { sourceClip: false } })
    delete (got as Record<string, { sourceClip?: false }>)["nodaro-pulse"]!.sourceClip
    expect(h.noPerson).toEqual({ "nodaro-pulse": { sourceClip: false } })
    expect(got!["motion-lite"]!.sourceClip).toBe(false)
  })

  it("what the host answers is the plugin's PluginNodaroMotionNoPerson", () => {
    expectTypeOf<ByEngineForPlugin<NodaroMotionNoPersonEntry>>().toExtend<PluginNodaroMotionNoPerson>()
  })

  it("the engine's two flags are part of what it declares", () => {
    expectTypeOf<NonNullable<PluginSupports["castSwap"]>["noPersonSourceClip"]>().toEqualTypeOf<boolean | undefined>()
    expectTypeOf<NonNullable<PluginSupports["castSwap"]>["preciseArtStyleAlone"]>().toEqualTypeOf<boolean | undefined>()
  })
})

/**
 * `tk.settings.nodaroMotionPreciseArtStyle()` — the admin's opener per Video Remake engine for a DIRECT Precise run
 * with an art style: null when never saved, nothing differs from the default ("restyle"), or this host's engine does
 * not declare `castSwap.preciseArtStyle`.
 */
describe("tk.settings.nodaroMotionPreciseArtStyle", () => {
  beforeEach(() => {
    h.preciseArtStyle = null
    h.reads = 0
    h.failed = false
    _resetPluginSupportsForTests()
  })
  const preciseArtStyleEngine = () => setPluginSupports({ castSwap: { ...CS, preciseArtStyle: true } } as never)

  it("advertises errorHintPromptSubject: a safety-block hint may say the provider named the prompt", () => {
    expect(buildToolkit().capabilities?.errorHintPromptSubject).toBe(true)
  })

  it("advertises nodaroMotionPreciseArtStyle and answers null to an engine without castSwap.preciseArtStyle", async () => {
    expect(buildToolkit().capabilities?.nodaroMotionPreciseArtStyle).toBe(true)
    expect(typeof buildToolkit().settings?.nodaroMotionPreciseArtStyle).toBe("function")
    h.preciseArtStyle = { "nodaro-prism": { opener: "edit" } }
    expect(await buildToolkit().settings!.nodaroMotionPreciseArtStyle!()).toBeNull()
    setPluginSupports({ castSwap: { ...CS, preciseArtStyle: false } } as never)
    expect(await buildToolkit().settings!.nodaroMotionPreciseArtStyle!()).toBeNull()
    expect(h.reads).toBe(2)
  })

  it("rejects when the settings could not be read, never answering null (the default opener)", async () => {
    preciseArtStyleEngine()
    h.failed = true
    await expect(buildToolkit().settings!.nodaroMotionPreciseArtStyle!()).rejects.toThrow(/could not be read/)
  })

  it("answers null when it was never saved, or nothing differs from the default", async () => {
    preciseArtStyleEngine()
    expect(await buildToolkit().settings!.nodaroMotionPreciseArtStyle!()).toBeNull()
    h.preciseArtStyle = { "nodaro-prism": { opener: "restyle" } }
    expect(await buildToolkit().settings!.nodaroMotionPreciseArtStyle!()).toBeNull()
  })

  it("answers each changed engine under its current and its earlier key, a copy the plugin may change", async () => {
    preciseArtStyleEngine()
    h.preciseArtStyle = { "nodaro-prism": { opener: "edit", styleRefs: { mode: "on", send: "styled" } } }
    const got = await buildToolkit().settings!.nodaroMotionPreciseArtStyle!()
    expect(got).toStrictEqual({
      "nodaro-prism": { opener: "edit", styleRefs: { mode: "on", send: "styled" } },
      "motion-prism": { opener: "edit", styleRefs: { mode: "on", send: "styled" } },
      "motion-pro": { opener: "edit", styleRefs: { mode: "on", send: "styled" } },
    })
    ;(got as Record<string, { opener?: string }>)["nodaro-prism"]!.opener = "restyle"
    expect(h.preciseArtStyle).toEqual({ "nodaro-prism": { opener: "edit", styleRefs: { mode: "on", send: "styled" } } })
  })

  it("what the host answers is the plugin's PluginNodaroMotionPreciseArtStyle", () => {
    expectTypeOf<NodaroMotionPreciseArtStyleForPlugin>().toExtend<PluginNodaroMotionPreciseArtStyle>()
  })
})

describe("tk.settings: the face mesh's layers", () => {
  beforeEach(() => {
    h.masking = null
    h.motion = null
    h.failed = false
  })

  it("answers layers only to an engine that declares them; a set a parts value names as that value; none with the mesh off", async () => {
    h.motion = {
      "nodaro-prism": { masking: { mode: "always", source: "full-depth", faceMesh: true, faceMeshLayers: { eyes: true, irises: true, bold: true } } },
      "nodaro-pulse": { masking: { mode: "always", source: "full-depth", faceMesh: true, faceMeshLayers: { lips: true } } },
    }
    try {
      setPluginSupports({ castSwap: { ...CS, faceMesh: true, faceMeshParts: ["full", "features", "mouth"], faceMeshLayers: true } } as never)
      const motion = await buildToolkit().settings!.nodaroMotionMotion!()
      expect(motion!["nodaro-prism"]).toEqual({ masking: { mode: "always", source: "full-depth", faceMesh: true, faceMeshLayers: { eyes: true, irises: true, bold: true } } })
      expect(motion!["nodaro-pulse"]).toEqual({ masking: { mode: "always", source: "full-depth", faceMesh: true, faceMeshParts: "mouth" } })
      // An engine without layers: no key (it draws the full mesh), a parts set still as its value where it draws parts.
      setPluginSupports({ castSwap: { ...CS, faceMesh: true, faceMeshParts: ["full", "features", "mouth"] } } as never)
      const older = await buildToolkit().settings!.nodaroMotionMotion!()
      expect(older!["nodaro-prism"]).toEqual({ masking: { mode: "always", source: "full-depth", faceMesh: true } })
      expect(older!["nodaro-pulse"]).toEqual({ masking: { mode: "always", source: "full-depth", faceMesh: true, faceMeshParts: "mouth" } })
      // The mesh off: never answered.
      h.motion = { "nodaro-prism": { masking: { mode: "always", source: "full-depth", faceMeshLayers: { irises: true } } } }
      setPluginSupports({ castSwap: { ...CS, faceMesh: true, faceMeshLayers: true } } as never)
      const off = await buildToolkit().settings!.nodaroMotionMotion!()
      expect(off!["nodaro-prism"]).toEqual({ masking: { mode: "always", source: "full-depth" } })
    } finally {
      _resetPluginSupportsForTests()
    }
  })

  it("the routed setting's layers only to an engine that draws them", async () => {
    try {
      h.preciseStyleRoute = { faceMesh: true, faceMeshLayers: { irises: true } }
      setPluginSupports({ castSwap: { ...CS, preciseStyleRoute: true, faceMeshLayers: true } } as never)
      expect(await buildToolkit().settings!.nodaroMotionPreciseStyleRoute!()).toStrictEqual({ faceMesh: true, faceMeshLayers: { irises: true } })
      setPluginSupports({ castSwap: { ...CS, preciseStyleRoute: true } } as never)
      expect(await buildToolkit().settings!.nodaroMotionPreciseStyleRoute!()).toStrictEqual({ faceMesh: true })
      h.preciseStyleRoute = { faceMeshLayers: { irises: true } }
      expect(await buildToolkit().settings!.nodaroMotionPreciseStyleRoute!()).toBeNull()
    } finally {
      h.preciseStyleRoute = null
      _resetPluginSupportsForTests()
    }
  })

  it("the capability is declared", () => {
    expect(buildToolkit().capabilities?.videoFaceMeshLayers).toBe(true)
    expect(buildToolkit().capabilities?.videoMaskTracks).toBe(true)
  })
})

describe("tk.settings: the depth blur and the face mesh's parts", () => {
  beforeEach(() => {
    h.masking = null
    h.motion = null
    h.failed = false
  })

  it("answers each only to an engine that declares it, and only where it changes what is drawn", async () => {
    h.motion = {
      "nodaro-prism": { masking: { mode: "always", source: "full-depth", faceMesh: true, depthBlur: 28, faceMeshParts: "features" } },
      // 0 and the full mesh: never answered, whatever the engine declares.
      "nodaro-pulse": { masking: { mode: "always", source: "full-depth", faceMesh: true, depthBlur: 0, faceMeshParts: "full" } },
    }
    try {
      setPluginSupports({ castSwap: { ...CS, faceMesh: true, depthBlur: true, faceMeshParts: ["full", "features", "mouth"] } } as never)
      const motion = await buildToolkit().settings!.nodaroMotionMotion!()
      expect(motion!["nodaro-prism"]).toEqual({ masking: { mode: "always", source: "full-depth", faceMesh: true, depthBlur: 28, faceMeshParts: "features" } })
      expect(motion!["motion-pro"]).toEqual(motion!["nodaro-prism"])
      expect(motion!["nodaro-pulse"]).toEqual({ masking: { mode: "always", source: "full-depth", faceMesh: true } })
      // An engine from before them (or one without the mesh): the setting as it was before the keys existed.
      for (const castSwap of [{ ...CS, faceMesh: true }, { ...CS, faceMesh: true, depthBlur: true, faceMeshParts: ["full", "mouth"] }, CS]) {
        setPluginSupports({ castSwap } as never)
        const older = await buildToolkit().settings!.nodaroMotionMotion!()
        const m = (older!["nodaro-prism"] as unknown as { masking: Record<string, unknown> }).masking
        expect(Object.hasOwn(m, "faceMeshParts"), JSON.stringify(castSwap)).toBe(false)
        expect(Object.hasOwn(m, "depthBlur"), JSON.stringify(castSwap)).toBe((castSwap as { depthBlur?: boolean }).depthBlur === true)
      }
    } finally {
      _resetPluginSupportsForTests()
    }
  })
})

describe("tk.settings: Full depth's smallest face with mesh lines", () => {
  beforeEach(() => {
    h.masking = null
    h.motion = null
    h.failed = false
  })

  it("answers it only to an engine that declares it, and only where it applies (Full depth, the face mesh on)", async () => {
    const MIN = { mode: "always", source: "full-depth", faceMesh: true, faceMeshMinFaceHeightPct: 20 }
    h.motion = {
      "nodaro-prism": { masking: MIN },
      // The face mesh off: it draws nothing, so it is never answered.
      "nodaro-pulse": { masking: { mode: "always", source: "full-depth", faceMeshMinFaceHeightPct: 20 } },
    }
    // A Precise row never holds it (its schema refuses it); one that did is answered without it.
    h.masking = { "nodaro-prism": { mode: "always", faceMesh: true, faceMeshMinFaceHeightPct: 20 } }
    try {
      setPluginSupports({ castSwap: { ...CS, faceMesh: true, faceMeshMinFaceHeightPct: true } } as never)
      const motion = await buildToolkit().settings!.nodaroMotionMotion!()
      expect(motion!["nodaro-prism"]).toEqual({ masking: MIN })
      expect(motion!["motion-pro"]).toEqual({ masking: MIN })
      expect(motion!["nodaro-pulse"]).toEqual({ masking: { mode: "always", source: "full-depth" } })
      expect((await buildToolkit().settings!.nodaroMotionMasking!())!["nodaro-prism"]).toEqual({ mode: "always", faceMesh: true })
      // An engine from before it (0.436.1), or one without the mesh: the setting as it was before the key existed.
      for (const castSwap of [{ ...CS, faceMesh: true }, { ...CS, faceMesh: true, faceMeshMinFaceHeightPct: false }, CS]) {
        setPluginSupports({ castSwap } as never)
        const older = await buildToolkit().settings!.nodaroMotionMotion!()
        const mesh = (castSwap as { faceMesh?: boolean }).faceMesh === true ? { faceMesh: true } : {}
        expect(older!["nodaro-prism"], JSON.stringify(castSwap)).toEqual({ masking: { mode: "always", source: "full-depth", ...mesh } })
      }
    } finally {
      _resetPluginSupportsForTests()
    }
  })
})

describe("tk.settings: the fill none and a depth fill's blur", () => {
  beforeEach(() => {
    h.masking = null
    h.motion = null
    h.failed = false
  })

  const NONE = { mode: "always", fill: "none", faceMesh: true, target: "face" }
  const FILL_BLUR = { mode: "always", fill: "depth", depthBlur: 12 }

  it("answers the fill none only to an engine that draws it (and the mesh); any other gets that entry as Off, never a blur", async () => {
    h.masking = { "nodaro-prism": NONE, "nodaro-pulse": FILL_BLUR }
    h.motion = { "nodaro-prism": { masking: NONE, promptStyle: "precise" } }
    try {
      setPluginSupports({ castSwap: { ...CS, faceMesh: true, maskFillNone: true, depthFillBlur: true } } as never)
      const masking = await buildToolkit().settings!.nodaroMotionMasking!()
      expect(masking!["nodaro-prism"]).toEqual(NONE)
      expect(masking!["nodaro-pulse"]).toEqual(FILL_BLUR)
      expect((await buildToolkit().settings!.nodaroMotionMotion!())!["nodaro-prism"]).toEqual({ masking: NONE, promptStyle: "precise" })
      for (const castSwap of [{ ...CS, faceMesh: true }, { ...CS, maskFillNone: true }, CS]) {
        setPluginSupports({ castSwap } as never)
        expect((await buildToolkit().settings!.nodaroMotionMasking!())!["nodaro-prism"], JSON.stringify(castSwap)).toEqual({ mode: "off" })
        // The Motion entry keeps a masking of its own (Off), never "Same as Precise".
        expect((await buildToolkit().settings!.nodaroMotionMotion!())!["nodaro-prism"], JSON.stringify(castSwap)).toEqual({ masking: { mode: "off" }, promptStyle: "precise" })
      }
    } finally {
      _resetPluginSupportsForTests()
    }
  })

  it("answers a depth fill's blur only to an engine that declares castSwap.depthFillBlur (Full depth's castSwap.depthBlur is not it)", async () => {
    h.masking = { "nodaro-pulse": FILL_BLUR }
    h.motion = { "nodaro-pulse": { masking: FILL_BLUR }, "nodaro-prism": { masking: { mode: "always", source: "full-depth", depthBlur: 28 } } }
    try {
      setPluginSupports({ castSwap: { ...CS, depthBlur: true } } as never)
      expect((await buildToolkit().settings!.nodaroMotionMasking!())!["nodaro-pulse"]).toEqual({ mode: "always", fill: "depth" })
      const motion = await buildToolkit().settings!.nodaroMotionMotion!()
      expect(motion!["nodaro-pulse"]).toEqual({ masking: { mode: "always", fill: "depth" } })
      expect(motion!["nodaro-prism"]).toEqual({ masking: { mode: "always", source: "full-depth", depthBlur: 28 } })
      setPluginSupports({ castSwap: { ...CS, depthFillBlur: true } } as never)
      expect((await buildToolkit().settings!.nodaroMotionMasking!())!["nodaro-pulse"]).toEqual(FILL_BLUR)
      expect((await buildToolkit().settings!.nodaroMotionMotion!())!["nodaro-prism"]).toEqual({ masking: { mode: "always", source: "full-depth" } })
    } finally {
      _resetPluginSupportsForTests()
    }
  })

  it("absent = before: a setting without either is answered exactly as before, whatever the engine declares", async () => {
    const before = { mode: "auto", fill: "depth", faceMesh: true, depthColormap: "inferno" }
    h.masking = { "nodaro-pulse": before, "nodaro-prism": { mode: "always" } }
    try {
      const answers = []
      for (const castSwap of [
        { ...CS, faceMesh: true, depthColormaps: ["inferno"] },
        { ...CS, faceMesh: true, depthColormaps: ["inferno"], maskFillNone: true, depthFillBlur: true },
      ]) {
        setPluginSupports({ castSwap } as never)
        answers.push(await buildToolkit().settings!.nodaroMotionMasking!())
      }
      expect(answers[1]).toEqual(answers[0])
      expect(answers[0]!["nodaro-pulse"]).toEqual(before)
    } finally {
      _resetPluginSupportsForTests()
    }
  })
})

/**
 * `tk.settings.nodaroMotionPreciseStyleRoute()`: the admin's switch and bypass list for running a direct Prism Precise run
 * with an art style as Flex: null when never saved, nothing differs from the defaults (on, nobody bypassed), or this
 * host's engine does not declare `castSwap.preciseStyleRoute`.
 */
describe("tk.settings.nodaroMotionPreciseStyleRoute", () => {
  beforeEach(() => {
    h.preciseStyleRoute = null
    h.reads = 0
    h.failed = false
    _resetPluginSupportsForTests()
  })
  const routingEngine = () => setPluginSupports({ castSwap: { ...CS, preciseStyleRoute: true } } as never)

  it("advertises nodaroMotionPreciseStyleRoute and answers null to an engine without castSwap.preciseStyleRoute", async () => {
    expect(buildToolkit().capabilities?.nodaroMotionPreciseStyleRoute).toBe(true)
    expect(typeof buildToolkit().settings?.nodaroMotionPreciseStyleRoute).toBe("function")
    h.preciseStyleRoute = { routing: "off" }
    expect(await buildToolkit().settings!.nodaroMotionPreciseStyleRoute!()).toBeNull()
    setPluginSupports({ castSwap: { ...CS, preciseStyleRoute: false } } as never)
    expect(await buildToolkit().settings!.nodaroMotionPreciseStyleRoute!()).toBeNull()
  })

  it("rejects when the settings could not be read, never answering null (routing on, nobody bypassed)", async () => {
    routingEngine()
    h.failed = true
    await expect(buildToolkit().settings!.nodaroMotionPreciseStyleRoute!()).rejects.toThrow(/could not be read/)
  })

  it("answers null when it was never saved, or nothing differs from the defaults", async () => {
    routingEngine()
    expect(await buildToolkit().settings!.nodaroMotionPreciseStyleRoute!()).toBeNull()
    h.preciseStyleRoute = { routing: "on", bypassEmails: [] }
    expect(await buildToolkit().settings!.nodaroMotionPreciseStyleRoute!()).toBeNull()
  })

  it("answers what differs, a copy the plugin may change", async () => {
    routingEngine()
    h.preciseStyleRoute = { routing: "off", bypassEmails: ["a@example.com"] }
    const got = await buildToolkit().settings!.nodaroMotionPreciseStyleRoute!()
    expect(got).toStrictEqual({ routing: "off", bypassEmails: ["a@example.com"] })
    ;(got as { bypassEmails: string[] }).bypassEmails.push("b@example.com")
    expect(h.preciseStyleRoute).toEqual({ routing: "off", bypassEmails: ["a@example.com"] })
  })

  it("answers the photographic path and a routed run's own depth blur when set", async () => {
    routingEngine()
    h.preciseStyleRoute = { photographicStyles: "precise", routedDepthBlur: 10, describeColours: false, faceMesh: true, faceMeshParts: "contours", faceMeshWording: "shape" }
    expect(await buildToolkit().settings!.nodaroMotionPreciseStyleRoute!()).toStrictEqual({ photographicStyles: "precise", routedDepthBlur: 10, describeColours: false, faceMesh: true, faceMeshParts: "contours", faceMeshWording: "shape" })
  })

  it("answers the per-style map only to an engine that reads it; any other the photographic path when every Filmed style is Precise", async () => {
    const filmed = Object.fromEntries(filmedStyleIds().map((id) => [id, "precise"]))
    h.preciseStyleRoute = { styleRoutes: { ...filmed, anime: "precise-gray" } }
    setPluginSupports({ castSwap: { ...CS, preciseStyleRoute: true, preciseStyleRoutePerStyle: true } } as never)
    expect(await buildToolkit().settings!.nodaroMotionPreciseStyleRoute!()).toStrictEqual({ styleRoutes: { ...filmed, anime: "precise-gray" } })
    routingEngine()
    expect(await buildToolkit().settings!.nodaroMotionPreciseStyleRoute!()).toStrictEqual({ photographicStyles: "precise" })
    // A Filmed style in black and white: such an engine cannot make it, so it stays Flex there, and nothing is left.
    h.preciseStyleRoute = { styleRoutes: { ...filmed, noir: "precise-gray" } }
    expect(await buildToolkit().settings!.nodaroMotionPreciseStyleRoute!()).toBeNull()
    // Nothing left once the map and the layers (an engine that does not draw them) are taken out.
    h.preciseStyleRoute = { styleRoutes: { anime: "precise" }, faceMeshLayers: { irises: true } }
    expect(await buildToolkit().settings!.nodaroMotionPreciseStyleRoute!()).toBeNull()
  })
})

describe("capabilities.videoFaceMeshContours", () => {
  it("is advertised: the face mesh route draws the contours", () => {
    expect(buildToolkit().capabilities?.videoFaceMeshContours).toBe(true)
  })
})

/**
 * `tk.settings.nodaroMotionCustomStyle()`: whether this deployment offers Video Remake's custom style, with `enabled`
 * ALREADY RESOLVED here (the admin's saved choice, else the deployment's default), and the admin's two LLM steps. The
 * engine reads null as not offered, so an engine that declares `castSwap.customStyle` is always answered an object.
 */
describe("tk.settings.nodaroMotionCustomStyle", () => {
  beforeEach(() => {
    h.customStyle = null
    h.offeredByDefault = true
    h.reads = 0
    h.failed = false
    _resetPluginSupportsForTests()
  })
  const customEngine = () => setPluginSupports({ castSwap: { ...CS, customStyle: true } } as never)
  const read = () => buildToolkit().settings!.nodaroMotionCustomStyle!()

  it("advertises nodaroMotionCustomStyle and answers null to an engine without castSwap.customStyle", async () => {
    expect(buildToolkit().capabilities?.nodaroMotionCustomStyle).toBe(true)
    expect(typeof buildToolkit().settings?.nodaroMotionCustomStyle).toBe("function")
    h.customStyle = { enabled: true }
    expect(await read()).toBeNull()
    setPluginSupports({ castSwap: { ...CS, customStyle: false } } as never)
    expect(await read()).toBeNull()
  })

  it("rejects when the settings could not be read, never answering a switch", async () => {
    customEngine()
    h.failed = true
    await expect(read()).rejects.toThrow(/could not be read/)
  })

  it("never saved: an object with the deployment's default — on for Nodaro's own, off under a white-label profile", async () => {
    customEngine()
    expect(await read()).toStrictEqual({ enabled: true })
    h.offeredByDefault = false
    expect(await read()).toStrictEqual({ enabled: false })
    // Steps saved without a choice: the default still decides.
    h.customStyle = { describe: { model: "another-model" } }
    expect(await read()).toStrictEqual({ enabled: false, describe: { model: "another-model" } })
  })

  it("an admin's saved choice wins over the deployment's default, either way", async () => {
    customEngine()
    h.customStyle = { enabled: false }
    expect(await read()).toStrictEqual({ enabled: false })
    h.offeredByDefault = false
    h.customStyle = { enabled: true }
    expect(await read()).toStrictEqual({ enabled: true })
  })

  it("answers the admin's steps, a copy the plugin may change", async () => {
    customEngine()
    h.customStyle = { enabled: true, medium: { instructions: "Read the words.", model: "some-model" }, describe: { instructions: "Describe the look." } }
    const got = await read()
    expect(got).toStrictEqual({ enabled: true, medium: { instructions: "Read the words.", model: "some-model" }, describe: { instructions: "Describe the look." } })
    ;(got as { medium: { model: string } }).medium.model = "changed"
    expect((h.customStyle as { medium: { model: string } }).medium.model).toBe("some-model")
  })
})

/**
 * `tk.settings.nodaroMotionPlanRoles()`: whether this deployment offers Video Remake's roles planned from the prompt,
 * with `enabled` ALREADY RESOLVED here (the admin's saved choice, else the deployment's default), and the admin's
 * planning step. The engine reads null as not offered, so an engine that declares `castSwap.planRoles` is always
 * answered an object.
 */
describe("tk.settings.nodaroMotionPlanRoles", () => {
  beforeEach(() => {
    h.planRoles = null
    h.planRolesByDefault = true
    h.reads = 0
    h.failed = false
    _resetPluginSupportsForTests()
  })
  const planEngine = () => setPluginSupports({ castSwap: { ...CS, planRoles: true } } as never)
  const read = () => buildToolkit().settings!.nodaroMotionPlanRoles!()

  it("advertises nodaroMotionPlanRoles and answers null to an engine without castSwap.planRoles, whatever is saved", async () => {
    expect(buildToolkit().capabilities?.nodaroMotionPlanRoles).toBe(true)
    expect(typeof buildToolkit().settings?.nodaroMotionPlanRoles).toBe("function")
    h.planRoles = { enabled: true }
    // No engine loaded, one from before the flag, one that declares it false, one with the custom style alone.
    expect(await read()).toBeNull()
    for (const castSwap of [CS, { ...CS, planRoles: false }, { ...CS, customStyle: true }]) {
      setPluginSupports({ castSwap } as never)
      expect(await read(), JSON.stringify(castSwap)).toBeNull()
    }
  })

  it("rejects when the settings could not be read, never answering a switch", async () => {
    planEngine()
    h.failed = true
    await expect(read()).rejects.toThrow(/could not be read/)
    // The same for an engine that does not declare it: a failed read is never read as "not this engine's".
    _resetPluginSupportsForTests()
    await expect(read()).rejects.toThrow(/could not be read/)
  })

  it("never saved: an object with the deployment's default — on for Nodaro's own, off under a white-label profile", async () => {
    planEngine()
    expect(await read()).toStrictEqual({ enabled: true })
    h.planRolesByDefault = false
    expect(await read()).toStrictEqual({ enabled: false })
    // A step saved without a choice: the default still decides.
    h.planRoles = { plan: { model: "another-model" } }
    expect(await read()).toStrictEqual({ enabled: false, plan: { model: "another-model" } })
  })

  it("passes the step's review mode through only to an engine that declares castSwap.planRolesReview", async () => {
    h.planRoles = { enabled: true, plan: { model: "another-model", review: "full" } }
    planEngine()
    expect(await read()).toStrictEqual({ enabled: true, plan: { model: "another-model" } })
    setPluginSupports({ castSwap: { ...CS, planRoles: true, planRolesReview: true } } as never)
    expect(await read()).toStrictEqual({ enabled: true, plan: { model: "another-model", review: "full" } })
  })

  it("an admin's saved choice wins over the deployment's default, either way", async () => {
    planEngine()
    h.planRoles = { enabled: false }
    expect(await read()).toStrictEqual({ enabled: false })
    h.planRolesByDefault = false
    h.planRoles = { enabled: true }
    expect(await read()).toStrictEqual({ enabled: true })
  })

  it("does not follow the custom style's switch or default", async () => {
    planEngine()
    h.customStyle = { enabled: false }
    h.offeredByDefault = false
    expect(await read()).toStrictEqual({ enabled: true })
    h.customStyle = null
    h.offeredByDefault = true
  })

  it("answers the admin's step, a copy the plugin may change", async () => {
    planEngine()
    h.planRoles = { enabled: true, plan: { instructions: "Place each image.", model: "some-model" } }
    const got = await read()
    expect(got).toStrictEqual({ enabled: true, plan: { instructions: "Place each image.", model: "some-model" } })
    ;(got as { plan: { model: string } }).plan.model = "changed"
    expect((h.planRoles as { plan: { model: string } }).plan.model).toBe("some-model")
  })
})

/**
 * `tk.settings.nodaroMotionPreviz()`: whether this deployment accepts a Video Remake run whose clip is a 3D previz,
 * with `enabled` ALREADY RESOLVED here (the admin's saved choice, else the deployment's default). The engine reads
 * null as not accepted, so an engine that declares `castSwap.previz` is always answered an object.
 */
describe("tk.settings.nodaroMotionPreviz", () => {
  beforeEach(() => {
    h.previz = null
    h.previzByDefault = true
    h.reads = 0
    h.failed = false
    _resetPluginSupportsForTests()
  })
  const previzEngine = () => setPluginSupports({ castSwap: { ...CS, previz: true } } as never)
  const read = () => buildToolkit().settings!.nodaroMotionPreviz!()

  it("advertises nodaroMotionPreviz and answers null to an engine without castSwap.previz, whatever is saved", async () => {
    expect(buildToolkit().capabilities?.nodaroMotionPreviz).toBe(true)
    expect(typeof buildToolkit().settings?.nodaroMotionPreviz).toBe("function")
    h.previz = { enabled: true }
    // No engine loaded, one from before the flag, one that declares it false, one with the roles from the prompt alone.
    expect(await read()).toBeNull()
    for (const castSwap of [CS, { ...CS, previz: false }, { ...CS, planRoles: true, customStyle: true }]) {
      setPluginSupports({ castSwap } as never)
      expect(await read(), JSON.stringify(castSwap)).toBeNull()
    }
  })

  it("rejects when the settings could not be read, never answering a switch", async () => {
    previzEngine()
    h.failed = true
    await expect(read()).rejects.toThrow(/could not be read/)
    // The same for an engine that does not declare it: a failed read is never read as "not this engine's".
    _resetPluginSupportsForTests()
    await expect(read()).rejects.toThrow(/could not be read/)
  })

  it("never saved: an object with the deployment's default — on for Nodaro's own, off under a white-label profile", async () => {
    previzEngine()
    expect(await read()).toStrictEqual({ enabled: true })
    h.previz = {}
    expect(await read()).toStrictEqual({ enabled: true })
    h.previzByDefault = false
    expect(await read()).toStrictEqual({ enabled: false })
  })

  it("an admin's saved choice wins over the deployment's default, either way", async () => {
    previzEngine()
    h.previz = { enabled: false }
    expect(await read()).toStrictEqual({ enabled: false })
    h.previzByDefault = false
    h.previz = { enabled: true }
    expect(await read()).toStrictEqual({ enabled: true })
  })

  it("does not follow the roles' or the custom style's switch, and answers a copy", async () => {
    previzEngine()
    h.planRoles = { enabled: false }
    h.customStyle = { enabled: false }
    h.previz = { enabled: true }
    const got = await read()
    expect(got).toStrictEqual({ enabled: true })
    ;(got as { enabled: boolean }).enabled = false
    expect(h.previz).toEqual({ enabled: true })
    h.planRoles = null
    h.customStyle = null
  })

  it("what the host answers is the plugin's PluginNodaroMotionPreviz", () => {
    expectTypeOf<NodaroMotionPrevizForPlugin>().toExtend<PluginNodaroMotionPreviz>()
  })
})

/**
 * `tk.settings.nodaroMotionShotLock()`: the admin's shot lock per Video Remake engine, read by the Cast Swap engine
 * for a DIRECT run on an ordinary clip: null when never saved, every engine is off, or this host's engine does not
 * declare `castSwap.shotLock`; else only the engines that are on.
 */
describe("tk.settings.nodaroMotionShotLock", () => {
  beforeEach(() => {
    h.shotLock = null
    h.reads = 0
    h.failed = false
    _resetPluginSupportsForTests()
  })
  const shotLockEngine = () => setPluginSupports({ castSwap: { ...CS, shotLock: true } } as never)
  const read = () => buildToolkit().settings!.nodaroMotionShotLock!()

  it("advertises nodaroMotionShotLock and answers null to an engine without castSwap.shotLock, whatever is saved", async () => {
    expect(buildToolkit().capabilities?.nodaroMotionShotLock).toBe(true)
    expect(typeof buildToolkit().settings?.nodaroMotionShotLock).toBe("function")
    h.shotLock = { "nodaro-prism": "on", "nodaro-pulse": "on" }
    expect(await read()).toBeNull()
    for (const castSwap of [CS, { ...CS, shotLock: false }, { ...CS, previz: true }]) {
      setPluginSupports({ castSwap } as never)
      expect(await read(), JSON.stringify(castSwap)).toBeNull()
    }
  })

  it("rejects when the settings could not be read, never answering null (off)", async () => {
    shotLockEngine()
    h.failed = true
    await expect(read()).rejects.toThrow(/could not be read/)
    _resetPluginSupportsForTests()
    await expect(read()).rejects.toThrow(/could not be read/)
  })

  it("answers null when it was never saved, or every engine is off: there is no deployment default", async () => {
    shotLockEngine()
    expect(await read()).toBeNull()
    h.shotLock = {}
    expect(await read()).toBeNull()
    h.shotLock = { "nodaro-prism": "off" }
    expect(await read()).toBeNull()
    expect(h.reads).toBe(3)
  })

  it("answers each engine that is on under the current and the earlier keys, a copy the plugin may change", async () => {
    shotLockEngine()
    h.shotLock = { "nodaro-pulse": "on" }
    const got = await read()
    expect(got).toEqual({ "nodaro-pulse": "on", "motion-pulse": "on", "motion-lite": "on" })
    ;(got as Record<string, string>)["nodaro-pulse"] = "off"
    expect(h.shotLock).toEqual({ "nodaro-pulse": "on" })
  })

  it("answers an entry by run type only to an engine that declares castSwap.shotLockRunTypes; any other is answered only \"on\" entries", async () => {
    const byType = { ordinary: "on", styleAlone: "on", styles: { cinematic: "off" } }
    h.shotLock = { "nodaro-prism": byType, "nodaro-pulse": "on" }
    setPluginSupports({ castSwap: { ...CS, shotLock: true, shotLockRunTypes: true } } as never)
    expect(await read()).toEqual({
      "nodaro-prism": byType,
      "motion-prism": byType,
      "motion-pro": byType,
      "nodaro-pulse": "on",
      "motion-pulse": "on",
      "motion-lite": "on",
    })
    // An engine from before run types reads only "on": the entry by run type is left out (off there, never on by accident).
    shotLockEngine()
    expect(await read()).toEqual({ "nodaro-pulse": "on", "motion-pulse": "on", "motion-lite": "on" })
    h.shotLock = { "nodaro-prism": byType }
    expect(await read()).toBeNull()
    // A value from before run types is answered to both, as before.
    h.shotLock = { "nodaro-prism": "on" }
    expect(await read()).toEqual({ "nodaro-prism": "on", "motion-prism": "on", "motion-pro": "on" })
    setPluginSupports({ castSwap: { ...CS, shotLock: true, shotLockRunTypes: true } } as never)
    expect(await read()).toEqual({ "nodaro-prism": "on", "motion-prism": "on", "motion-pro": "on" })
  })

  it("what the host answers is the plugin's PluginNodaroMotionShotLock", () => {
    expectTypeOf<NodaroMotionShotLockForPlugin>().toExtend<PluginNodaroMotionShotLock>()
  })
})

/**
 * `tk.settings.nodaroMotionShotListFps()`: the admin's frame rate for the clip a Video Remake shot list is written
 * from, read by the Cast Swap engine: null to an engine that does not declare `castSwap.shotListFps`; else always an
 * object — the admin's rate, none while the engine's own default decides, and 1 on a deployment that cannot serve a
 * call carrying a rate.
 */
describe("tk.settings.nodaroMotionShotListFps", () => {
  beforeEach(() => {
    h.shotListFps = null
    h.geminiKey = true
    h.reads = 0
    h.failed = false
    _resetPluginSupportsForTests()
  })
  const rateEngine = () => setPluginSupports({ castSwap: { ...CS, shotListFps: true } } as never)
  const read = () => buildToolkit().settings!.nodaroMotionShotListFps!()

  it("advertises nodaroMotionShotListFps and answers null to an engine without castSwap.shotListFps, whatever is saved", async () => {
    expect(buildToolkit().capabilities?.nodaroMotionShotListFps).toBe(true)
    expect(typeof buildToolkit().settings?.nodaroMotionShotListFps).toBe("function")
    h.shotListFps = { fps: 4 }
    expect(await read()).toBeNull()
    for (const castSwap of [CS, { ...CS, shotListFps: false }, { ...CS, shotLock: true }]) {
      setPluginSupports({ castSwap } as never)
      expect(await read(), JSON.stringify(castSwap)).toBeNull()
    }
  })

  it("rejects when the settings could not be read (the engine then asks for its own default)", async () => {
    rateEngine()
    h.failed = true
    await expect(read()).rejects.toThrow(/could not be read/)
    _resetPluginSupportsForTests()
    await expect(read()).rejects.toThrow(/could not be read/)
  })

  it("answers the admin's rate, and an object with no rate while none is saved: the engine's default, never 1", async () => {
    rateEngine()
    expect(await read()).toEqual({})
    h.shotListFps = {}
    expect(await read()).toEqual({})
    h.shotListFps = { fps: 4 }
    const got = await read()
    expect(got).toEqual({ fps: 4 })
    ;(got as { fps?: number }).fps = 12
    expect(h.shotListFps).toEqual({ fps: 4 })
    h.shotListFps = { fps: 1 }
    expect(await read()).toEqual({ fps: 1 })
    expect(h.reads).toBe(4)
  })

  it("answers 1 (the clip as before) where this deployment cannot serve a call carrying a rate, whatever is saved", async () => {
    rateEngine()
    h.geminiKey = false
    expect(await read()).toEqual({ fps: 1 })
    h.shotListFps = { fps: 12 }
    expect(await read()).toEqual({ fps: 1 })
  })

  it("what the host answers is the plugin's PluginNodaroMotionShotListFps", () => {
    expectTypeOf<NodaroMotionShotListFpsForPlugin>().toExtend<PluginNodaroMotionShotListFps>()
  })
})

/**
 * `tk.settings.nodaroMotionFlashModel(userId)`: the admin's flash-model test per Video Remake engine, answered for ONE
 * run and only when the account that started it is an admin (the host reads the role itself): null when never saved,
 * every engine is off, this host's engine does not declare `castSwap.flashModel`, no account is named, or the account
 * is no admin; else only the engines that are on.
 */
describe("tk.settings.nodaroMotionFlashModel", () => {
  const ADMIN = "00000000-0000-4000-8000-0000000000ad"
  const MEMBER = "00000000-0000-4000-8000-0000000000aa"
  beforeEach(() => {
    h.flashModel = null
    h.admins = [ADMIN]
    h.adminCheckFails = false
    h.adminChecks = 0
    h.reads = 0
    h.failed = false
    _resetPluginSupportsForTests()
  })
  const flashModelEngine = () => setPluginSupports({ castSwap: { ...CS, flashModel: true } } as never)
  const read = (userId: string | undefined = ADMIN) => buildToolkit().settings!.nodaroMotionFlashModel!(userId)

  it("advertises nodaroMotionFlashModel and answers null to an engine without castSwap.flashModel, whatever is saved", async () => {
    expect(buildToolkit().capabilities?.nodaroMotionFlashModel).toBe(true)
    expect(typeof buildToolkit().settings?.nodaroMotionFlashModel).toBe("function")
    h.flashModel = { "nodaro-prism": "on", "nodaro-pulse": "on" }
    expect(await read()).toBeNull()
    for (const castSwap of [CS, { ...CS, flashModel: false }, { ...CS, shotLock: true }]) {
      setPluginSupports({ castSwap } as never)
      expect(await read(), JSON.stringify(castSwap)).toBeNull()
    }
    expect(h.adminChecks).toBe(0)
  })

  it("rejects when the settings could not be read, never answering null (off)", async () => {
    flashModelEngine()
    h.failed = true
    await expect(read()).rejects.toThrow(/could not be read/)
    _resetPluginSupportsForTests()
    await expect(read()).rejects.toThrow(/could not be read/)
  })

  it("answers null when it was never saved, or every engine is off, without reading anyone's role", async () => {
    flashModelEngine()
    expect(await read()).toBeNull()
    h.flashModel = {}
    expect(await read()).toBeNull()
    h.flashModel = { "nodaro-prism": "off" }
    expect(await read()).toBeNull()
    expect(h.reads).toBe(3)
    expect(h.adminChecks).toBe(0)
  })

  it("an admin account's run: each engine that is on under the current and the earlier keys, a copy the plugin may change", async () => {
    flashModelEngine()
    h.flashModel = { "nodaro-pulse": "on" }
    const got = await read(ADMIN)
    expect(got).toEqual({ "nodaro-pulse": "on", "motion-pulse": "on", "motion-lite": "on" })
    ;(got as Record<string, string>)["nodaro-pulse"] = "off"
    expect(h.flashModel).toEqual({ "nodaro-pulse": "on" })
    expect(h.adminChecks).toBe(1)
  })

  it("any other account's run, and a call that names no account: null, as if the switch were off", async () => {
    flashModelEngine()
    h.flashModel = { "nodaro-prism": "on", "nodaro-pulse": "on" }
    expect(await read(MEMBER)).toBeNull()
    expect(h.adminChecks).toBe(1)
    // An engine build that asks without an account (or with nothing usable) is never answered "on".
    expect(await buildToolkit().settings!.nodaroMotionFlashModel!()).toBeNull()
    expect(await read("")).toBeNull()
    expect(await (buildToolkit().settings!.nodaroMotionFlashModel as (u: unknown) => Promise<unknown>)({ id: ADMIN })).toBeNull()
    expect(h.adminChecks).toBe(1)
  })

  it("an account whose role cannot be read: rejects, never answered as an admin", async () => {
    flashModelEngine()
    h.flashModel = { "nodaro-prism": "on" }
    h.adminCheckFails = true
    await expect(read(ADMIN)).rejects.toThrow(/Admin check failed/)
  })

  it("what the host answers is the plugin's PluginNodaroMotionFlashModel", () => {
    expectTypeOf<NodaroMotionFlashModelForPlugin>().toExtend<PluginNodaroMotionFlashModel>()
  })
})

/**
 * `tk.settings.nodaroMotionPreciseUpscale()`: per output resolution, the Topaz target of a direct Prism Precise run's
 * take. Always the effective value (never saved: every default), null only to an engine without `castSwap.preciseUpscale`.
 */
describe("tk.settings.nodaroMotionPreciseUpscale", () => {
  beforeEach(() => {
    h.preciseUpscale = null
    h.topazDisabled = false
    h.failed = false
    _resetPluginSupportsForTests()
  })
  const upscalingEngine = () => setPluginSupports({ castSwap: { ...CS, preciseUpscale: true } } as never)

  it("advertises nodaroMotionPreciseUpscale and answers null to an engine without castSwap.preciseUpscale", async () => {
    expect(buildToolkit().capabilities?.nodaroMotionPreciseUpscale).toBe(true)
    expect(typeof buildToolkit().settings?.nodaroMotionPreciseUpscale).toBe("function")
    h.preciseUpscale = { "720p": "4k" }
    expect(await buildToolkit().settings!.nodaroMotionPreciseUpscale!()).toBeNull()
    setPluginSupports({ castSwap: { ...CS, preciseUpscale: false } } as never)
    expect(await buildToolkit().settings!.nodaroMotionPreciseUpscale!()).toBeNull()
  })

  it("rejects when the settings could not be read, never answering the defaults", async () => {
    upscalingEngine()
    h.failed = true
    await expect(buildToolkit().settings!.nodaroMotionPreciseUpscale!()).rejects.toThrow(/could not be read/)
  })

  it("answers the defaults when it was never saved", async () => {
    upscalingEngine()
    expect(await buildToolkit().settings!.nodaroMotionPreciseUpscale!()).toStrictEqual({ "480p": "1080p", "720p": "1080p", "1080p": "4k" })
  })

  it("answers the stored choices, each resolution left out at its default, a fresh object", async () => {
    upscalingEngine()
    h.preciseUpscale = { "480p": "off", "1080p": "1080p" }
    const got = await buildToolkit().settings!.nodaroMotionPreciseUpscale!()
    expect(got).toStrictEqual({ "480p": "off", "720p": "1080p", "1080p": "1080p" })
    ;(got as Record<string, string>)["480p"] = "4k"
    expect(h.preciseUpscale).toEqual({ "480p": "off", "1080p": "1080p" })
  })

  it("answers every resolution off while this deployment does not run Topaz, whatever is saved", async () => {
    upscalingEngine()
    h.topazDisabled = true
    expect(await buildToolkit().settings!.nodaroMotionPreciseUpscale!()).toStrictEqual({ "480p": "off", "720p": "off", "1080p": "off" })
    h.preciseUpscale = { "720p": "4k" }
    expect(await buildToolkit().settings!.nodaroMotionPreciseUpscale!()).toStrictEqual({ "480p": "off", "720p": "off", "1080p": "off" })
    // Still null to an engine without the flag.
    setPluginSupports({ castSwap: { ...CS } } as never)
    expect(await buildToolkit().settings!.nodaroMotionPreciseUpscale!()).toBeNull()
  })
})
