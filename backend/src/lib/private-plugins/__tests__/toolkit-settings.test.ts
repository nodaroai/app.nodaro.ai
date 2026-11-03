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
  PluginPromptPartId,
} from "../types.js"
import type { NodaroMotionMotionForPlugin } from "../../nodaro-motion-motion.js"
import type { NodaroMotionMaskingForPlugin } from "../../nodaro-motion-masking.js"
import type { NodaroMotionPromptPartsForPlugin } from "../../nodaro-motion-prompt-parts.js"
import type { NodaroMotionStyleForPlugin } from "../../nodaro-motion-style.js"
import type { NodaroMotionPromptWordingForPlugin } from "../../nodaro-motion-prompt-wording.js"

/**
 * `tk.settings.nodaroMotionMasking()` — the admin's face masking per Nodaro
 * Motion engine, which the Cast Swap engine applies to every DIRECT run. It is
 * the settings cache's own read (`getAppSettings`, ~60 s, cleared on an admin
 * write), handed out as a copy, and null when never saved.
 */
const h = vi.hoisted(() => ({ masking: null as unknown, promptParts: null as unknown, motion: null as unknown, steps: null as unknown, style: null as unknown, wording: null as unknown, reads: 0, failed: false }))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../app-settings.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return {
    ...orig,
    getAppSettings: async () => {
      h.reads++
      return { nodaro_motion_masking: h.masking, nodaro_motion_prompt_parts: h.promptParts, nodaro_motion_motion: h.motion, nodaro_motion_steps: h.steps, nodaro_motion_style: h.style, nodaro_motion_prompt_wording: h.wording }
    },
    settingsReadFailed: () => h.failed,
  }
})

const { buildToolkit } = await import("../toolkit.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../private-plugins/supports-registry.js")

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

  it("answers the face mesh only to an engine that draws it, and only as true (an older engine's strict schema would refuse the entry)", async () => {
    h.masking = { "motion-prism": { mode: "always", faceMesh: true }, "motion-pulse": { mode: "auto", faceMesh: false } }
    try {
      meshEngine(true)
      expect(await buildToolkit().settings!.nodaroMotionMasking!()).toEqual({
        "motion-prism": { mode: "always", faceMesh: true },
        "motion-pro": { mode: "always", faceMesh: true },
        "motion-pulse": { mode: "auto" },
        "motion-lite": { mode: "auto" },
      })
      for (const faceMesh of [undefined, false]) {
        meshEngine(faceMesh)
        const got = await buildToolkit().settings!.nodaroMotionMasking!()
        expect(got, String(faceMesh)).toEqual({ "motion-prism": { mode: "always" }, "motion-pro": { mode: "always" }, "motion-pulse": { mode: "auto" }, "motion-lite": { mode: "auto" } })
        expect(Object.values(got!).some((m) => m && Object.hasOwn(m, "faceMesh"))).toBe(false)
      }
    } finally {
      _resetPluginSupportsForTests()
    }
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

  it("answers each masking's face mesh only to an engine that draws it, the rest of the entry as saved", async () => {
    h.motion = {
      "motion-prism": { masking: { mode: "always", source: "full-depth", faceMesh: true }, promptStyle: "precise" },
      "motion-pulse": { promptStyle: "flexible" },
    }
    try {
      meshEngine(true)
      const drawn = await buildToolkit().settings!.nodaroMotionMotion!()
      expect(drawn!["motion-prism"]).toEqual({ masking: { mode: "always", source: "full-depth", faceMesh: true }, promptStyle: "precise" })
      expect(drawn!["motion-pro"]).toEqual(drawn!["motion-prism"])
      meshEngine(undefined)
      const older = await buildToolkit().settings!.nodaroMotionMotion!()
      expect(older!["motion-prism"]).toEqual({ masking: { mode: "always", source: "full-depth" }, promptStyle: "precise" })
      expect(older!["motion-pro"]).toEqual({ masking: { mode: "always", source: "full-depth" }, promptStyle: "precise" })
      expect(older!["motion-pulse"]).toEqual({ promptStyle: "flexible" })
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
      "motion-prism": { mode: "always", fill: "depth", depthColormap: "inferno" },
      // The default of a depth fill: never answered, whatever the engine lists.
      "motion-pulse": { mode: "always", fill: "depth", depthColormap: "turbo" },
    }
    h.motion = { "motion-prism": { masking: { mode: "always", source: "full-depth", depthColormap: "magma" } } }
    try {
      setPluginSupports({ castSwap: { ...CS, depthColormaps: ["turbo", "inferno", "magma"] } } as never)
      const masking = await buildToolkit().settings!.nodaroMotionMasking!()
      expect(masking!["motion-prism"]).toEqual({ mode: "always", fill: "depth", depthColormap: "inferno" })
      expect(masking!["motion-pro"]).toEqual(masking!["motion-prism"])
      expect(masking!["motion-pulse"]).toEqual({ mode: "always", fill: "depth" })
      const motion = await buildToolkit().settings!.nodaroMotionMotion!()
      expect(motion!["motion-prism"]).toEqual({ masking: { mode: "always", source: "full-depth", depthColormap: "magma" } })
      for (const castSwap of [CS, { ...CS, depthColormaps: ["grayscale"] }]) {
        setPluginSupports({ castSwap } as never)
        const older = await buildToolkit().settings!.nodaroMotionMasking!()
        expect(older!["motion-prism"], JSON.stringify(castSwap)).toEqual({ mode: "always", fill: "depth" })
        expect(Object.values(older!).some((m) => m && Object.hasOwn(m, "depthColormap"))).toBe(false)
        const olderMotion = await buildToolkit().settings!.nodaroMotionMotion!()
        expect(olderMotion!["motion-prism"]).toEqual({ masking: { mode: "always", source: "full-depth" } })
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
      "motion-prism": { mode: "always", fill: "depth", depthModelSize: "small" },
      // Large (the default): never answered, whatever the engine lists.
      "motion-pulse": { mode: "always", fill: "depth", depthModelSize: "large" },
    }
    h.motion = {
      "motion-prism": { masking: { mode: "always", source: "full-depth", depthModelSize: "base" } },
      // A blur fill draws no depth: never answered.
      "motion-pulse": { masking: { mode: "always", depthModelSize: "small" } },
    }
    try {
      setPluginSupports({ castSwap: { ...CS, depthModelSizes: ["small", "base", "large"] } } as never)
      const masking = await buildToolkit().settings!.nodaroMotionMasking!()
      expect(masking!["motion-prism"]).toEqual({ mode: "always", fill: "depth", depthModelSize: "small" })
      expect(masking!["motion-pulse"]).toEqual({ mode: "always", fill: "depth" })
      expect(masking!["motion-pro"]).toEqual(masking!["motion-prism"])
      const motion = await buildToolkit().settings!.nodaroMotionMotion!()
      expect(motion!["motion-prism"]).toEqual({ masking: { mode: "always", source: "full-depth", depthModelSize: "base" } })
      expect(motion!["motion-pulse"]).toEqual({ masking: { mode: "always" } })
      for (const castSwap of [CS, { ...CS, depthModelSizes: ["large"] }]) {
        setPluginSupports({ castSwap } as never)
        const older = await buildToolkit().settings!.nodaroMotionMasking!()
        expect(older!["motion-prism"], JSON.stringify(castSwap)).toEqual({ mode: "always", fill: "depth" })
        expect(Object.values(older!).some((m) => m && Object.hasOwn(m, "depthModelSize"))).toBe(false)
        const olderMotion = await buildToolkit().settings!.nodaroMotionMotion!()
        expect(olderMotion!["motion-prism"]).toEqual({ masking: { mode: "always", source: "full-depth" } })
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
 * `tk.settings.nodaroMotionSteps()` — the admin's preparation steps per Nodaro
 * Motion engine, for every DIRECT run: only to an engine that takes steps
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
  const saved = { "motion-prism": { enginePrompt: { mode: "template" } }, "motion-pulse": { sceneDescription: { mode: "template" } } }

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
    h.steps = { "motion-prism": {} }
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toBeNull()
  })

  it("reads the saved row under the current and the earlier keys, each a copy the plugin may change", async () => {
    stepsEngine(true)
    h.steps = saved
    const got = await buildToolkit().settings!.nodaroMotionSteps!()
    expect(got).toEqual({ ...saved, "motion-pro": saved["motion-prism"], "motion-lite": saved["motion-pulse"] })
    ;(got!["motion-prism"] as { enginePrompt?: unknown }).enginePrompt = undefined
    expect(saved["motion-prism"]).toEqual({ enginePrompt: { mode: "template" } })
  })

  it("answers clipBody only to an engine that declares castSwap.clipBodySheet, dropping an entry left empty", async () => {
    h.steps = {
      "motion-prism": { enginePrompt: { mode: "template" }, clipBody: { mode: "off" } },
      "motion-pulse": { clipBody: { mode: "on", prompt: "A test prompt." } },
    }
    setPluginSupports({ castSwap: { ...CS, steps: true, clipBodySheet: true } } as never)
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toEqual({
      "motion-prism": { enginePrompt: { mode: "template" }, clipBody: { mode: "off" } },
      "motion-pro": { enginePrompt: { mode: "template" }, clipBody: { mode: "off" } },
      "motion-pulse": { clipBody: { mode: "on", prompt: "A test prompt." } },
      "motion-lite": { clipBody: { mode: "on", prompt: "A test prompt." } },
    })
    stepsEngine(true)
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toEqual({
      "motion-prism": { enginePrompt: { mode: "template" } },
      "motion-pro": { enginePrompt: { mode: "template" } },
    })
    h.steps = { "motion-pulse": { clipBody: { mode: "off" } } }
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toBeNull()
  })

  it("answers shotList only to an engine that declares castSwap.shotList", async () => {
    h.steps = { "motion-prism": { enginePrompt: { mode: "template" }, shotList: { precise: { mode: "on" } } } }
    setPluginSupports({ castSwap: { ...CS, steps: true, shotList: true } } as never)
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toEqual({
      "motion-prism": { enginePrompt: { mode: "template" }, shotList: { precise: { mode: "on" } } },
      "motion-pro": { enginePrompt: { mode: "template" }, shotList: { precise: { mode: "on" } } },
    })
    stepsEngine(true)
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toEqual({
      "motion-prism": { enginePrompt: { mode: "template" } },
      "motion-pro": { enginePrompt: { mode: "template" } },
    })
  })

  it("answers styleRefs only to an engine that declares castSwap.styleRefs", async () => {
    h.steps = { "motion-prism": { enginePrompt: { mode: "template" }, styleRefs: { mode: "on", send: "styled" } } }
    setPluginSupports({ castSwap: { ...CS, steps: true, styleRefs: true } } as never)
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toEqual({
      "motion-prism": { enginePrompt: { mode: "template" }, styleRefs: { mode: "on", send: "styled" } },
      "motion-pro": { enginePrompt: { mode: "template" }, styleRefs: { mode: "on", send: "styled" } },
    })
    stepsEngine(true)
    expect(await buildToolkit().settings!.nodaroMotionSteps!()).toEqual({
      "motion-prism": { enginePrompt: { mode: "template" } },
      "motion-pro": { enginePrompt: { mode: "template" } },
    })
    h.steps = { "motion-pulse": { styleRefs: { mode: "off" } } }
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
 * `tk.settings.nodaroMotionStyle()` — the admin's Style choice per Nodaro
 * Motion engine, which the Cast Swap engine enforces on every DIRECT run and
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
    h.style = { "motion-pulse": "flex" }
    const got = await buildToolkit().settings!.nodaroMotionStyle!()
    expect(got).toEqual({ "motion-pulse": "flex", "motion-lite": "flex" })
    ;(got as Record<string, string>)["motion-pulse"] = "precise"
    expect(h.style).toEqual({ "motion-pulse": "flex" })
  })

  it("what the host answers is the plugin's PluginNodaroMotionStyle", () => {
    expectTypeOf<NodaroMotionStyleForPlugin>().toExtend<PluginNodaroMotionStyle>()
  })
})

/**
 * `tk.settings.nodaroMotionPromptWording()` — the admin's Flex prompt wording
 * per Nodaro Motion engine, which the Cast Swap engine reads for every DIRECT
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
    h.wording = { "motion-prism": "current" }
    expect(await buildToolkit().settings!.nodaroMotionPromptWording!()).toBeNull()
    expect(h.reads).toBe(3)
  })

  it("answers each engine on the new wording under the current and the earlier key, a copy the plugin may change", async () => {
    h.wording = { "motion-pulse": "new" }
    const got = await buildToolkit().settings!.nodaroMotionPromptWording!()
    expect(got).toEqual({ "motion-pulse": "new", "motion-lite": "new" })
    ;(got as Record<string, string>)["motion-pulse"] = "current"
    expect(h.wording).toEqual({ "motion-pulse": "new" })
  })

  it("what the host answers is the plugin's PluginNodaroMotionPromptWording", () => {
    expectTypeOf<NodaroMotionPromptWordingForPlugin>().toExtend<PluginNodaroMotionPromptWording>()
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
      "motion-prism": { masking: { mode: "always", source: "full-depth", faceMesh: true, depthBlur: 28, faceMeshParts: "features" } },
      // 0 and the full mesh: never answered, whatever the engine declares.
      "motion-pulse": { masking: { mode: "always", source: "full-depth", faceMesh: true, depthBlur: 0, faceMeshParts: "full" } },
    }
    try {
      setPluginSupports({ castSwap: { ...CS, faceMesh: true, depthBlur: true, faceMeshParts: ["full", "features", "mouth"] } } as never)
      const motion = await buildToolkit().settings!.nodaroMotionMotion!()
      expect(motion!["motion-prism"]).toEqual({ masking: { mode: "always", source: "full-depth", faceMesh: true, depthBlur: 28, faceMeshParts: "features" } })
      expect(motion!["motion-pro"]).toEqual(motion!["motion-prism"])
      expect(motion!["motion-pulse"]).toEqual({ masking: { mode: "always", source: "full-depth", faceMesh: true } })
      // An engine from before them (or one without the mesh): the setting as it was before the keys existed.
      for (const castSwap of [{ ...CS, faceMesh: true }, { ...CS, faceMesh: true, depthBlur: true, faceMeshParts: ["full", "mouth"] }, CS]) {
        setPluginSupports({ castSwap } as never)
        const older = await buildToolkit().settings!.nodaroMotionMotion!()
        const m = (older!["motion-prism"] as unknown as { masking: Record<string, unknown> }).masking
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
      "motion-prism": { masking: MIN },
      // The face mesh off: it draws nothing, so it is never answered.
      "motion-pulse": { masking: { mode: "always", source: "full-depth", faceMeshMinFaceHeightPct: 20 } },
    }
    // A Precise row never holds it (its schema refuses it); one that did is answered without it.
    h.masking = { "motion-prism": { mode: "always", faceMesh: true, faceMeshMinFaceHeightPct: 20 } }
    try {
      setPluginSupports({ castSwap: { ...CS, faceMesh: true, faceMeshMinFaceHeightPct: true } } as never)
      const motion = await buildToolkit().settings!.nodaroMotionMotion!()
      expect(motion!["motion-prism"]).toEqual({ masking: MIN })
      expect(motion!["motion-pro"]).toEqual({ masking: MIN })
      expect(motion!["motion-pulse"]).toEqual({ masking: { mode: "always", source: "full-depth" } })
      expect((await buildToolkit().settings!.nodaroMotionMasking!())!["motion-prism"]).toEqual({ mode: "always", faceMesh: true })
      // An engine from before it (0.436.1), or one without the mesh: the setting as it was before the key existed.
      for (const castSwap of [{ ...CS, faceMesh: true }, { ...CS, faceMesh: true, faceMeshMinFaceHeightPct: false }, CS]) {
        setPluginSupports({ castSwap } as never)
        const older = await buildToolkit().settings!.nodaroMotionMotion!()
        const mesh = (castSwap as { faceMesh?: boolean }).faceMesh === true ? { faceMesh: true } : {}
        expect(older!["motion-prism"], JSON.stringify(castSwap)).toEqual({ masking: { mode: "always", source: "full-depth", ...mesh } })
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
    h.masking = { "motion-prism": NONE, "motion-pulse": FILL_BLUR }
    h.motion = { "motion-prism": { masking: NONE, promptStyle: "precise" } }
    try {
      setPluginSupports({ castSwap: { ...CS, faceMesh: true, maskFillNone: true, depthFillBlur: true } } as never)
      const masking = await buildToolkit().settings!.nodaroMotionMasking!()
      expect(masking!["motion-prism"]).toEqual(NONE)
      expect(masking!["motion-pulse"]).toEqual(FILL_BLUR)
      expect((await buildToolkit().settings!.nodaroMotionMotion!())!["motion-prism"]).toEqual({ masking: NONE, promptStyle: "precise" })
      for (const castSwap of [{ ...CS, faceMesh: true }, { ...CS, maskFillNone: true }, CS]) {
        setPluginSupports({ castSwap } as never)
        expect((await buildToolkit().settings!.nodaroMotionMasking!())!["motion-prism"], JSON.stringify(castSwap)).toEqual({ mode: "off" })
        // The Motion entry keeps a masking of its own (Off), never "Same as Precise".
        expect((await buildToolkit().settings!.nodaroMotionMotion!())!["motion-prism"], JSON.stringify(castSwap)).toEqual({ masking: { mode: "off" }, promptStyle: "precise" })
      }
    } finally {
      _resetPluginSupportsForTests()
    }
  })

  it("answers a depth fill's blur only to an engine that declares castSwap.depthFillBlur (Full depth's castSwap.depthBlur is not it)", async () => {
    h.masking = { "motion-pulse": FILL_BLUR }
    h.motion = { "motion-pulse": { masking: FILL_BLUR }, "motion-prism": { masking: { mode: "always", source: "full-depth", depthBlur: 28 } } }
    try {
      setPluginSupports({ castSwap: { ...CS, depthBlur: true } } as never)
      expect((await buildToolkit().settings!.nodaroMotionMasking!())!["motion-pulse"]).toEqual({ mode: "always", fill: "depth" })
      const motion = await buildToolkit().settings!.nodaroMotionMotion!()
      expect(motion!["motion-pulse"]).toEqual({ masking: { mode: "always", fill: "depth" } })
      expect(motion!["motion-prism"]).toEqual({ masking: { mode: "always", source: "full-depth", depthBlur: 28 } })
      setPluginSupports({ castSwap: { ...CS, depthFillBlur: true } } as never)
      expect((await buildToolkit().settings!.nodaroMotionMasking!())!["motion-pulse"]).toEqual(FILL_BLUR)
      expect((await buildToolkit().settings!.nodaroMotionMotion!())!["motion-prism"]).toEqual({ masking: { mode: "always", source: "full-depth" } })
    } finally {
      _resetPluginSupportsForTests()
    }
  })

  it("absent = before: a setting without either is answered exactly as before, whatever the engine declares", async () => {
    const before = { mode: "auto", fill: "depth", faceMesh: true, depthColormap: "inferno" }
    h.masking = { "motion-pulse": before, "motion-prism": { mode: "always" } }
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
      expect(answers[0]!["motion-pulse"]).toEqual(before)
    } finally {
      _resetPluginSupportsForTests()
    }
  })
})
