/**
 * A new node starts on a model the deployment offers (decided 2026-11-10).
 *
 * The model menus hide what a deployment withholds but keep the model a node
 * holds, so on a deployment whose list lacks a node's default a fresh node used
 * to be refused on its first run. Now, when the editor makes a node from its
 * default data and a model the node would run is withheld, the node starts on
 * the FIRST row its own menu offers — the same registry, filter and order the
 * panel renders, so the menu shows the chosen model as its first row.
 *
 *  - Only where the deployment RESTRICTS models (`modelRestrictionActive`).
 *    A deployment that restricts nothing keeps every default exactly as it is,
 *    even one whose default an admin switched off.
 *  - Only at creation, never at run: a saved node keeps its model, still shown
 *    and refused at run; a copy, paste or duplicate keeps the source's.
 *  - A menu that offers nothing leaves the default as it is.
 *
 * Each lever names the field its menu writes, the model that field makes the
 * node run (the stored value, else the default it runs with none, read from the
 * same source the server reads), and the rows its menu offers. Which panel
 * renders each menu, with which registry or LLM feature, is pinned by
 * `__tests__/new-node-models-census.test.ts`, which also fails a node type that
 * carries a model in its defaults or renders a model menu and is neither here
 * nor exempt there with a reason.
 */
import {
  EVP_PROVIDERS,
  EXTEND_VIDEO_MODELS,
  GVP_PROVIDERS,
  DIALOGUE_MODELS,
  IMAGE_GEN_MODELS,
  LIP_SYNC_MODELS,
  MODIFY_IMAGE_MODELS,
  TTS_MODELS,
  UPSCALE_IMAGE_MODELS,
  VIDEO_DEPTH_MODELS,
  VIDEO_GEN_MODELS,
  VIDEO_I2V_MODELS,
  VIDEO_T2V_MODELS,
  VIDEO_V2V_MODELS,
  withoutDeniedModels,
} from "./model-options"
import { generateVideoProviderSnap } from "@/lib/generate-video-provider-snap"
import { cachedFreeVideoLimits } from "@/lib/free-video-locks"
import { PROVIDER_NODE_CATEGORIES, validProviderSelection } from "@/lib/provider-node-models"
import { isModelUnavailable, modelRestrictionActive, subscribeSurfaceAvailability, surfaceAvailabilityLoaded } from "@/lib/surface-availability"
import { describeToPickerModel, structuredOutputModel, structuredVisionModel } from "@/lib/llm-model-filters"
import {
  LLM_FEATURE_DEFAULTS,
  LLM_MODELS,
  llmDefaultsFeature,
  motionGraphicsFeature,
  orderedLlmModels,
  resolveScriptModelId,
  type LlmModelDef,
} from "@nodaro/shared/llm-models"
import { IMAGE_MODEL_ROLE_DEFAULTS, defaultImageModelForNode } from "@nodaro/shared/model-catalog"
import { DEFAULT_TTS_PROVIDER, DEFAULT_VIDEO_TO_VIDEO_PROVIDER, deriveLinkedFields, dialogueProviderOf } from "@nodaro/shared/models"
import { VIDEO_MASK_PROVIDERS, resolveVideoDepthProvider, resolveVideoMaskProvider } from "@nodaro/shared/media"
import { normalizeNodeModelParams } from "@nodaro/shared/nodes"
import { SCENE3D_BASIC_ENGINE } from "@nodaro/shared/scene3d"
import type { ProviderData } from "@/types/nodes"

type Data = Readonly<Record<string, unknown>>

/** Where a lever's menu renders and what it renders — the census holds the panel to it. */
export type NewNodeModelMenu =
  /** `<file in config-panels>#<component>` rendering `registry` through the deployment filter. */
  | { readonly site: string; readonly registry: string }
  /** An `LlmModelSelect` with this `feature` (and this `filter` list, when it narrows the models). */
  | { readonly site: string; readonly llmFeature: string; readonly filter?: string }

export interface NewNodeModelLever {
  /** The data field the menu writes (`a.b`: `b` inside the object field `a`). */
  readonly field: string
  readonly menu: NewNodeModelMenu
  /**
   * The model this field makes the node run: the stored value, else the
   * default the node runs with none. Undefined when the field runs no model
   * as the data stands (an engine that runs none, analysis switched off).
   */
  readonly runs: (d: Data) => string | undefined
  /** The rows the menu offers on this deployment, in the order it renders them. */
  readonly offered: (d: Data) => readonly string[]
  /** The data with the node on `model`. */
  readonly put: (d: Data, model: string) => Record<string, unknown>
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v)

/** A registry menu rendered through `withoutDeniedModels`, as the panels render it (without the stored model it keeps). */
const offeredRows = (registry: readonly { readonly value: string }[]) => (): readonly string[] =>
  withoutDeniedModels(registry).map((m) => m.value)

/** An `LlmModelSelect`: its filter, the deployment's filter, then the vendor-and-tier order it renders. */
const offeredLlms = (filter?: (m: LlmModelDef) => boolean) => (): readonly string[] =>
  orderedLlmModels((filter ? LLM_MODELS.filter(filter) : LLM_MODELS).filter((m) => !isModelUnavailable(m.id))).map((m) => m.id)

/** The model an LLM feature runs with none named — the server's own default for it. */
const llmDefault = (feature: string): string | undefined => {
  const own = llmDefaultsFeature(feature)
  return Object.hasOwn(LLM_FEATURE_DEFAULTS, own) ? (LLM_FEATURE_DEFAULTS as Record<string, string>)[own] : undefined
}

const putField = (field: string) => (d: Data, model: string): Record<string, unknown> => ({ ...d, [field]: model })

/** A `provider` menu over a registry; `fallback` is the default a node naming none runs (when its defaults may name none). */
function providerLever(site: string, registryName: string, registry: readonly { readonly value: string }[], fallback?: (d: Data) => string | undefined): NewNodeModelLever {
  return {
    field: "provider",
    menu: { site, registry: registryName },
    runs: (d) => str(d.provider) ?? fallback?.(d),
    offered: offeredRows(registry),
    put: putField("provider"),
  }
}

/** An `llmModel` menu (`LlmModelSelect`) whose unset value runs the feature's default. */
function llmLever(site: string, feature: string, options: { filterName?: string; filter?: (m: LlmModelDef) => boolean } = {}): NewNodeModelLever {
  return {
    field: "llmModel",
    menu: { site, llmFeature: feature, ...(options.filterName ? { filter: options.filterName } : {}) },
    runs: (d) => str(d.llmModel) ?? llmDefault(feature),
    offered: offeredLlms(options.filter),
    put: putField("llmModel"),
  }
}

/** A scrape's ad analysis: it runs a model only while analysis is on. */
function analysisLever(site: string): NewNodeModelLever {
  return {
    field: "analysisModel",
    menu: { site, llmFeature: "meta-ads-analysis", filter: "structuredVisionModel" },
    runs: (d) => (d.analyze === true ? (str(d.analysisModel) ?? llmDefault("meta-ads-analysis")) : undefined),
    offered: offeredLlms(structuredVisionModel),
    put: putField("analysisModel"),
  }
}

/** A 3D scene's planner: the basic engine plans with an LLM; another engine (or an edit's operations) runs none. */
const scene3dLever = (site: string): NewNodeModelLever => ({
  ...llmLever(site, "3d-scene"),
  runs: (d) => {
    if (Array.isArray(d.operations)) return undefined
    const engine = str(d.engine)
    return engine === undefined || engine === SCENE3D_BASIC_ENGINE ? (str(d.llmModel) ?? llmDefault("3d-scene")) : undefined
  },
})

/** The image nodes' settings follow the new model through the catalog normalizer, as a write boundary heals them. */
const fitImageSettings = (type: string) => (d: Data, model: string): Record<string, unknown> => {
  const next = { ...d, provider: model }
  return normalizeNodeModelParams([{ id: "new-node", type, data: next }]).nodes[0]!.data as Record<string, unknown>
}

/**
 * Every node type whose own menu sets a model it runs, with the levers that
 * menu edits. Node types whose menu is not here (an unfiltered hand-written
 * list, a value that is not a model id, no menu at all) are listed with their
 * reason in the census test.
 */
export const NEW_NODE_MODEL_LEVERS: Readonly<Record<string, readonly NewNodeModelLever[]>> = {
  // ── Image ──
  "generate-image": [{
    field: "provider",
    menu: { site: "image-configs.tsx#GenerateImageConfigImpl", registry: "IMAGE_GEN_MODELS" },
    // The panel's list is `providers` (else `[provider]`); its first entry is the model `provider` mirrors.
    runs: (d) => (Array.isArray(d.providers) ? str(d.providers[0]) : undefined) ?? str(d.provider) ?? defaultImageModelForNode("generate-image", str(d.aspectRatio)),
    offered: offeredRows(IMAGE_GEN_MODELS),
    put: (d, model) => {
      const fitted = fitImageSettings("generate-image")(d, model)
      // The `model` an admin default links to its provider follows the new provider, as that layer derives it.
      const linked = d.model !== undefined ? { model: deriveLinkedFields("generate-image", model).model } : {}
      return Array.isArray(d.providers) && d.providers.length > 0
        ? { ...fitted, ...linked, providers: [model, ...d.providers.slice(1).filter((p) => p !== model)] }
        : { ...fitted, ...linked }
    },
  }],
  "modify-image": [{
    ...providerLever("image-configs.tsx#ModifyImageConfigImpl", "MODIFY_IMAGE_MODELS", MODIFY_IMAGE_MODELS, (d) => defaultImageModelForNode("modify-image", str(d.aspectRatio))),
    put: fitImageSettings("modify-image"),
  }],
  "upscale-image": [providerLever("image-configs.tsx#UpscaleImageConfig", "UPSCALE_IMAGE_MODELS", UPSCALE_IMAGE_MODELS)],
  face: [providerLever("entity-configs.tsx#FaceConfig", "IMAGE_GEN_MODELS", IMAGE_GEN_MODELS, () => IMAGE_MODEL_ROLE_DEFAULTS.character)],
  // ── Video ──
  "generate-video": [{
    ...providerLever("video-configs.tsx#GenerateVideoConfigImpl", "VIDEO_GEN_MODELS", VIDEO_GEN_MODELS),
    // The same patch the node's run strip writes on a model switch.
    put: (d, model) => ({ ...d, provider: model, ...generateVideoProviderSnap(d, model, cachedFreeVideoLimits()) }),
  }],
  "image-to-video": [providerLever("video-configs.tsx#ImageToVideoConfigImpl", "VIDEO_I2V_MODELS", VIDEO_I2V_MODELS)],
  "text-to-video": [providerLever("video-configs.tsx#TextToVideoConfigImpl", "VIDEO_T2V_MODELS", VIDEO_T2V_MODELS)],
  "generate-video-pro": [providerLever("video-configs.tsx#GenerateVideoProConfigImpl", "GVP_PROVIDERS", GVP_PROVIDERS)],
  "edit-video-pro": [providerLever("video-configs.tsx#EditVideoProConfigImpl", "EVP_PROVIDERS", EVP_PROVIDERS)],
  "extend-video": [providerLever("video-configs.tsx#ExtendVideoConfig", "EXTEND_VIDEO_MODELS", EXTEND_VIDEO_MODELS)],
  "video-to-video": [providerLever("video-configs.tsx#VideoToVideoConfigImpl", "VIDEO_V2V_MODELS", VIDEO_V2V_MODELS, () => DEFAULT_VIDEO_TO_VIDEO_PROVIDER)],
  "video-depth": [{
    ...providerLever("video-configs.tsx#VideoDepthConfig", "VIDEO_DEPTH_MODELS", VIDEO_DEPTH_MODELS),
    runs: (d) => resolveVideoDepthProvider(d.provider),
  }],
  "video-mask": [{
    field: "provider",
    menu: { site: "video-mask-config.tsx#VideoMaskConfig", registry: "VIDEO_MASK_PROVIDERS" },
    runs: (d) => resolveVideoMaskProvider(d.provider),
    offered: () => VIDEO_MASK_PROVIDERS.filter((p) => !isModelUnavailable(p)),
    put: putField("provider"),
  }],
  "lip-sync": [providerLever("audio-configs.tsx#LipSyncConfig", "LIP_SYNC_MODELS", LIP_SYNC_MODELS)],
  // The Provider parameter node: the model it hands the node it drives, from its category's list.
  provider: [{
    field: "provider",
    menu: { site: "parameter-configs.tsx#ProviderConfig", registry: "PROVIDER_NODE_CATEGORIES" },
    runs: (d) => validProviderSelection(d as ProviderData).provider,
    offered: (d) => withoutDeniedModels(PROVIDER_NODE_CATEGORIES[validProviderSelection(d as ProviderData).category].models).map((m) => m.value),
    put: putField("provider"),
  }],
  // ── Audio ──
  "text-to-speech": [providerLever("audio-configs.tsx#TextToSpeechConfig", "TTS_MODELS", TTS_MODELS, () => DEFAULT_TTS_PROVIDER)],
  "text-to-dialogue": [{
    ...providerLever("audio-configs.tsx#TextToDialogueConfig", "DIALOGUE_MODELS", DIALOGUE_MODELS),
    runs: (d) => dialogueProviderOf(d.provider),
  }],
  // ── LLM ──
  "llm-chat": [llmLever("llm-chat-config.tsx#LLMChatConfig", "llm-chat")],
  "image-to-text": [llmLever("script-configs.tsx#ImageToTextConfig", "image-to-text")],
  "image-critic": [llmLever("script-configs.tsx#ImageCriticConfig", "image-critic")],
  "qa-check": [llmLever("script-configs.tsx#QACheckConfig", "qa-check")],
  "describe-to-picker": [llmLever("script-configs.tsx#DescribeToPickerConfig", "describe-to-picker", { filterName: "describeToPickerModel", filter: describeToPickerModel })],
  "generate-script": [{
    ...llmLever("script-configs.tsx#GenerateScriptConfig", "generate-script"),
    // An explicit model, else the legacy script provider's, else the feature's: the model the run uses.
    runs: (d) => resolveScriptModelId(str(d.provider), str(d.llmModel)),
  }],
  "content-recipe": [llmLever("content-configs.tsx#ContentRecipeConfig", "content-recipe", { filterName: "structuredOutputModel", filter: structuredOutputModel })],
  "content-ideas": [llmLever("content-configs.tsx#ContentIdeasConfig", "content-ideas", { filterName: "structuredOutputModel", filter: structuredOutputModel })],
  "video-composer": [llmLever("composition-configs.tsx#VideoComposerConfig", "scene-graph-ai")],
  "after-effects": [llmLever("composition-configs.tsx#AfterEffectsConfig", "after-effects")],
  "lottie-overlay": [llmLever("composition-configs.tsx#LottieOverlayConfig", "lottie-overlay")],
  "3d-title": [llmLever("composition-configs.tsx#ThreeDTitleConfig", "3d-title")],
  "motion-graphics": [{
    ...llmLever("composition-configs.tsx#MotionGraphicsConfig", "motion-graphics"),
    menu: { site: "composition-configs.tsx#MotionGraphicsConfig", llmFeature: "motionGraphicsFeature(data.engine)" },
    runs: (d) => str(d.llmModel) ?? llmDefault(motionGraphicsFeature(str(d.engine))),
  }],
  "generate-3d-scene": [scene3dLever("scene3d-configs.tsx#LlmControls")],
  "edit-3d-scene": [scene3dLever("scene3d-configs.tsx#LlmControls")],
  // Choose Best's judge, under its strategy's settings: a model only for the LLM judge.
  reduce: [{
    field: "strategyConfig.llmModel",
    menu: { site: "reduce-strategy-forms.tsx#ReduceStrategyForms", llmFeature: "pick-best-llm" },
    runs: (d) => (d.strategyId === "pick-best-llm" ? (str(isRecord(d.strategyConfig) ? d.strategyConfig.llmModel : undefined) ?? llmDefault("reduce:pick-best-llm")) : undefined),
    offered: offeredLlms(),
    put: (d, model) => ({ ...d, strategyConfig: { ...(isRecord(d.strategyConfig) ? d.strategyConfig : {}), llmModel: model } }),
  }],
  "instagram-scrape": [analysisLever("instagram-configs.tsx#InstagramConfigTab")],
  "meta-ads-scrape": [analysisLever("meta-ads-configs.tsx#MetaAdsScrapeConfigTab")],
}

export interface NewNodeModelPlan {
  /** The node's data, on offered models — the very object passed in when nothing moved. */
  readonly data: Record<string, unknown>
  /** Each model moved: the field, the withheld model and the menu's first offered row. */
  readonly moved: readonly { readonly field: string; readonly from: string; readonly to: string }[]
  /** Each withheld model left as it is because its menu offers nothing. */
  readonly nothingOffered: readonly { readonly field: string; readonly model: string }[]
}

/**
 * The data a node made from `data` (its default data) starts with on this
 * deployment: every lever whose model is withheld put on the first row its
 * menu offers. Where models are not restricted, or nothing the node runs is
 * withheld, it returns `data` itself.
 */
export function planNewNodeModels(type: string, data: Record<string, unknown>): NewNodeModelPlan {
  const levers = Object.hasOwn(NEW_NODE_MODEL_LEVERS, type) ? NEW_NODE_MODEL_LEVERS[type]! : []
  if (levers.length === 0 || !modelRestrictionActive()) return { data, moved: [], nothingOffered: [] }
  let next: Record<string, unknown> = data
  const moved: { field: string; from: string; to: string }[] = []
  const nothingOffered: { field: string; model: string }[] = []
  for (const lever of levers) {
    const model = lever.runs(next)
    if (model === undefined || !isModelUnavailable(model)) continue
    const first = lever.offered(next)[0]
    if (first === undefined) {
      nothingOffered.push({ field: lever.field, model })
      continue
    }
    next = lever.put(next, first)
    moved.push({ field: lever.field, from: model, to: first })
  }
  return { data: moved.length > 0 ? next : data, moved, nothingOffered }
}

/** `planNewNodeModels`' data: the node's default data on models the deployment offers. */
export function withOfferedNewNodeModels<T extends Record<string, unknown>>(type: string, data: T): T {
  return planNewNodeModels(type, data).data as T
}

// ── Before the availability answer lands ─────────────────────────────────────

/**
 * Availability is fetched after the first paint. Before it lands only the
 * static profile's `models.deny` is known, so a node made in that window is
 * judged against that alone, and noted here with the models it runs. When the
 * answer lands, the noted nodes go once to the store's handler
 * (`onNewNodesAvailabilityLanded`), which judges each again as it would have
 * been judged at creation — only a node still on the canvas whose models are
 * still the ones it was made with (anything the user picked since stays). If
 * the answer never lands (offline, the fetch failed), nothing is re-judged.
 */
export type NewNodesAwaitingAvailability = ReadonlyMap<string, { readonly type: string; readonly models: readonly (string | undefined)[] }>

const awaiting = new Map<string, { readonly type: string; readonly models: readonly (string | undefined)[] }>()
let landed: ((nodes: NewNodesAwaitingAvailability) => void) | null = null
let unsubscribe: (() => void) | null = null

/** The models a node of `type` runs, lever by lever — what "made like this" is compared on. */
export function newNodeModelsOf(type: string, data: Data): readonly (string | undefined)[] {
  const levers = Object.hasOwn(NEW_NODE_MODEL_LEVERS, type) ? NEW_NODE_MODEL_LEVERS[type]! : []
  return levers.map((lever) => lever.runs(data))
}

/** The store's handler for the noted nodes once availability lands (one handler; the last set wins). */
export function onNewNodesAvailabilityLanded(handler: (nodes: NewNodesAwaitingAvailability) => void): void {
  landed = handler
}

function stopWatching(): void {
  unsubscribe?.()
  unsubscribe = null
}

function availabilityChanged(): void {
  if (!surfaceAvailabilityLoaded() || awaiting.size === 0) return
  const taken: NewNodesAwaitingAvailability = new Map(awaiting)
  awaiting.clear()
  stopWatching()
  landed?.(taken)
}

/**
 * Note nodes just made from their default data (`data`: what the defaults gave
 * them, before any data a caller passed of its own), so they are judged again
 * once availability lands. A no-op once it has landed. The subscription is
 * taken on the first note and dropped when the answer is handed over.
 */
export function noteNewNodesFromDefaults(nodes: readonly { readonly id: string; readonly type: string; readonly data: Data }[]): void {
  // Only a node with a model lever can move; nothing else asks availability at all.
  const movable = nodes.filter((node) => Object.hasOwn(NEW_NODE_MODEL_LEVERS, node.type))
  if (movable.length === 0 || surfaceAvailabilityLoaded()) return
  for (const node of movable) awaiting.set(node.id, { type: node.type, models: newNodeModelsOf(node.type, node.data) })
  if (!unsubscribe) unsubscribe = subscribeSurfaceAvailability(availabilityChanged)
}

/** Drop every note — another workflow was loaded, whose node ids mean other nodes. */
export function forgetNewNodesAwaitingAvailability(): void {
  awaiting.clear()
  stopWatching()
}
