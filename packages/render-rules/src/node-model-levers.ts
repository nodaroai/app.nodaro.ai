/**
 * A new node starts on a model the deployment offers (decided 2026-11-10) —
 * the rule both the editor and the server run, over one table.
 *
 * Where a deployment RESTRICTS models, a node made from its defaults whose
 * default model is withheld starts on the first row its own model menu offers:
 * the same rows (`model-menus.ts`), the same order, the same filter. Of those
 * rows the first one the USER can run is taken — on a menu that marks the rows
 * the account's free-credit video limits lock (`marksLocks`), a locked row is
 * skipped — and when every offered row is locked, the first offered row, as
 * before. A menu that offers nothing leaves the default as it is.
 *
 * The editor applies it to the nodes it makes from their default data (and to
 * a node reset to its defaults); the server to the nodes it creates (MCP
 * workflow writes, Copilot edits, template instantiation), where only a lever
 * whose model the node does not name is judged — a model the writer named is
 * kept, as a saved node keeps its model.
 *
 * Each lever names the field its menu writes, the rows its menu lists, the
 * model the field makes the node run (the stored value, else the default it
 * runs with none) and how the node is put on a row.
 */
import { IMAGE_MODEL_ROLE_DEFAULTS, defaultImageModelForNode } from "@nodaro/shared/model-catalog"
import {
  DEFAULT_TTS_PROVIDER,
  DEFAULT_VIDEO_PROVIDER,
  DEFAULT_VIDEO_TO_VIDEO_PROVIDER,
  GVP_DEFAULT_PROVIDER,
  deriveLinkedFields,
  dialogueProviderOf,
} from "@nodaro/shared/models"
import { VIDEO_MASK_PROVIDERS, resolveVideoDepthProvider, resolveVideoMaskProvider } from "@nodaro/shared/media"
import { normalizeNodeModelParams } from "@nodaro/shared/nodes"
import { SCENE3D_BASIC_ENGINE } from "@nodaro/shared/scene3d"
import { LLM_MODELS, motionGraphicsFeature, orderedLlmModels, resolveScriptModelId, type LlmModelDef } from "@nodaro/shared/llm-models"
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
  VIDEO_GEN_MODELS,
  VIDEO_I2V_MODELS,
  VIDEO_T2V_MODELS,
  VIDEO_V2V_MODELS,
} from "./model-menus"
import { describeToPickerModel, structuredOutputModel, structuredVisionModel } from "./llm-model-filters"
import { PROVIDER_NODE_CATEGORY_MODELS, validProviderSelection } from "./provider-node-categories"
import { llmFeatureDefaultModel, motionTransferModelOf } from "./provider-model"
import { EDIT_IMAGE_DEFAULT_PROVIDER, EXTEND_VIDEO_DEFAULT_PROVIDER, LIP_SYNC_DEFAULT_PROVIDER, MOTION_TRANSFER_DEFAULT_PROVIDER } from "./node-default-models"

type Data = Readonly<Record<string, unknown>>

export interface NodeModelLever {
  /** The data field the menu writes (`a.b`: `b` inside the object field `a`). */
  readonly field: string
  /** The values the menu lists for this data, in the order it renders them, before the deployment's filter. */
  readonly rows: (d: Data) => readonly string[]
  /**
   * The model a row makes the node run, in a restriction's vocabulary, or null
   * when it runs no catalog model. Absent: every row is the model's own id.
   */
  readonly rowModel?: (row: string, d: Data) => string | null
  /**
   * The model this field makes the node run: the stored value's, else the
   * default the node runs with none. Undefined when the field runs no model as
   * the data stands (an engine that runs none, analysis switched off).
   */
  readonly runs: (d: Data) => string | undefined
  /** Whether the data names this lever's model; false: the node runs its default. */
  readonly named: (d: Data) => boolean
  /**
   * Its menu marks the rows the account cannot run (the free-credit video
   * limits lock them, greyed with the reason), so the rule skips those rows.
   * The editor's census holds this to the menus that render the mark.
   */
  readonly marksLocks?: boolean
  /** The data with the node on `row` (a menu value). */
  readonly put: (d: Data, row: string) => Record<string, unknown>
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v)
const values = (registry: readonly { readonly value: string }[]): readonly string[] => registry.map((m) => m.value)

const putField = (field: string) => (d: Data, row: string): Record<string, unknown> => ({ ...d, [field]: row })
const namesField = (field: string) => (d: Data): boolean => str(d[field]) !== undefined

/** The node's settings follow the new model through the catalog normalizer, as a write boundary heals them. */
const fitCatalogSettings = (type: string) => (d: Data, model: string): Record<string, unknown> => {
  const next = { ...d, provider: model }
  return normalizeNodeModelParams([{ id: "new-node", type, data: next }]).nodes[0]!.data as Record<string, unknown>
}

/** A `provider` menu over a registry; `fallback` is the default a node naming none runs. */
function providerLever(registry: readonly { readonly value: string }[], fallback?: (d: Data) => string | undefined): NodeModelLever {
  return {
    field: "provider",
    rows: () => values(registry),
    runs: (d) => str(d.provider) ?? fallback?.(d),
    named: namesField("provider"),
    put: putField("provider"),
  }
}

/** An `LlmModelSelect`: its filter, then the vendor-and-tier order it renders. */
const llmRows = (filter?: (m: LlmModelDef) => boolean) => (): readonly string[] =>
  orderedLlmModels(filter ? LLM_MODELS.filter(filter) : LLM_MODELS).map((m) => m.id)

/** An `llmModel` menu (`LlmModelSelect`) whose unset value runs the feature's default. */
function llmLever(feature: string, filter?: (m: LlmModelDef) => boolean): NodeModelLever {
  return {
    field: "llmModel",
    rows: llmRows(filter),
    runs: (d) => str(d.llmModel) ?? llmFeatureDefaultModel(feature),
    named: namesField("llmModel"),
    put: putField("llmModel"),
  }
}

/** A scrape's ad analysis: it runs a model only while analysis is on. */
const analysisLever: NodeModelLever = {
  field: "analysisModel",
  rows: llmRows(structuredVisionModel),
  runs: (d) => (d.analyze === true ? (str(d.analysisModel) ?? llmFeatureDefaultModel("meta-ads-analysis")) : undefined),
  named: namesField("analysisModel"),
  put: putField("analysisModel"),
}

/** A 3D scene's planner: the basic engine plans with an LLM; another engine (or an edit's operations) runs none. */
const scene3dLever: NodeModelLever = {
  ...llmLever("3d-scene"),
  runs: (d) => {
    if (Array.isArray(d.operations)) return undefined
    const engine = str(d.engine)
    return engine === undefined || engine === SCENE3D_BASIC_ENGINE ? (str(d.llmModel) ?? llmFeatureDefaultModel("3d-scene")) : undefined
  },
}

/**
 * Every node type whose own menu sets a model it runs, with the levers that
 * menu edits. The editor's census (`new-node-models-census.test.ts`) holds each
 * lever to the panel menu that renders it, and every other model a node's
 * defaults carry or a panel's menu lists to a reason.
 */
export const NODE_MODEL_LEVERS: Readonly<Record<string, readonly NodeModelLever[]>> = {
  // ── Image ──
  "generate-image": [{
    field: "provider",
    rows: () => values(IMAGE_GEN_MODELS),
    // The panel's list is `providers` (else `[provider]`); its first entry is the model `provider` mirrors.
    runs: (d) => (Array.isArray(d.providers) ? str(d.providers[0]) : undefined) ?? str(d.provider) ?? defaultImageModelForNode("generate-image", str(d.aspectRatio)),
    named: (d) => (Array.isArray(d.providers) && str(d.providers[0]) !== undefined) || str(d.provider) !== undefined,
    put: (d, model) => {
      const fitted = fitCatalogSettings("generate-image")(d, model)
      // The `model` an admin default links to its provider follows the new provider, as that layer derives it.
      const linked = d.model !== undefined ? { model: deriveLinkedFields("generate-image", model).model } : {}
      return Array.isArray(d.providers) && d.providers.length > 0
        ? { ...fitted, ...linked, providers: [model, ...d.providers.slice(1).filter((p) => p !== model)] }
        : { ...fitted, ...linked }
    },
  }],
  "modify-image": [{
    ...providerLever(MODIFY_IMAGE_MODELS, (d) => defaultImageModelForNode("modify-image", str(d.aspectRatio))),
    put: fitCatalogSettings("modify-image"),
  }],
  "upscale-image": [providerLever(UPSCALE_IMAGE_MODELS, () => EDIT_IMAGE_DEFAULT_PROVIDER)],
  face: [providerLever(IMAGE_GEN_MODELS, () => IMAGE_MODEL_ROLE_DEFAULTS.character)],
  // ── Video ──
  "generate-video": [{
    ...providerLever(VIDEO_GEN_MODELS, () => DEFAULT_VIDEO_PROVIDER),
    put: fitCatalogSettings("generate-video"),
    marksLocks: true,
  }],
  // The legacy single-mode nodes (no longer creatable): their default differs
  // by lane, so one that names no model is not judged here.
  "image-to-video": [{ ...providerLever(VIDEO_I2V_MODELS), marksLocks: true }],
  "text-to-video": [{ ...providerLever(VIDEO_T2V_MODELS), marksLocks: true }],
  "generate-video-pro": [providerLever(GVP_PROVIDERS, () => GVP_DEFAULT_PROVIDER)],
  "edit-video-pro": [providerLever(EVP_PROVIDERS, () => GVP_DEFAULT_PROVIDER)],
  "extend-video": [{ ...providerLever(EXTEND_VIDEO_MODELS, () => EXTEND_VIDEO_DEFAULT_PROVIDER), marksLocks: true }],
  "video-to-video": [providerLever(VIDEO_V2V_MODELS, () => DEFAULT_VIDEO_TO_VIDEO_PROVIDER)],
  "video-depth": [{
    ...providerLever(VIDEO_DEPTH_MODELS),
    runs: (d) => resolveVideoDepthProvider(d.provider),
  }],
  "video-mask": [{
    field: "provider",
    rows: () => VIDEO_MASK_PROVIDERS,
    runs: (d) => resolveVideoMaskProvider(d.provider),
    named: namesField("provider"),
    put: putField("provider"),
  }],
  // Motion Transfer's rows are its options (`kling`, `kling-3.0`, …), each the
  // engine of a catalog model (`provider-model.ts`).
  "motion-transfer": [{
    field: "provider",
    rows: () => values(MOTION_TRANSFER_MODELS),
    rowModel: (row) => motionTransferModelOf(row),
    runs: (d) => motionTransferModelOf(str(d.provider) ?? MOTION_TRANSFER_DEFAULT_PROVIDER),
    named: namesField("provider"),
    put: putField("provider"),
  }],
  "lip-sync": [providerLever(LIP_SYNC_MODELS, () => LIP_SYNC_DEFAULT_PROVIDER)],
  // The Provider parameter node: the model it hands the node it drives, from its category's list.
  provider: [{
    field: "provider",
    rows: (d) => values(PROVIDER_NODE_CATEGORY_MODELS[validProviderSelection(d).category].models),
    runs: (d) => validProviderSelection(d).provider,
    named: namesField("provider"),
    put: putField("provider"),
  }],
  // ── Audio ──
  "text-to-speech": [providerLever(TTS_MODELS, () => DEFAULT_TTS_PROVIDER)],
  "text-to-dialogue": [{
    ...providerLever(DIALOGUE_MODELS),
    runs: (d) => dialogueProviderOf(d.provider),
  }],
  // ── LLM ──
  "llm-chat": [llmLever("llm-chat")],
  "image-to-text": [llmLever("image-to-text")],
  "image-critic": [llmLever("image-critic")],
  "qa-check": [llmLever("qa-check")],
  "describe-to-picker": [llmLever("describe-to-picker", describeToPickerModel)],
  "generate-script": [{
    ...llmLever("generate-script"),
    // An explicit model, else the legacy script provider's, else the feature's: the model the run uses.
    runs: (d) => resolveScriptModelId(str(d.provider), str(d.llmModel)),
    named: (d) => str(d.llmModel) !== undefined || str(d.provider) !== undefined,
  }],
  "content-recipe": [llmLever("content-recipe", structuredOutputModel)],
  "content-ideas": [llmLever("content-ideas", structuredOutputModel)],
  "video-composer": [llmLever("scene-graph-ai")],
  "after-effects": [llmLever("after-effects")],
  "lottie-overlay": [llmLever("lottie-overlay")],
  "3d-title": [llmLever("3d-title")],
  "motion-graphics": [{
    ...llmLever("motion-graphics"),
    runs: (d) => str(d.llmModel) ?? llmFeatureDefaultModel(motionGraphicsFeature(str(d.engine))),
  }],
  "generate-3d-scene": [scene3dLever],
  "edit-3d-scene": [scene3dLever],
  // Choose Best's judge, under its strategy's settings: a model only for the LLM judge.
  reduce: [{
    field: "strategyConfig.llmModel",
    rows: llmRows(),
    runs: (d) => (d.strategyId === "pick-best-llm" ? (str(isRecord(d.strategyConfig) ? d.strategyConfig.llmModel : undefined) ?? llmFeatureDefaultModel("reduce:pick-best-llm")) : undefined),
    named: (d) => str(isRecord(d.strategyConfig) ? d.strategyConfig.llmModel : undefined) !== undefined,
    put: (d, model) => ({ ...d, strategyConfig: { ...(isRecord(d.strategyConfig) ? d.strategyConfig : {}), llmModel: model } }),
  }],
  "instagram-scrape": [analysisLever],
  "meta-ads-scrape": [analysisLever],
}

/** The levers of `type` (none for a type whose menus set no model it runs). */
export function nodeModelLevers(type: string): readonly NodeModelLever[] {
  return Object.hasOwn(NODE_MODEL_LEVERS, type) ? NODE_MODEL_LEVERS[type]! : []
}

/** How a deployment, and the user a node is made for, judge a model. */
export interface NodeModelJudge {
  /** Whether the deployment restricts models: where it does not, nothing moves. */
  readonly restricted: boolean
  /** Whether the deployment withholds `model` (the menus hide it). */
  readonly withheld: (model: string) => boolean
  /**
   * Whether the user cannot run `model` (the free-credit video limits) — asked
   * only on a lever whose menu marks such a row (`marksLocks`).
   */
  readonly locked?: (model: string) => boolean
}

/** A lever's row as the model it runs (null: no catalog model). */
function modelOfRow(lever: NodeModelLever, row: string, d: Data): string | null {
  return lever.rowModel ? lever.rowModel(row, d) : row
}

/** The rows a lever's menu offers on this deployment, in the order it renders them. */
export function offeredLeverRows(lever: NodeModelLever, d: Data, judge: Pick<NodeModelJudge, "withheld">): readonly string[] {
  return lever.rows(d).filter((row) => {
    const model = modelOfRow(lever, row, d)
    return model === null || !judge.withheld(model)
  })
}

export interface NodeModelPlan {
  /** The node's data, on offered models — the very object passed in when nothing moved. */
  readonly data: Record<string, unknown>
  /** Each model moved: the field, the withheld model and the row it now holds. */
  readonly moved: readonly { readonly field: string; readonly from: string; readonly to: string }[]
  /** Each withheld model left as it is because its menu offers nothing. */
  readonly nothingOffered: readonly { readonly field: string; readonly model: string }[]
}

/**
 * The data a node made from `data` starts with: every lever whose model is
 * withheld put on the first offered row the user can run (else the first
 * offered row). `onlyUnnamed` judges only the levers whose model the data does
 * not name (the server's rule for a node a writer authored). Where models are
 * not restricted, or nothing the node runs is withheld, it returns `data`
 * itself.
 */
export function planNodeModels(
  levers: readonly NodeModelLever[],
  data: Record<string, unknown>,
  judge: NodeModelJudge,
  opts: { readonly onlyUnnamed?: boolean } = {},
): NodeModelPlan {
  if (levers.length === 0 || !judge.restricted) return { data, moved: [], nothingOffered: [] }
  let next: Record<string, unknown> = data
  const moved: { field: string; from: string; to: string }[] = []
  const nothingOffered: { field: string; model: string }[] = []
  for (const lever of levers) {
    if (opts.onlyUnnamed && lever.named(next)) continue
    const model = lever.runs(next)
    if (model === undefined || !judge.withheld(model)) continue
    const offered = offeredLeverRows(lever, next, judge)
    if (offered.length === 0) {
      nothingOffered.push({ field: lever.field, model })
      continue
    }
    const runnable = judge.locked && lever.marksLocks
      ? offered.find((row) => {
          const rowModel = modelOfRow(lever, row, next)
          return rowModel === null || !judge.locked!(rowModel)
        })
      : offered[0]
    const to = runnable ?? offered[0]!
    next = lever.put(next, to)
    moved.push({ field: lever.field, from: model, to })
  }
  return { data: moved.length > 0 ? next : data, moved, nothingOffered }
}
