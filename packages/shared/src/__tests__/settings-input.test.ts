import { describe, it, expect } from "vitest"
import {
  SETTINGS_INPUT_CONSUMERS,
  SETTINGS_INPUT_HANDLE,
  applySettingsInput,
  connectedSettingsSources,
  resolveWiredSettings,
  settingsInputAccepts,
  settingsInputFields,
  settingsProviderModels,
  settingsSourceForField,
  snapToModelDuration,
  withWiredSettings,
  isSettingsHintEdge,
} from "../settings-input.js"
import { NODE_MAPPABLE_FIELDS } from "../node-mappable-fields.js"
import { DEFAULT_VIDEO_PROVIDER, GVP_SUPPORTED_PROVIDERS, IMAGE_GEN_PROVIDERS, VIDEO_GEN_PROVIDERS } from "../model-constants.js"
import { fitAspectRatioToModel, normalizeVideoRequestParams } from "../model-catalog.js"

const nodes = [
  { id: "gv", type: "generate-video", data: { provider: "seedance-2", duration: 8, aspectRatio: "16:9" } },
  { id: "gi", type: "generate-image", data: { provider: "nano-banana-pro", providers: ["nano-banana-pro", "seedream"], aspectRatio: "16:9" } },
  { id: "nb", type: "provider", data: { label: "Image model", category: "image", provider: "nano-banana" } },
  { id: "gvp", type: "generate-video-pro", data: { provider: "seedance-2", duration: 30 } },
  { id: "ratio", type: "aspect-ratio", data: { label: "Aspect Ratio", ratio: "9:16" } },
  { id: "len", type: "duration", data: { label: "Duration", seconds: 60 } },
  { id: "len2", type: "duration", data: { label: "Short", seconds: 5 } },
  { id: "veo", type: "provider", data: { label: "Provider", category: "video", provider: "veo3" } },
  { id: "img", type: "provider", data: { label: "Image model", category: "image", provider: "nano-banana" } },
  { id: "tone", type: "tone", data: { label: "Tone", tone: "calm" } },
]
const typeOf = (id: string) => nodes.find((n) => n.id === id)?.type
const wire = (source: string, target = "gv", targetHandle: string = SETTINGS_INPUT_HANDLE) => ({ source, target, targetHandle })

describe("Settings input consumers", () => {
  it("takes Aspect Ratio, Duration and Provider on Generate Video", () => {
    for (const t of ["aspect-ratio", "duration", "provider"]) expect(settingsInputAccepts("generate-video", t)).toBe(true)
    expect(settingsInputAccepts("generate-video", "tone")).toBe(false)
    expect(settingsInputAccepts("generate-image", "duration")).toBe(false)
  })

  // Generate Video Pro re-exports Generate Video's handle validator, which asks
  // for "generate-video"'s list — so the two lists must be the same.
  it("gives Generate Video Pro exactly Generate Video's settings", () => {
    expect(SETTINGS_INPUT_CONSUMERS["generate-video-pro"]).toEqual(SETTINGS_INPUT_CONSUMERS["generate-video"])
  })

  it("lists every field it sets as mappable, so both engines resolve it", () => {
    for (const consumer of Object.keys(SETTINGS_INPUT_CONSUMERS)) {
      for (const field of settingsInputFields(consumer)) expect(NODE_MAPPABLE_FIELDS[consumer]).toContain(field)
    }
  })

  it("accepts each consumer's own models", () => {
    expect(settingsProviderModels("generate-video")).toEqual(VIDEO_GEN_PROVIDERS)
    expect(settingsProviderModels("generate-video-pro")).toEqual(GVP_SUPPORTED_PROVIDERS)
    expect(settingsProviderModels("generate-image")).toEqual(IMAGE_GEN_PROVIDERS)
    expect(settingsProviderModels("llm-chat")).toEqual([])
  })

  it("takes Aspect Ratio and Provider on Generate Image, and no Duration", () => {
    expect(settingsInputAccepts("generate-image", "aspect-ratio")).toBe(true)
    expect(settingsInputAccepts("generate-image", "provider")).toBe(true)
    expect(settingsInputAccepts("generate-image", "duration")).toBe(false)
  })
})

describe("settingsSourceForField", () => {
  it("finds the node that sets a field, and the last edge of a kind wins", () => {
    const edges = [wire("len"), wire("len2")]
    expect(settingsSourceForField("gv", "generate-video", "duration", edges, typeOf)).toBe("len2")
  })

  it("ignores other handles, other targets and nodes the input does not take", () => {
    const edges = [wire("len", "gv", "prompt"), wire("len", "other"), wire("tone")]
    expect(settingsSourceForField("gv", "generate-video", "duration", edges, typeOf)).toBeUndefined()
    expect(connectedSettingsSources("gv", "generate-video", edges, typeOf)).toEqual([])
  })

  it("lists one source per kind, in the consumer's order", () => {
    const edges = [wire("veo"), wire("len"), wire("ratio")]
    expect(connectedSettingsSources("gv", "generate-video", edges, typeOf).map((c) => c.field)).toEqual(["aspectRatio", "duration", "provider"])
  })
})

describe("snapToModelDuration", () => {
  it("fits a length to the nearest one the model renders", () => {
    expect(snapToModelDuration("seedance-2", 60)).toBe(15)
    expect(snapToModelDuration("seedance-2", 1)).toBe(4)
    expect(snapToModelDuration("veo3", 8)).toBe(8)
  })

  it("breaks a tie toward the shorter length, as the provider does", () => {
    expect(snapToModelDuration("veo3", 7)).toBe(6)
    expect(snapToModelDuration("grok-i2v", 8)).toBe(6)
  })

  it("keeps the value for a model without a duration list", () => {
    expect(snapToModelDuration("not-a-model", 42)).toBe(42)
  })
})

describe("applySettingsInput", () => {
  const data = { provider: "veo3", duration: "60", aspectRatio: "4:5" }

  it("changes nothing when no setting is wired", () => {
    expect(applySettingsInput("generate-video", "gv", data, [], typeOf)).toEqual({ data })
  })

  it("fits a wired Duration and Aspect Ratio to the model", () => {
    const edges = [wire("len"), wire("ratio"), wire("veo")]
    expect(applySettingsInput("generate-video", "gv", data, edges, typeOf).data).toMatchObject({ duration: 8, aspectRatio: "9:16" })
  })

  it("fits to the node's default model when no model is set", () => {
    const edges = [wire("len")]
    const fitted = applySettingsInput("generate-video", "gv", { duration: "60" }, edges, typeOf).data
    expect(fitted.duration).toBe(snapToModelDuration(DEFAULT_VIDEO_PROVIDER, 60))
  })

  it("keeps Generate Video Pro's total length — its engine stitches and clamps it", () => {
    const edges = [wire("len", "gvp")]
    expect(applySettingsInput("generate-video-pro", "gvp", { provider: "seedance-2", duration: "60" }, edges, typeOf).data.duration).toBe("60")
  })

  it("refuses a wired Provider naming a model the node does not run", () => {
    const edges = [wire("img")]
    const result = applySettingsInput("generate-video", "gv", { provider: "nano-banana" }, edges, typeOf)
    expect(result.problem).toEqual({ kind: "provider-not-accepted", sourceId: "img", value: "nano-banana" })
  })

  it("refuses a video model outside Generate Video Pro's models", () => {
    const edges = [wire("veo", "gvp")]
    const result = applySettingsInput("generate-video-pro", "gvp", { provider: "veo3" }, edges, typeOf)
    expect(result.problem?.sourceId).toBe("veo")
  })
})

describe("Generate Image", () => {
  const wireImage = (source: string) => wire(source, "gi")

  it("a wired Provider makes a several-model node one model", () => {
    const resolved = resolveWiredSettings("gi", "generate-image", nodes[1]!.data, nodes, [wireImage("nb")])
    expect(resolved.data).toMatchObject({ provider: "nano-banana", providers: ["nano-banana"] })
  })

  it("refuses a video model", () => {
    expect(resolveWiredSettings("gi", "generate-image", nodes[1]!.data, nodes, [wireImage("veo")]).problem?.value).toBe("veo3")
  })

  it("fits a wired ratio to the image model", () => {
    const resolved = resolveWiredSettings("gi", "generate-image", nodes[1]!.data, nodes, [wireImage("ratio")])
    expect(resolved.data.aspectRatio).toBe(fitAspectRatioToModel("nano-banana-pro", "9:16"))
  })

  it("leaves the model list alone when no Provider is wired", () => {
    const resolved = resolveWiredSettings("gi", "generate-image", nodes[1]!.data, nodes, [wireImage("ratio")])
    expect(resolved.data.providers).toEqual(["nano-banana-pro", "seedream"])
  })
})

describe("fitAspectRatioToModel", () => {
  it("keeps a ratio the model lists, in the catalog's spelling", () => {
    expect(fitAspectRatioToModel("seedance-2", "16:9")).toBe("16:9")
    expect(fitAspectRatioToModel("seedance-2", "ADAPTIVE")).toBe("ADAPTIVE")
  })

  it("fits an unlisted ratio to the nearest listed one, keeping its orientation", () => {
    expect(fitAspectRatioToModel("seedance-2", "4:5")).toBe("3:4")
    expect(fitAspectRatioToModel("veo3", "4:5")).toBe("9:16")
  })

  it("passes through for a model without a ratio list or an unknown model", () => {
    expect(fitAspectRatioToModel("kling-3.0", "4:5")).toBe("4:5")
    expect(fitAspectRatioToModel("not-a-model", "4:5")).toBe("4:5")
  })

  // The video lane's normalizer applies the same rule — one implementation.
  it("agrees with the video lane's normalizer", () => {
    for (const ratio of ["4:5", "21:9", "1:1", "5:4", "2:3"]) {
      expect(normalizeVideoRequestParams("seedance-2", { aspectRatio: ratio }).aspectRatio).toBe(fitAspectRatioToModel("seedance-2", ratio))
    }
  })
})

describe("withWiredSettings", () => {
  it("returns the node as it runs, and the node itself without the graph", () => {
    const image = nodes[1]!
    expect(withWiredSettings(image, nodes, [wire("nb", "gi")]).data).toMatchObject({ providers: ["nano-banana"] })
    expect(withWiredSettings(image)).toBe(image)
    expect(withWiredSettings({ id: "t", type: "tone", data: {} }, nodes, [])).toEqual({ id: "t", type: "tone", data: {} })
  })
})

describe("Motion (a prompt-clause setting)", () => {
  const motion = { id: "mo", type: "motion", data: { label: "Motion", motion: "subtle" } }
  const motion2 = { id: "mo2", type: "motion", data: { label: "Motion 2", motion: "dynamic" } }
  const graph = [...nodes, motion, motion2]
  const typeOfGraph = (id: string) => graph.find((n) => n.id === id)?.type

  it("is taken by the video nodes, not by Generate Image, and sets no field", () => {
    expect(settingsInputAccepts("generate-video", "motion")).toBe(true)
    expect(settingsInputAccepts("generate-video-pro", "motion")).toBe(true)
    expect(settingsInputAccepts("generate-image", "motion")).toBe(false)
    expect(settingsInputFields("generate-video")).toEqual(["aspectRatio", "duration", "provider"])
  })

  it("is listed as wired, without a field, and writes nothing into the data", () => {
    const resolved = resolveWiredSettings("gv", "generate-video", nodes[0]!.data, graph, [wire("mo")])
    expect(resolved.wired).toEqual([{ sourceType: "motion", sourceId: "mo", value: "subtle" }])
    expect(resolved.data).toEqual(nodes[0]!.data)
  })

  it("brings its clause only from the last Motion wired", () => {
    const edges = [wire("mo"), wire("mo2")]
    expect(isSettingsHintEdge(edges[0]!, "generate-video", edges, typeOfGraph)).toBe(false)
    expect(isSettingsHintEdge(edges[1]!, "generate-video", edges, typeOfGraph)).toBe(true)
  })

  it("brings no clause into a node that does not take it, or through another handle", () => {
    expect(isSettingsHintEdge(wire("mo", "gi"), "generate-image", [wire("mo", "gi")], typeOfGraph)).toBe(false)
    expect(isSettingsHintEdge(wire("mo", "gv", "look"), "generate-video", [wire("mo", "gv", "look")], typeOfGraph)).toBe(false)
  })

  it("does not count as the field setting of its kind", () => {
    expect(settingsSourceForField("gv", "generate-video", "duration", [wire("mo")], typeOfGraph)).toBeUndefined()
  })
})

describe("resolveWiredSettings", () => {
  it("writes each wired value in and fits it, as the engines do", () => {
    const edges = [wire("len"), wire("ratio"), wire("veo")]
    const resolved = resolveWiredSettings("gv", "generate-video", nodes[0]!.data, nodes, edges)
    expect(resolved.data).toMatchObject({ provider: "veo3", duration: 8, aspectRatio: "9:16" })
    expect(resolved.wired.map((w) => [w.field, w.value])).toEqual([
      ["aspectRatio", "9:16"],
      ["duration", "60"],
      ["provider", "veo3"],
    ])
    expect(resolved.problem).toBeUndefined()
  })

  it("reports a Provider the node cannot run", () => {
    const resolved = resolveWiredSettings("gv", "generate-video", nodes[0]!.data, nodes, [wire("img")])
    expect(resolved.problem?.value).toBe("nano-banana")
  })

  it("returns the node's own data when nothing is wired", () => {
    const resolved = resolveWiredSettings("gv", "generate-video", nodes[0]!.data, nodes, [])
    expect(resolved).toEqual({ data: nodes[0]!.data, wired: [] })
  })
})
