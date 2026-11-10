// @test-watches frontend/src/nodes/**
// (It reads no file: it holds every node type's default data, units included, to the rule.)
/**
 * A new node starts on a model the deployment offers (`components/editor/config-panels/new-node-models.ts`,
 * decided 2026-11-10): where the deployment restricts models and a model the
 * node would run from its default data is withheld, it starts on the first row
 * its own menu offers. Nothing changes where models are not restricted — not
 * even for a default an admin switched off.
 */
import { describe, it, expect, afterEach } from "vitest"
import { __resetSurfaceAvailabilityForTests, isModelUnavailable } from "@/lib/surface-availability"
import { NEW_NODE_MODEL_LEVERS, planNewNodeModels, withOfferedNewNodeModels } from "@/components/editor/config-panels/new-node-models"
import { NODE_DEFINITIONS } from "@/types/nodes"
import {
  DIALOGUE_MODELS,
  EVP_PROVIDERS,
  EXTEND_VIDEO_MODELS,
  GVP_PROVIDERS,
  IMAGE_GEN_MODELS,
  LIP_SYNC_MODELS,
  MODIFY_IMAGE_MODELS,
  MOTION_TRANSFER_MODELS,
  TTS_MODELS,
  UPSCALE_IMAGE_MODELS,
  VIDEO_DEPTH_MODELS,
  VIDEO_DURATION_OPTIONS,
  VIDEO_GEN_MODELS,
  VIDEO_I2V_MODELS,
  VIDEO_T2V_MODELS,
  VIDEO_V2V_MODELS,
  withoutDeniedModels,
} from "@/components/editor/config-panels/model-options"
import { PROVIDER_NODE_CATEGORIES } from "@/lib/provider-node-models"
import { DESCRIBE_TO_PICKER_MODELS, LLM_FEATURE_DEFAULTS, LLM_MODELS, STRUCTURED_VISION_MODELS, orderedLlmModels, type LlmModelDef } from "@nodaro/shared/llm-models"
import { MODEL_CATALOG, normalizeModelInput } from "@nodaro/shared/model-catalog"
import { VIDEO_MASK_PROVIDERS } from "@nodaro/shared/media"
import { motionTransferModelOf } from "@nodaro/render-rules"

afterEach(() => __resetSurfaceAvailabilityForTests(null))

const defaultsOf = (type: string): Record<string, unknown> => {
  const def = NODE_DEFINITIONS.find((d) => d.type === type)
  if (!def) throw new Error(`no definition for ${type}`)
  return { ...(def.defaultData as Record<string, unknown>) }
}

/** A restricted deployment withholding exactly `models` (as the answer lists them). */
const restrictedWithholding = (models: readonly string[]) =>
  __resetSurfaceAvailabilityForTests({ nodes: [], models: [...models], modelsRestricted: true })

const values = (registry: readonly { readonly value: string }[]) => registry.map((m) => m.value)
const llmRows = (filter?: (m: LlmModelDef) => boolean) => orderedLlmModels(filter ? LLM_MODELS.filter(filter) : LLM_MODELS).map((m) => m.id)
const structured = new Set(STRUCTURED_VISION_MODELS.map((m) => m.id))

/**
 * Each covered node type's menu rows in the order the panel renders them,
 * written out again here from the panel's own registry so the rule is held to
 * the menu, not to itself (the census pins each panel to the same registry).
 */
const MENU_ROWS: Readonly<Record<string, {
  readonly field: string
  readonly rows: () => readonly string[]
  readonly data?: Record<string, unknown>
  /** The model a row runs, for a menu whose rows are engine names (Motion Transfer's). */
  readonly modelOf?: (row: string) => string
}>> = {
  "generate-image": { field: "provider", rows: () => values(IMAGE_GEN_MODELS) },
  "modify-image": { field: "provider", rows: () => values(MODIFY_IMAGE_MODELS) },
  "upscale-image": { field: "provider", rows: () => values(UPSCALE_IMAGE_MODELS) },
  face: { field: "provider", rows: () => values(IMAGE_GEN_MODELS) },
  "generate-video": { field: "provider", rows: () => values(VIDEO_GEN_MODELS) },
  "image-to-video": { field: "provider", rows: () => values(VIDEO_I2V_MODELS) },
  "text-to-video": { field: "provider", rows: () => values(VIDEO_T2V_MODELS) },
  "generate-video-pro": { field: "provider", rows: () => values(GVP_PROVIDERS) },
  "edit-video-pro": { field: "provider", rows: () => values(EVP_PROVIDERS) },
  "extend-video": { field: "provider", rows: () => values(EXTEND_VIDEO_MODELS) },
  "video-to-video": { field: "provider", rows: () => values(VIDEO_V2V_MODELS) },
  "video-depth": { field: "provider", rows: () => values(VIDEO_DEPTH_MODELS) },
  "video-mask": { field: "provider", rows: () => [...VIDEO_MASK_PROVIDERS] },
  // Its rows are engines of catalog models: `kling` runs `motion-transfer`, `kling-3.0` runs `kling-3.0-motion`.
  "motion-transfer": { field: "provider", rows: () => values(MOTION_TRANSFER_MODELS), modelOf: motionTransferModelOf },
  "lip-sync": { field: "provider", rows: () => values(LIP_SYNC_MODELS) },
  provider: { field: "provider", rows: () => values(PROVIDER_NODE_CATEGORIES.video.models) },
  "text-to-speech": { field: "provider", rows: () => values(TTS_MODELS) },
  "text-to-dialogue": { field: "provider", rows: () => values(DIALOGUE_MODELS) },
  "llm-chat": { field: "llmModel", rows: () => llmRows() },
  "image-to-text": { field: "llmModel", rows: () => llmRows() },
  "image-critic": { field: "llmModel", rows: () => llmRows() },
  "qa-check": { field: "llmModel", rows: () => llmRows() },
  "describe-to-picker": { field: "llmModel", rows: () => llmRows((m) => DESCRIBE_TO_PICKER_MODELS.some((v) => v.id === m.id)) },
  "generate-script": { field: "llmModel", rows: () => llmRows() },
  // Text-only structured calls: the menu lists the models with a structured-output mode.
  "content-recipe": { field: "llmModel", rows: () => llmRows((m) => m.structuredOutputMode != null) },
  "content-ideas": { field: "llmModel", rows: () => llmRows((m) => m.structuredOutputMode != null) },
  "video-composer": { field: "llmModel", rows: () => llmRows() },
  "after-effects": { field: "llmModel", rows: () => llmRows() },
  "lottie-overlay": { field: "llmModel", rows: () => llmRows() },
  "3d-title": { field: "llmModel", rows: () => llmRows() },
  "motion-graphics": { field: "llmModel", rows: () => llmRows() },
  "generate-3d-scene": { field: "llmModel", rows: () => llmRows() },
  "edit-3d-scene": { field: "llmModel", rows: () => llmRows() },
  reduce: { field: "strategyConfig.llmModel", rows: () => llmRows() },
  // Analysis runs a model only while it is on: the menu is the one shown then.
  "instagram-scrape": { field: "analysisModel", rows: () => llmRows((m) => structured.has(m.id)), data: { analyze: true } },
  "meta-ads-scrape": { field: "analysisModel", rows: () => llmRows((m) => structured.has(m.id)), data: { analyze: true } },
}

const read = (data: Record<string, unknown>, field: string): unknown => {
  const [head, tail] = field.split(".")
  const v = data[head!]
  return tail === undefined ? v : (v as Record<string, unknown> | undefined)?.[tail]
}

/** The model a menu row makes the node run. */
const modelOfRow = (menu: (typeof MENU_ROWS)[string], row: string): string => (menu.modelOf ? menu.modelOf(row) : row)

/** The model a covered node runs from its defaults, before the rule. */
const defaultModelOf = (type: string, data: Record<string, unknown>) => NEW_NODE_MODEL_LEVERS[type]![0]!.runs(data)

describe("a node made from its defaults on a restricted deployment", () => {
  it("covers exactly the node types this test holds to a menu", () => {
    expect(Object.keys(MENU_ROWS).sort()).toEqual(Object.keys(NEW_NODE_MODEL_LEVERS).sort())
  })

  it.each(Object.keys(MENU_ROWS))("%s: a withheld default starts on the first row its menu offers", (type) => {
    const menu = MENU_ROWS[type]!
    const data = { ...defaultsOf(type), ...menu.data }
    const model = defaultModelOf(type, data)
    expect(model, `${type} runs a model from its defaults`).toBeTypeOf("string")
    restrictedWithholding([model!])

    const plan = planNewNodeModels(type, data)
    const expected = menu.rows().find((row) => modelOfRow(menu, row) !== model)
    expect(plan.moved).toEqual([{ field: menu.field, from: model, to: expected }])
    expect(read(plan.data, menu.field)).toBe(expected)
    // The node now runs the chosen model, which its menu shows as its first row.
    expect(defaultModelOf(type, plan.data)).toBe(modelOfRow(menu, expected!))
    expect(menu.rows().filter((row) => row === expected || !isModelUnavailable(modelOfRow(menu, row)))[0]).toBe(expected)
    // Nothing else in the data moved for a node whose settings do not follow its model.
    if (!["generate-image", "modify-image", "generate-video"].includes(type)) {
      const { [menu.field.split(".")[0]!]: _moved, ...rest } = plan.data
      const { [menu.field.split(".")[0]!]: _was, ...before } = data
      expect(rest).toEqual(before)
    }
  })

  it.each(Object.keys(MENU_ROWS))("%s: rows the deployment withholds are skipped, in menu order", (type) => {
    const menu = MENU_ROWS[type]!
    const data = { ...defaultsOf(type), ...menu.data }
    const model = defaultModelOf(type, data)!
    const others = menu.rows().filter((row) => modelOfRow(menu, row) !== model)
    if (others.length < 2) return
    restrictedWithholding([model, modelOfRow(menu, others[0]!)])
    expect(read(withOfferedNewNodeModels(type, data), menu.field)).toBe(others[1])
  })

  it.each(Object.keys(MENU_ROWS))("%s: a menu that offers nothing keeps today's default", (type) => {
    const menu = MENU_ROWS[type]!
    const data = { ...defaultsOf(type), ...menu.data }
    const model = defaultModelOf(type, data)!
    restrictedWithholding([model, ...menu.rows().map((row) => modelOfRow(menu, row))])
    const plan = planNewNodeModels(type, data)
    expect(plan.data).toBe(data)
    expect(plan.moved).toEqual([])
    expect(plan.nothingOffered).toEqual([{ field: menu.field, model }])
  })

  it("Modify Image and Text to Speech, the two defaults that prompted the rule", () => {
    restrictedWithholding(["gpt-image-2-6-flare-i2i", "elevenlabs-v4"])
    expect(withOfferedNewNodeModels("modify-image", defaultsOf("modify-image")).provider).toBe(MODIFY_IMAGE_MODELS[0]!.value)
    expect(withOfferedNewNodeModels("text-to-speech", defaultsOf("text-to-speech")).provider).toBe("elevenlabs-v3")
  })

  it("Describe Image names no model and runs its feature's default — that default is judged", () => {
    const data = defaultsOf("image-to-text")
    expect(data.llmModel).toBeUndefined()
    restrictedWithholding([LLM_FEATURE_DEFAULTS["image-to-text"]])
    const next = withOfferedNewNodeModels("image-to-text", data)
    expect(next.llmModel).toBe(llmRows().find((id) => id !== LLM_FEATURE_DEFAULTS["image-to-text"]))
  })

  it("a default the deployment offers is left alone — the very same data", () => {
    restrictedWithholding(["some-other-model"])
    for (const type of Object.keys(MENU_ROWS)) {
      const data = { ...defaultsOf(type), ...MENU_ROWS[type]!.data }
      expect(withOfferedNewNodeModels(type, data), type).toBe(data)
    }
  })

  it("a stored model the menu edits is judged, not the field's default", () => {
    restrictedWithholding(["veo3"])
    const data = { ...defaultsOf("generate-video"), provider: "veo3" }
    expect(withOfferedNewNodeModels("generate-video", data).provider).not.toBe("veo3")
    // The defaults' own model is offered, so a node holding it stays.
    expect(withOfferedNewNodeModels("generate-video", defaultsOf("generate-video"))).toEqual(defaultsOf("generate-video"))
  })
})

describe("settings that follow the model", () => {
  it("Generate Image's ratio and size are fitted to the model it starts on", () => {
    const data = defaultsOf("generate-image")
    restrictedWithholding([String(data.provider)])
    const next = withOfferedNewNodeModels("generate-image", data)
    const model = String(next.provider)
    expect(model).not.toBe(data.provider)
    const fit = normalizeModelInput(model, { aspectRatio: next.aspectRatio as string | undefined, resolution: next.resolution as string | undefined })
    expect(fit.adjustments).toEqual([])
  })

  it("Generate Image's model list follows its first model", () => {
    restrictedWithholding(["gpt-image-2"])
    const data: Record<string, unknown> = { ...defaultsOf("generate-image"), providers: ["gpt-image-2", "flux"] }
    const next = withOfferedNewNodeModels("generate-image", data)
    expect(next.provider).not.toBe("gpt-image-2")
    expect(next.providers).toEqual([next.provider, ...(next.provider === "flux" ? [] : ["flux"])])
  })

  it("Generate Image's linked model (written by an admin default) follows the new provider", () => {
    restrictedWithholding(["nano-banana-2-lite"])
    const data: Record<string, unknown> = { ...defaultsOf("generate-image"), provider: "nano-banana-2-lite", model: "gemini-3.1-flash-lite-image" }
    const next = withOfferedNewNodeModels("generate-image", data)
    expect(next.provider).not.toBe("nano-banana-2-lite")
    expect(next.model).not.toBe("gemini-3.1-flash-lite-image")
  })

  it("Generate Video's duration is snapped as its run strip snaps it on a model switch", () => {
    const data = defaultsOf("generate-video")
    // Withhold every model that takes the default 4 s, so the node lands on one that does not.
    const takes4 = values(VIDEO_GEN_MODELS).filter((v) => VIDEO_DURATION_OPTIONS[v]?.some((o) => o.value === 4))
    restrictedWithholding(takes4)
    expect(data.duration).toBe(4)
    const next = withOfferedNewNodeModels("generate-video", data)
    const options = VIDEO_DURATION_OPTIONS[String(next.provider)]
    expect(options, `${String(next.provider)} lists its durations`).toBeDefined()
    expect(next.duration).not.toBe(4)
    expect(options!.map((o) => o.value)).toContain(next.duration)
  })
})

describe("levers that run a model only in some states", () => {
  it("a scrape's analysis model is judged only while analysis is on", () => {
    restrictedWithholding([LLM_FEATURE_DEFAULTS["meta-ads-analysis"]])
    for (const type of ["instagram-scrape", "meta-ads-scrape"]) {
      const data = defaultsOf(type)
      expect(data.analyze, type).not.toBe(true)
      expect(withOfferedNewNodeModels(type, data), type).toBe(data)
    }
  })

  it("a 3D scene on another engine runs no planner, so nothing moves", () => {
    restrictedWithholding([LLM_FEATURE_DEFAULTS["3d-scene"]])
    const data = { ...defaultsOf("generate-3d-scene"), engine: "blender-cloud" }
    expect(withOfferedNewNodeModels("generate-3d-scene", data)).toBe(data)
  })

  it("Choose Best's judge moves inside its strategy settings, which keep the rest", () => {
    const data = defaultsOf("reduce")
    restrictedWithholding([LLM_FEATURE_DEFAULTS["pick-best-llm"]])
    const next = withOfferedNewNodeModels("reduce", data)
    expect(next.strategyConfig).toEqual({ ...(data.strategyConfig as object), llmModel: llmRows().find((id) => id !== LLM_FEATURE_DEFAULTS["pick-best-llm"]) })
    expect(withOfferedNewNodeModels("reduce", { ...data, strategyId: "first" })).toEqual({ ...data, strategyId: "first" })
  })

  it("Generate Script judges the model its run resolves (an explicit model, else the legacy provider's)", () => {
    const data = defaultsOf("generate-script")
    restrictedWithholding(["gemini-3.6-flash"])
    const next = withOfferedNewNodeModels("generate-script", data)
    expect(next.llmModel).toBe(llmRows().find((id) => id !== "gemini-3.6-flash"))
    expect(next.provider).toBe(data.provider)
  })

  it("a Provider node picks from its own category's list", () => {
    const data = { ...defaultsOf("provider"), category: "image", provider: "gpt-image-2" }
    restrictedWithholding(["gpt-image-2"])
    expect(withOfferedNewNodeModels("provider", data).provider).toBe(values(IMAGE_GEN_MODELS).find((v) => v !== "gpt-image-2"))
  })
})

describe("byte-identical where models are not restricted", () => {
  /** Every model a covered node runs from its defaults, plus the whole catalog and every LLM. */
  const everyModel = [
    ...Object.keys(MODEL_CATALOG),
    ...LLM_MODELS.map((m) => m.id),
    ...Object.entries(MENU_ROWS).flatMap(([type, menu]) => [defaultModelOf(type, { ...defaultsOf(type), ...menu.data }) ?? "", ...menu.rows()]),
  ]

  it("no restriction, even with every model switched off: every node type's defaults come back as they are", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: everyModel, modelsRestricted: false })
    for (const def of NODE_DEFINITIONS) {
      const data = { ...(def.defaultData as Record<string, unknown>) }
      const plan = planNewNodeModels(def.type, data)
      expect(plan.data, def.type).toBe(data)
      expect(plan.moved, def.type).toEqual([])
    }
  })

  it("before the answer lands, with no profile lists: every node type's defaults come back as they are", () => {
    __resetSurfaceAvailabilityForTests(null)
    for (const def of NODE_DEFINITIONS) {
      const data = { ...(def.defaultData as Record<string, unknown>) }
      expect(planNewNodeModels(def.type, data).data, def.type).toBe(data)
    }
  })

  it("a switched-off default on a deployment that restricts nothing is kept (and refused at run, as today)", () => {
    __resetSurfaceAvailabilityForTests({ nodes: [], models: ["gpt-image-2-6-flare-i2i"], modelsRestricted: false })
    const data = defaultsOf("modify-image")
    expect(withOfferedNewNodeModels("modify-image", data)).toBe(data)
    // The menu still hides it for anyone who opens it, as before.
    expect(withoutDeniedModels(MODIFY_IMAGE_MODELS, { nodeType: "modify-image" }).map((m) => m.value)).not.toContain("gpt-image-2-6-flare-i2i")
  })
})

describe("before the availability answer lands", () => {
  afterEach(() => {
    delete (window as { __NODARO_RUNTIME__?: unknown }).__NODARO_RUNTIME__
  })

  it("the static profile's own deny list is judged at once", () => {
    ;(window as { __NODARO_RUNTIME__?: unknown }).__NODARO_RUNTIME__ = { surface: { models: { deny: ["gpt-image-2-6-flare-i2i"] } } }
    __resetSurfaceAvailabilityForTests(null)
    expect(withOfferedNewNodeModels("modify-image", defaultsOf("modify-image")).provider).toBe(MODIFY_IMAGE_MODELS[0]!.value)
  })

  it("an allow-list alone is not known yet, so nothing moves until the answer lands", () => {
    ;(window as { __NODARO_RUNTIME__?: unknown }).__NODARO_RUNTIME__ = { surface: { models: { allow: ["flux"] } } }
    __resetSurfaceAvailabilityForTests(null)
    const data = defaultsOf("modify-image")
    expect(withOfferedNewNodeModels("modify-image", data)).toBe(data)
  })
})
