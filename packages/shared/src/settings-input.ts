import { IMAGE_MODEL_ROLE_DEFAULTS } from "./image-model-roles.js"
/**
 * The "Settings" input: ONE input handle on a generation node that takes the
 * Generation Settings nodes. Aspect Ratio, Duration and Provider set the
 * consumer's own field; Motion adds a clause to its prompt. The editor shows it
 * as a single pip, with the connected values listed inside the node.
 *
 * Every reader goes through this module, so they cannot disagree about what a
 * node runs with: both run engines (their field-mapping wrappers ask
 * `settingsSourceForField` which wired node sets a field, then
 * `applySettingsInput` fits the values to the model), and the readers that
 * run before any resolver — the workflow estimate, the node's chips and its
 * settings panel — through `resolveWiredSettings`. A new setting or consumer
 * is one row here.
 */

import { MODEL_CATALOG, fitAspectRatioToModel } from "./model-catalog.js"
import { DEFAULT_VIDEO_PROVIDER, GVP_DEFAULT_PROVIDER, GVP_SUPPORTED_PROVIDERS, IMAGE_GEN_PROVIDERS, VIDEO_GEN_PROVIDERS } from "./model-constants.js"
import { getParameterValue } from "./parameter-node-value.js"
import { isAutoVideoDuration } from "./video-duration-auto.js"

/** The handle id of the Settings input. */
export const SETTINGS_INPUT_HANDLE = "settings"

/** A Generation Settings node type → the consumer data field it sets. */
export const SETTINGS_SOURCE_FIELDS = {
  "aspect-ratio": "aspectRatio",
  duration: "duration",
  provider: "provider",
} as const

/**
 * Generation Settings nodes a Settings input takes as a prompt CLAUSE rather
 * than a field: Motion (how much the shot moves). Each engine's hint collector
 * adds its clause beside the Look family's, under the same Inject Look switch
 * (`isSettingsHintEdge`).
 */
export const SETTINGS_HINT_SOURCES = ["motion"] as const

export type SettingsFieldSourceType = keyof typeof SETTINGS_SOURCE_FIELDS
export type SettingsHintSourceType = (typeof SETTINGS_HINT_SOURCES)[number]
export type SettingsSourceType = SettingsFieldSourceType | SettingsHintSourceType
export type SettingsField = (typeof SETTINGS_SOURCE_FIELDS)[SettingsFieldSourceType]

/** Every Generation Settings node type a Settings input can take. */
export const SETTINGS_SOURCE_TYPES: readonly SettingsSourceType[] = [
  ...(Object.keys(SETTINGS_SOURCE_FIELDS) as SettingsFieldSourceType[]),
  ...SETTINGS_HINT_SOURCES,
]

/** The consumer field a setting sets; none for a prompt-clause setting. */
function fieldOf(sourceType: SettingsSourceType): SettingsField | undefined {
  return Object.prototype.hasOwnProperty.call(SETTINGS_SOURCE_FIELDS, sourceType)
    ? SETTINGS_SOURCE_FIELDS[sourceType as SettingsFieldSourceType]
    : undefined
}

/**
 * A node with a Settings input:
 * - `accepts`: the settings it takes, in the order its chips show them;
 * - `models`: the models a wired Provider may name — a Provider node can hold
 *   any category's model, and this node runs only these;
 * - `defaultModel`: the model it renders with when its data names none;
 * - `duration` (when it takes one): how it takes a wired Duration. "model"
 *   fits the length to one the model renders (a Duration node holds a
 *   script's length, 60 s by default, while one clip is 4–30 s). "total"
 *   keeps it: Generate Video Pro stitches segments to reach the requested
 *   total, and its engine clamps that total to the range the model's segment
 *   lengths allow;
 * - `modelList`: the field holding the node's several models, when it can run
 *   more than one per run (Generate Image's `providers`, one image each). A
 *   wired Provider sets THE model, so the list becomes that one model.
 *
 * A wired Aspect Ratio is fitted to the model by `fitAspectRatioToModel`, the
 * rule the video lane's normalizer applies (and a still-valid ratio passes
 * every later normalizer unchanged), so the node shows the ratio it runs with.
 */
interface SettingsConsumer {
  readonly accepts: readonly SettingsSourceType[]
  readonly models: readonly string[]
  readonly defaultModel: string
  readonly duration?: "model" | "total"
  readonly modelList?: string
}

// Motion is a video-only clause (VIDEO_ONLY_PARAMETER_NODE_TYPES).
const VIDEO_SETTINGS: readonly SettingsSourceType[] = ["aspect-ratio", "duration", "provider", "motion"]

const SETTINGS_CONSUMERS: Readonly<Record<string, SettingsConsumer>> = {
  "generate-video": {
    accepts: VIDEO_SETTINGS,
    models: VIDEO_GEN_PROVIDERS,
    defaultModel: DEFAULT_VIDEO_PROVIDER,
    duration: "model",
  },
  // Generate Video Pro has Generate Video's handles by construction
  // (generate-video-pro-handles.ts re-exports them), so it takes the same
  // settings; its own models and its own duration rule.
  "generate-video-pro": {
    accepts: VIDEO_SETTINGS,
    models: GVP_SUPPORTED_PROVIDERS,
    defaultModel: GVP_DEFAULT_PROVIDER,
    duration: "total",
  },
  // A still image has no length, so no Duration.
  "generate-image": {
    accepts: ["aspect-ratio", "provider"],
    models: IMAGE_GEN_PROVIDERS,
    // The node's own default (NODE_DEFINITIONS) — only used to fit a wired
    // ratio when the node names no model.
    defaultModel: IMAGE_MODEL_ROLE_DEFAULTS.general,
    modelList: "providers",
  },
}

/** The consumers that have a Settings input, and the settings each accepts. */
export const SETTINGS_INPUT_CONSUMERS: Readonly<Record<string, readonly SettingsSourceType[]>> = Object.fromEntries(
  Object.entries(SETTINGS_CONSUMERS).map(([type, consumer]) => [type, consumer.accepts]),
)

export function isSettingsSourceType(type: string | undefined | null): type is SettingsSourceType {
  return typeof type === "string" && (SETTINGS_SOURCE_TYPES as readonly string[]).includes(type)
}

/** Whether a Generation Settings node adds a prompt clause rather than setting a field. */
export function isSettingsHintSource(type: string | undefined | null): type is SettingsHintSourceType {
  return typeof type === "string" && (SETTINGS_HINT_SOURCES as readonly string[]).includes(type)
}

/** Whether `consumerType`'s Settings input takes a `sourceType` node. */
export function settingsInputAccepts(consumerType: string, sourceType: string): boolean {
  return (SETTINGS_INPUT_CONSUMERS[consumerType] ?? []).some((t) => t === sourceType)
}

/** The consumer fields a Settings input can set, for `NODE_MAPPABLE_FIELDS`. */
export function settingsInputFields(consumerType: string): SettingsField[] {
  return (SETTINGS_INPUT_CONSUMERS[consumerType] ?? []).flatMap((t) => {
    const field = fieldOf(t)
    return field ? [field] : []
  })
}

/** The models a wired Provider may name on `consumerType` (empty for a non-consumer). */
export function settingsProviderModels(consumerType: string): readonly string[] {
  return SETTINGS_CONSUMERS[consumerType]?.models ?? []
}

interface SettingsEdge {
  readonly source: string
  readonly target: string
  readonly targetHandle?: string | null
}

/**
 * The `sourceType` node wired into `consumerId`'s Settings input, or
 * undefined. When two nodes of one kind are wired, the LAST edge wins — the
 * same rule as every other single-value input.
 */
export function settingsSourceForType(
  consumerId: string,
  consumerType: string,
  sourceType: SettingsSourceType,
  edges: ReadonlyArray<SettingsEdge>,
  typeOf: (nodeId: string) => string | undefined | null,
): string | undefined {
  if (!settingsInputAccepts(consumerType, sourceType)) return undefined
  let found: string | undefined
  for (const edge of edges) {
    if (edge.target !== consumerId || edge.targetHandle !== SETTINGS_INPUT_HANDLE) continue
    if (typeOf(edge.source) === sourceType) found = edge.source
  }
  return found
}

/** The node wired into `consumerId`'s Settings input that sets `field`, or undefined (last edge wins). */
export function settingsSourceForField(
  consumerId: string,
  consumerType: string,
  field: string,
  edges: ReadonlyArray<SettingsEdge>,
  typeOf: (nodeId: string) => string | undefined | null,
): string | undefined {
  const sourceType = (SETTINGS_INPUT_CONSUMERS[consumerType] ?? []).find((t) => fieldOf(t) === field)
  return sourceType ? settingsSourceForType(consumerId, consumerType, sourceType, edges, typeOf) : undefined
}

/**
 * Whether `edge` brings a prompt-clause setting (Motion) into its target's
 * Settings input and is the one of its kind that applies (the last edge). The
 * hint collectors of both engines ask this, so the clause a run gets is the
 * one the node's chips show.
 */
export function isSettingsHintEdge(
  edge: SettingsEdge,
  consumerType: string,
  edges: ReadonlyArray<SettingsEdge>,
  typeOf: (nodeId: string) => string | undefined | null,
): boolean {
  if (edge.targetHandle !== SETTINGS_INPUT_HANDLE) return false
  const sourceType = typeOf(edge.source)
  if (!isSettingsHintSource(sourceType)) return false
  return settingsSourceForType(edge.target, consumerType, sourceType, edges, typeOf) === edge.source
}

/**
 * Every setting wired into `consumerId`'s Settings input, one per kind (the
 * last edge of a kind wins), in the order of `SETTINGS_INPUT_CONSUMERS`.
 */
export function connectedSettingsSources(
  consumerId: string,
  consumerType: string,
  edges: ReadonlyArray<SettingsEdge>,
  typeOf: (nodeId: string) => string | undefined | null,
): Array<{ sourceType: SettingsSourceType; field?: SettingsField; sourceId: string }> {
  const out: Array<{ sourceType: SettingsSourceType; field?: SettingsField; sourceId: string }> = []
  for (const sourceType of SETTINGS_INPUT_CONSUMERS[consumerType] ?? []) {
    const sourceId = settingsSourceForType(consumerId, consumerType, sourceType, edges, typeOf)
    if (!sourceId) continue
    const field = fieldOf(sourceType)
    out.push(field ? { sourceType, field, sourceId } : { sourceType, sourceId })
  }
  return out
}

/**
 * `seconds` as `model` renders it: the nearest duration the catalog lists for
 * the model, a tie going to the shorter one — the rule the provider layer
 * applies when it renders (`snapToAllowedDuration`, KIE), so the length the
 * run is priced at is the length it renders. Not `normalizeModelInput`'s
 * duration snap, which replaces an invalid value with the model's FIRST
 * length: right for a typo, wrong for a wired length (a 60 s Duration would
 * become the model's shortest clip instead of its longest). A model without a
 * duration list, and the "auto" duration, keep the value.
 */
export function snapToModelDuration(model: string, seconds: number): number {
  const durations = MODEL_CATALOG[model]?.durations
  if (!durations || durations.length === 0 || isAutoVideoDuration(seconds)) return seconds
  let best = durations[0]!
  for (const d of durations) {
    const closer = Math.abs(d - seconds) < Math.abs(best - seconds)
    const tieShorter = Math.abs(d - seconds) === Math.abs(best - seconds) && d < best
    if (closer || tieShorter) best = d
  }
  return best
}

export type SettingsInputProblem = { readonly kind: "provider-not-accepted"; readonly sourceId: string; readonly value: string }

/**
 * The consumer's data once its Settings input has been read (after the field
 * mapping resolver wrote each wired value into its field):
 * - a wired Provider must name a model this consumer runs: a Provider node set
 *   to an image model cannot drive Generate Video, and the run refuses with
 *   `problem` rather than sending an image model to the video provider;
 * - a wired Provider on a node that runs several models per run replaces the
 *   list with its one model (see `SettingsConsumer.modelList`);
 * - a wired Duration is fitted to the model (see `SettingsConsumer.duration`);
 * - a wired Aspect Ratio is fitted to the model (`fitAspectRatioToModel`).
 */
export function applySettingsInput(
  consumerType: string,
  consumerId: string,
  data: Readonly<Record<string, unknown>>,
  edges: ReadonlyArray<SettingsEdge>,
  typeOf: (nodeId: string) => string | undefined | null,
): { data: Record<string, unknown>; problem?: SettingsInputProblem } {
  const consumer = SETTINGS_CONSUMERS[consumerType]
  const connected = connectedSettingsSources(consumerId, consumerType, edges, typeOf)
  if (!consumer || connected.length === 0) return { data: { ...data } }
  let next: Record<string, unknown> = { ...data }

  const providerSource = connected.find((c) => c.sourceType === "provider")
  if (providerSource) {
    const value = typeof next.provider === "string" ? next.provider : ""
    if (!consumer.models.includes(value)) {
      return { data: next, problem: { kind: "provider-not-accepted", sourceId: providerSource.sourceId, value } }
    }
    if (consumer.modelList) next = { ...next, [consumer.modelList]: [value] }
  }

  const model = (typeof next.provider === "string" && next.provider) || consumer.defaultModel
  if (consumer.duration === "model" && connected.some((c) => c.sourceType === "duration")) {
    const raw = next.duration
    const seconds = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN
    if (Number.isFinite(seconds)) next = { ...next, duration: snapToModelDuration(model, seconds) }
  }
  if (connected.some((c) => c.sourceType === "aspect-ratio") && typeof next.aspectRatio === "string") {
    next = { ...next, aspectRatio: fitAspectRatioToModel(model, next.aspectRatio) }
  }
  return { data: next }
}

interface SettingsGraphNode {
  readonly id: string
  readonly type?: string | null
  readonly data?: unknown
}

/** One setting wired into a node's Settings input. */
export interface WiredSetting {
  readonly sourceType: SettingsSourceType
  /** The field it sets; none for a prompt-clause setting (Motion). */
  readonly field?: SettingsField
  readonly sourceId: string
  /** The value the wired node holds, read the way the run engines read it. */
  readonly value: string | undefined
}

/**
 * What `consumerId` runs with once its Settings input is read: its data with
 * each wired setting written into its field and fitted to the model — the
 * steps the run engines take (field-mapping resolver, then
 * `applySettingsInput`), for the readers that run before any resolver: the
 * workflow estimate, the node's chips and its settings panel.
 */
export function resolveWiredSettings(
  consumerId: string,
  consumerType: string,
  data: Readonly<Record<string, unknown>>,
  nodes: ReadonlyArray<SettingsGraphNode>,
  edges: ReadonlyArray<SettingsEdge>,
): { data: Record<string, unknown>; wired: WiredSetting[]; problem?: SettingsInputProblem } {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const typeOf = (id: string) => byId.get(id)?.type
  const wired: WiredSetting[] = connectedSettingsSources(consumerId, consumerType, edges, typeOf).map((c) => ({
    ...c,
    value: getParameterValue((byId.get(c.sourceId)?.data ?? {}) as Record<string, unknown>, c.sourceType),
  }))
  if (wired.length === 0) return { data: { ...data }, wired }
  let next: Record<string, unknown> = { ...data }
  for (const w of wired) {
    if (w.field && w.value != null) next = { ...next, [w.field]: w.value }
  }
  const applied = applySettingsInput(consumerType, consumerId, next, edges, typeOf)
  return applied.problem ? { data: applied.data, wired, problem: applied.problem } : { data: applied.data, wired }
}

interface SettingsNodeLike {
  readonly id?: string
  readonly type?: string | null
  readonly data?: unknown
}

interface SettingsEdgeLike {
  readonly source?: string
  readonly target: string
  readonly targetHandle?: string | null
}

/**
 * `node` as it runs, for the readers that plan or price a run before any
 * resolver: the workflow estimates, the Run price, and the fan-out plan (a
 * wired Provider turns a several-model image run into one). A node with no
 * Settings input — or a caller without the graph — gets `node` back as is.
 */
export function withWiredSettings<T extends SettingsNodeLike>(
  node: T,
  nodes?: ReadonlyArray<SettingsNodeLike>,
  edges?: ReadonlyArray<SettingsEdgeLike>,
): T {
  const type = node.type ?? ""
  if (!nodes || !edges || !node.id || !SETTINGS_CONSUMERS[type]) return node
  const graphNodes = nodes.flatMap((n) => (n.id ? [{ id: n.id, type: n.type, data: n.data }] : []))
  const graphEdges = edges.map((e) => ({ source: e.source ?? "", target: e.target, targetHandle: e.targetHandle }))
  const { data } = resolveWiredSettings(node.id, type, (node.data ?? {}) as Record<string, unknown>, graphNodes, graphEdges)
  return { ...node, data }
}
