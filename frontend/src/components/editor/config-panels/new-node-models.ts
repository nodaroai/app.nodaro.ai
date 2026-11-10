/**
 * A new node starts on a model the deployment offers (decided 2026-11-10).
 *
 * The model menus hide what a deployment withholds but keep the model a node
 * holds, so on a deployment whose list lacks a node's default a fresh node used
 * to be refused on its first run. Now, when the editor makes a node from its
 * default data (or resets one to its defaults) and a model the node would run
 * is withheld, the node starts on the FIRST row its own menu offers that the
 * user can run — the same registry, filter and order the panel renders, so the
 * menu shows the chosen model as its first row. A row the account's
 * free-credit video limits lock (the menu marks it) is skipped; when every
 * offered row is locked, the first offered row is taken, as before.
 *
 *  - Only where the deployment RESTRICTS models (`modelRestrictionActive`).
 *    A deployment that restricts nothing keeps every default exactly as it is,
 *    even one whose default an admin switched off.
 *  - Only at creation (and a reset), never at run: a saved node keeps its
 *    model, still shown and refused at run; a copy, paste or duplicate keeps
 *    the source's.
 *  - A menu that offers nothing leaves the default as it is.
 *
 * The rule and its table are `@nodaro/render-rules` (`node-model-levers.ts`),
 * which the server runs too on the nodes it creates, over the same menu rows.
 * This adds what only the editor has: which panel renders each lever's menu
 * (pinned by `__tests__/new-node-models-census.test.ts`, which also fails a
 * node type that carries a model in its defaults or renders a model menu and
 * is neither here nor exempt there with a reason), and Generate Video's own
 * fail-safe patch when its model moves.
 */
import {
  NODE_MODEL_LEVERS,
  offeredLeverRows,
  planNodeModels,
  type NodeModelJudge,
  type NodeModelLever,
} from "@nodaro/render-rules"
import { generateVideoProviderSnap } from "@/lib/generate-video-provider-snap"
import { mergeNodeData } from "@/lib/node-data-merge"
import { cachedFreeVideoLimits, lockedVideoModel } from "@/lib/free-video-locks"
import { isModelUnavailable, modelRestrictionActive, subscribeSurfaceAvailability, surfaceAvailabilityLoaded } from "@/lib/surface-availability"

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
  /** The shared lever this one renders (`@nodaro/render-rules`). */
  readonly shared: NodeModelLever
}

/** The menu each shared lever renders in the editor, lever by lever. */
const MENUS: Readonly<Record<string, readonly NewNodeModelMenu[]>> = {
  // ── Image ──
  "generate-image": [{ site: "image-configs.tsx#GenerateImageConfigImpl", registry: "IMAGE_GEN_MODELS" }],
  "modify-image": [{ site: "image-configs.tsx#ModifyImageConfigImpl", registry: "MODIFY_IMAGE_MODELS" }],
  "upscale-image": [{ site: "image-configs.tsx#UpscaleImageConfig", registry: "UPSCALE_IMAGE_MODELS" }],
  face: [{ site: "entity-configs.tsx#FaceConfig", registry: "IMAGE_GEN_MODELS" }],
  // ── Video ──
  "generate-video": [{ site: "video-configs.tsx#GenerateVideoConfigImpl", registry: "VIDEO_GEN_MODELS" }],
  "image-to-video": [{ site: "video-configs.tsx#ImageToVideoConfigImpl", registry: "VIDEO_I2V_MODELS" }],
  "text-to-video": [{ site: "video-configs.tsx#TextToVideoConfigImpl", registry: "VIDEO_T2V_MODELS" }],
  "generate-video-pro": [{ site: "video-configs.tsx#GenerateVideoProConfigImpl", registry: "GVP_PROVIDERS" }],
  "edit-video-pro": [{ site: "video-configs.tsx#EditVideoProConfigImpl", registry: "EVP_PROVIDERS" }],
  "extend-video": [{ site: "video-configs.tsx#ExtendVideoConfig", registry: "EXTEND_VIDEO_MODELS" }],
  "video-to-video": [{ site: "video-configs.tsx#VideoToVideoConfigImpl", registry: "VIDEO_V2V_MODELS" }],
  "video-depth": [{ site: "video-configs.tsx#VideoDepthConfig", registry: "VIDEO_DEPTH_MODELS" }],
  "video-mask": [{ site: "video-mask-config.tsx#VideoMaskConfig", registry: "VIDEO_MASK_PROVIDERS" }],
  "motion-transfer": [{ site: "video-configs.tsx#MotionTransferConfigImpl", registry: "MOTION_TRANSFER_MODELS" }],
  "lip-sync": [{ site: "audio-configs.tsx#LipSyncConfig", registry: "LIP_SYNC_MODELS" }],
  // The Provider parameter node: the model it hands the node it drives, from its category's list.
  provider: [{ site: "parameter-configs.tsx#ProviderConfig", registry: "PROVIDER_NODE_CATEGORIES" }],
  // ── Audio ──
  "text-to-speech": [{ site: "audio-configs.tsx#TextToSpeechConfig", registry: "TTS_MODELS" }],
  "text-to-dialogue": [{ site: "audio-configs.tsx#TextToDialogueConfig", registry: "DIALOGUE_MODELS" }],
  // ── LLM ──
  "llm-chat": [{ site: "llm-chat-config.tsx#LLMChatConfig", llmFeature: "llm-chat" }],
  "image-to-text": [{ site: "script-configs.tsx#ImageToTextConfig", llmFeature: "image-to-text" }],
  "image-critic": [{ site: "script-configs.tsx#ImageCriticConfig", llmFeature: "image-critic" }],
  "qa-check": [{ site: "script-configs.tsx#QACheckConfig", llmFeature: "qa-check" }],
  "describe-to-picker": [{ site: "script-configs.tsx#DescribeToPickerConfig", llmFeature: "describe-to-picker", filter: "describeToPickerModel" }],
  "generate-script": [{ site: "script-configs.tsx#GenerateScriptConfig", llmFeature: "generate-script" }],
  "content-recipe": [{ site: "content-configs.tsx#ContentRecipeConfig", llmFeature: "content-recipe", filter: "structuredOutputModel" }],
  "content-ideas": [{ site: "content-configs.tsx#ContentIdeasConfig", llmFeature: "content-ideas", filter: "structuredOutputModel" }],
  "video-composer": [{ site: "composition-configs.tsx#VideoComposerConfig", llmFeature: "scene-graph-ai" }],
  "after-effects": [{ site: "composition-configs.tsx#AfterEffectsConfig", llmFeature: "after-effects" }],
  "lottie-overlay": [{ site: "composition-configs.tsx#LottieOverlayConfig", llmFeature: "lottie-overlay" }],
  "3d-title": [{ site: "composition-configs.tsx#ThreeDTitleConfig", llmFeature: "3d-title" }],
  "motion-graphics": [{ site: "composition-configs.tsx#MotionGraphicsConfig", llmFeature: "motionGraphicsFeature(data.engine)" }],
  "generate-3d-scene": [{ site: "scene3d-configs.tsx#LlmControls", llmFeature: "3d-scene" }],
  "edit-3d-scene": [{ site: "scene3d-configs.tsx#LlmControls", llmFeature: "3d-scene" }],
  // Choose Best's judge, under its strategy's settings: a model only for the LLM judge.
  reduce: [{ site: "reduce-strategy-forms.tsx#ReduceStrategyForms", llmFeature: "pick-best-llm" }],
  "instagram-scrape": [{ site: "instagram-configs.tsx#InstagramConfigTab", llmFeature: "meta-ads-analysis", filter: "structuredVisionModel" }],
  "meta-ads-scrape": [{ site: "meta-ads-configs.tsx#MetaAdsScrapeConfigTab", llmFeature: "meta-ads-analysis", filter: "structuredVisionModel" }],
}

/** Where the editor puts a node on its new model differently from the shared lever. */
const PUT_IN_EDITOR: Readonly<Record<string, NewNodeModelLever["put"]>> = {
  // The same patch the node's run strip writes on a model switch.
  "generate-video": (d, model) => ({ ...d, provider: model, ...generateVideoProviderSnap(d, model, cachedFreeVideoLimits()) }),
}

/** The deployment's filter, as every model menu applies it. */
const DEPLOYMENT_FILTER = { withheld: isModelUnavailable } as const

function editorLever(type: string, shared: NodeModelLever, index: number): NewNodeModelLever {
  const menu = MENUS[type]?.[index]
  if (!menu) throw new Error(`new-node-models: the ${type} lever on "${shared.field}" names no menu (add it to MENUS)`)
  return {
    field: shared.field,
    menu,
    runs: shared.runs,
    offered: (d) => offeredLeverRows(shared, d, DEPLOYMENT_FILTER),
    put: PUT_IN_EDITOR[type] ?? shared.put,
    shared,
  }
}

/**
 * Every node type whose own menu sets a model it runs, with the levers that
 * menu edits: the shared table, each lever with the panel menu that renders it.
 * Node types whose menu is not here (an unfiltered hand-written list, a value
 * that is not a model id, no menu at all) are listed with their reason in the
 * census test.
 */
export const NEW_NODE_MODEL_LEVERS: Readonly<Record<string, readonly NewNodeModelLever[]>> = Object.fromEntries(
  Object.entries(NODE_MODEL_LEVERS).map(([type, levers]) => [type, levers.map((lever, i) => editorLever(type, lever, i))]),
)

/**
 * How this deployment, and the signed-in user, judge a model as the editor's
 * menus show it. The account's free-credit video limits are read only when a
 * lock is asked about — on a deployment that restricts nothing, never.
 */
function editorJudge(): NodeModelJudge {
  let limits: ReturnType<typeof cachedFreeVideoLimits> | undefined
  return {
    restricted: modelRestrictionActive(),
    withheld: isModelUnavailable,
    locked: (model: string) => {
      limits ??= cachedFreeVideoLimits()
      return limits !== null && lockedVideoModel(limits, model) !== null
    },
  }
}

export interface NewNodeModelPlan {
  /** The node's data, on offered models — the very object passed in when nothing moved. */
  readonly data: Record<string, unknown>
  /** Each model moved: the field, the withheld model and the menu's first offered row the user can run. */
  readonly moved: readonly { readonly field: string; readonly from: string; readonly to: string }[]
  /** Each withheld model left as it is because its menu offers nothing. */
  readonly nothingOffered: readonly { readonly field: string; readonly model: string }[]
}

/**
 * The data a node made from `data` (its default data) starts with on this
 * deployment: every lever whose model is withheld put on the first row its
 * menu offers that the user can run. Where models are not restricted, or
 * nothing the node runs is withheld, it returns `data` itself.
 */
export function planNewNodeModels(type: string, data: Record<string, unknown>): NewNodeModelPlan {
  const levers = Object.hasOwn(NEW_NODE_MODEL_LEVERS, type) ? NEW_NODE_MODEL_LEVERS[type]! : []
  if (levers.length === 0 || !modelRestrictionActive()) return { data, moved: [], nothingOffered: [] }
  return planNodeModels(levers.map((lever) => ({ ...lever.shared, put: lever.put })), data, editorJudge())
}

/** `planNewNodeModels`' data: the node's default data on models the deployment offers. */
export function withOfferedNewNodeModels<T extends Record<string, unknown>>(type: string, data: T): T {
  return planNewNodeModels(type, data).data as T
}

/**
 * The patch that resets a node to its defaults (`reset`, merged over the
 * node's `current` data by the store) on models the deployment offers: the
 * same rule as a new node, judged on the data the reset leaves, with each
 * model it moves added to the patch. The very `reset` object when nothing
 * moves.
 */
export function withOfferedResetModels(type: string, current: Data, reset: Record<string, unknown>): Record<string, unknown> {
  // The data the node holds once the store merges the reset in (the one merge, lib/node-data-merge.ts).
  const merged: Record<string, unknown> = mergeNodeData({ ...current }, reset)
  for (const [key, value] of Object.entries(reset)) if (value === undefined) delete merged[key]
  const planned = planNewNodeModels(type, merged)
  if (planned.moved.length === 0) return reset
  const patch: Record<string, unknown> = { ...reset }
  for (const [key, value] of Object.entries(planned.data)) if (!Object.is(merged[key], value)) patch[key] = value
  // A field the move dropped is cleared, as the reset clears one.
  for (const key of Object.keys(merged)) if (!Object.hasOwn(planned.data, key)) patch[key] = undefined
  return patch
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
