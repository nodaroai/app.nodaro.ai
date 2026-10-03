/**
 * Pure helpers behind the template canvas's node inspector: which fields a
 * node exposes to a reader, in which order, and which node sits under a click.
 * The canvas nodes are inert and `pointer-events: none`, so a click lands on
 * the pane and the node is found by geometry, not by DOM target.
 */

import {
  FAN_OUT_EACH_TYPES,
  PARAMETER_NODE_TYPES,
  REPEAT_PLACEHOLDER,
  VARIABLES_HANDLE_ID,
  canonicalVarName,
  decodeProviderItem,
  extractReferencedLabels,
  resolveIndex,
  resolveSeparator,
  runSelector,
  selectListItems,
  splitGeneratedItems,
  spreadJsonArrayIfSingleton,
  type HintGraphContext,
  type SelectorConfig,
  type SelectorFields,
} from "@nodaro/shared"
import { getParameterPromptHint } from "@nodaro/prompts"

export interface InspectorNode {
  readonly id: string
  readonly type?: string
  readonly data: Readonly<Record<string, unknown>>
}

export interface InspectorField {
  readonly key: string
  readonly label: string
  readonly value: string
  /** Set on a field the node RECEIVED on a wire: the label of the node it came from. */
  readonly source?: string
}

export interface InspectorEdge {
  readonly id?: string
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
  /** The wire's own item choice: `outputMode`, `itemIndex`, range / list selector. */
  readonly data?: Readonly<Record<string, unknown>>
}

export interface InspectorSetting {
  readonly label: string
  readonly value: string
}

export interface NodeRect {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Long-form text a reader wants in full, in reading order. */
const TEXT_FIELDS: ReadonlyArray<readonly [key: string, label: string]> = [
  ["prompt", "Prompt"],
  ["negativePrompt", "Negative prompt"],
  ["systemPrompt", "System prompt"],
  ["userInput", "User prompt"],
  ["text", "Text"],
  // Web Scrape: the search query, or the page address it crawled.
  ["query", "Search query"],
  ["generatedText", "Result"],
]

/** Node types whose `url` is an input the reader types (a page to crawl),
 *  not a media result — for every other node `url` is bookkeeping. */
const URL_IS_AN_INPUT = new Set(["web-scrape"])

/** A structured result (Web Scrape, video analysis) is shown as pretty JSON —
 *  it is the node's output exactly as a downstream Prompt node receives it. */
const JSON_RESULT_KEY = "generatedJson"
const JSON_RESULT_MAX = 20_000

function jsonResultText(node: InspectorNode): string | null {
  const value = node.data[JSON_RESULT_KEY]
  if (value === undefined || value === null) return null
  let text: string
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2)
  } catch {
    return null
  }
  if (!nonEmptyString(text)) return null
  return text.length > JSON_RESULT_MAX ? `${text.slice(0, JSON_RESULT_MAX)}\n…` : text
}

function jsonResultField(node: InspectorNode): InspectorField[] {
  const text = jsonResultText(node)
  return text === null ? [] : [{ key: JSON_RESULT_KEY, label: "Result", value: text }]
}

/** A structured result as the run hands it on: compact JSON (extractNodeOutput / getPrimaryOutput). */
function jsonValue(node: InspectorNode): string | null {
  const value = node.data[JSON_RESULT_KEY]
  if (value === undefined || value === null) return null
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value)
    return nonEmptyString(text) ? text : null
  } catch {
    return null
  }
}

/** A wired JSON value arrives compact; it is shown pretty-printed, like the node's own result. */
function readable(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value
  try {
    const pretty = JSON.stringify(JSON.parse(trimmed), null, 2)
    return pretty.length > JSON_RESULT_MAX ? `${pretty.slice(0, JSON_RESULT_MAX)}\n…` : pretty
  } catch {
    return value
  }
}

/**
 * Target handles that carry TEXT into a node, with the label a reader knows
 * them by. A media wire (references, frames) is not text and never listed.
 */
const WIRED_TEXT_HANDLES: Readonly<Record<string, string>> = {
  prompt: "Prompt",
  negative: "Negative prompt",
  "system-prompt": "System prompt",
  text: "Text",
}

const numbered = (items: readonly string[]): string => items.map((item, i) => `${i + 1}. ${item}`).join("\n\n")

const nonEmptyStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter(nonEmptyString) : [])

const stringValue = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)

/** Deep enough for any real plumbing chain; stops a malformed cycle. */
const MAX_DEPTH = 8

interface Graph {
  readonly byId: ReadonlyMap<string, InspectorNode>
  readonly incoming: ReadonlyMap<string, readonly InspectorEdge[]>
  /** The whole graph, for a picker whose hint composes what is wired into it (Camera Motion's start state). */
  readonly context: HintGraphContext
}

/** A `variables` wire only feeds `{Label}` refs inside a condition — never an item, never a prompt. */
function indexGraph(nodes: readonly InspectorNode[], edges: readonly InspectorEdge[]): Graph {
  const wires = edges.filter((edge) => edge.targetHandle !== VARIABLES_HANDLE_ID)
  const targets = [...new Set(wires.map((edge) => edge.target))]
  const incoming = new Map(targets.map((target) => [target, wires.filter((edge) => edge.target === target)]))
  return { byId: new Map(nodes.map((n) => [n.id, n])), incoming, context: { nodes, edges } }
}

const incomingEdges = (node: InspectorNode, graph: Graph): readonly InspectorEdge[] => graph.incoming.get(node.id) ?? []

/** A plain text producer's output, as its last run left it and as the run hands it on. */
function ownText(node: InspectorNode): string | null {
  if (nonEmptyString(node.data.generatedText)) return node.data.generatedText
  if (nonEmptyString(node.data.combinedText)) return node.data.combinedText
  if (node.type === "text-prompt" && nonEmptyString(node.data.text)) return node.data.text
  return jsonValue(node)
}

/** A picker (lighting, lens, person…) — Text Prompt shares the set but is plain text. */
const isPicker = (node: InspectorNode): boolean =>
  node.type !== undefined && node.type !== "text-prompt" && PARAMETER_NODE_TYPES.has(node.type)

/** The fragment a picker puts into a prompt: the hint the run substitutes for its `{Label}`, composed with the graph as both engines do. */
function pickerHint(node: InspectorNode, graph: Graph): string[] {
  if (!isPicker(node)) return []
  const hint = getParameterPromptHint(node, graph.context).trim()
  return hint ? [hint] : []
}

/** The nodes whose Negative handle has its own Inject switch (node-input-resolver). */
const NEGATIVE_INJECT_TYPES = new Set(["generate-image", "generate-video"])

/**
 * Whether what a source sends on a text wire reaches the node (node-input-resolver).
 * A source the node names with `{Label}` always does — its text lands on the
 * placeholder. Otherwise a picker never does (the run skips it as a wired
 * prompt), and a Prompt or Negative wire does not while that handle's Inject
 * switch is off.
 */
function reachesText(source: InspectorNode, consumer: InspectorNode, handle: string | null | undefined): boolean {
  const label = canonicalVarName(stringValue(source.data.label) || source.type || source.id)
  const texts = TEXT_FIELDS.map(([key]) => stringValue(consumer.data[key]) ?? "").join("\n")
  if (extractReferencedLabels(texts).has(label)) return true
  if (isPicker(source)) return false
  if (handle === "prompt") return consumer.data.injectPrompt !== false
  if (handle === "negative" && NEGATIVE_INJECT_TYPES.has(consumer.type ?? "")) return consumer.data.injectNegative !== false
  return true
}

/** Split Text exactly as the run splits it (inline-executor executeSplitText). */
function splitText(text: string, data: Readonly<Record<string, unknown>>): string[] {
  const separator = resolveSeparator(
    (data.separator ?? data.delimiter) as string | undefined,
    data.customSeparator as string | undefined,
  )
  const parts = separator ? text.split(separator) : [text]
  const trimmed = data.trimWhitespace !== false ? parts.map((part) => part.trim()) : parts
  return data.removeEmpty !== false ? trimmed.filter((part) => part.length > 0) : trimmed
}

/** Every item one wire hands a list consumer (collectItemsForEdge): a JSON array is one item per element. */
function wireListItems(edge: InspectorEdge, graph: Graph, depth: number): string[] {
  const source = graph.byId.get(edge.source)
  if (!source) return []
  const json = source.data[JSON_RESULT_KEY]
  if (Array.isArray(json) && edge.sourceHandle !== "text") {
    return json
      .filter((item) => item !== undefined && item !== null)
      .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
  }
  return outputItems(source, edge.sourceHandle, graph, depth + 1)
}

/** A source's primary text as Split Text reads it (getPrimaryOutput): Generate Text's WHOLE result, even on its `items` wire. */
function primaryText(edge: InspectorEdge, graph: Graph, depth: number): string {
  const source = graph.byId.get(edge.source)
  if (!source) return ""
  const handle = source.type === "llm-chat" ? undefined : edge.sourceHandle
  return outputItems(source, handle, graph, depth + 1)[0] ?? ""
}

/** The run splits the primary text of each wired source, joined (executeSplitText). */
function splitItems(node: InspectorNode, graph: Graph, depth: number): string[] {
  const stored = nonEmptyStrings(node.data.splitResults)
  if (stored.length > 0) return stored
  const input = incomingEdges(node, graph).map((edge) => primaryText(edge, graph, depth)).join("")
  const text = input || stringValue(node.data.text) || ""
  return text ? splitText(text, node.data) : []
}

/** The fields the run fills from `{Label}` refs and trigger tokens (resolveSelectorRefs). */
const RUN_TIME_SELECTOR_FIELDS = ["moduloDivisor", "predicateValue", "namedKeyValue", "seed"] as const

/** False when the pick exists only at run time: an unseeded random pick, or a field that is a reference. */
function isReproducible(config: SelectorConfig): boolean {
  if (config.mode === "random" && !nonEmptyString(config.seed)) return false
  return !RUN_TIME_SELECTOR_FIELDS.some((key) => {
    const value: unknown = config[key]
    return typeof value === "string" && value.includes("{")
  })
}

type SelectorChannel = "picked" | "rest"

/** The selector's picked or rest channel; re-derived with the run's `runSelector` when it was never saved. */
function selectorItems(node: InspectorNode, channel: SelectorChannel, graph: Graph, depth: number): string[] {
  const live = nonEmptyStrings(node.data[`__${channel}Results`])
  if (live.length > 0) return live
  const saved = nonEmptyStrings(node.data[`${channel}Results`])
  if (saved.length > 0) return saved
  const config = (node.data.config ?? { mode: "item" }) as SelectorConfig
  if (!isReproducible(config)) return []
  const inputs = incomingEdges(node, graph)
  // Generate Text's items list reaches a selector cut up on the canvas but whole
  // on a server run (backend collectItemsForEdge reads its text); which one this
  // run was is not recorded, so it is not guessed.
  if (inputs.some((edge) => edge.sourceHandle === "items" && graph.byId.get(edge.source)?.type === "llm-chat")) return []
  const items = spreadJsonArrayIfSingleton(inputs.flatMap((edge) => wireListItems(edge, graph, depth)))
  return items.length > 0 ? runSelector(items, config)[channel] : []
}

/**
 * What a node hands one of its output handles, as its last run left it. Split
 * Text and the selector are pure, so when a template was published without
 * their outputs they are re-derived from their inputs with the functions the
 * run uses — and left empty when the run's answer can't be known here.
 */
function outputItems(node: InspectorNode, handle: string | null | undefined, graph: Graph, depth: number): string[] {
  if (depth > MAX_DEPTH) return []
  if (node.type === "split-text") return splitItems(node, graph, depth)
  if (node.type === "selector") return selectorItems(node, handle === "rest" ? "rest" : "picked", graph, depth)
  // Generate Text's `items` handle is its result cut on ===NEXT===; its other handles carry the whole text.
  if (node.type === "llm-chat" && handle === "items") return splitGeneratedItems(stringValue(node.data.generatedText))
  const text = ownText(node)
  return text === null ? pickerHint(node, graph) : [text]
}

/**
 * The item(s) a wire delivers, by its own setting (node-input-resolver): one
 * item for `item` / `item:N` / `last` ("Selected"), every selected item joined
 * for `all`, and otherwise every selected item — the node runs once per item.
 */
function applyEdgeMode(items: readonly string[], data: InspectorEdge["data"], finalIsSelected: boolean): string[] {
  if (items.length === 0) return []
  const mode = stringValue(data?.outputMode)
  if (mode === "last") return [finalIsSelected ? items[items.length - 1] : items[0]]
  if (mode === "item") return [items[resolveIndex(stringValue(data?.itemIndex) ?? "1", items.length)] ?? items[0]]
  if (mode?.startsWith("item:")) return [items[Number.parseInt(mode.slice("item:".length), 10)] ?? items[0]]
  const selected = selectListItems([...items], data as SelectorFields | undefined)
  return mode === "all" ? [selected.join(", ")] : selected
}

/** The item(s) one wire delivers to a text input. "Selected" is the final item of Generate Text's `items` list, the first of any other. */
function wireItems(edge: InspectorEdge, source: InspectorNode, graph: Graph): string[] {
  const llmItems = source.type === "llm-chat" && edge.sourceHandle === "items"
  // `all` reads Generate Text's results, not its items: the whole text, delimiters included (node-input-resolver).
  if (llmItems && stringValue(edge.data?.outputMode) === "all") {
    const whole = stringValue(source.data.generatedText)
    return whole ? [whole] : []
  }
  return applyEdgeMode(outputItems(source, edge.sourceHandle, graph, 0), edge.data, llmItems)
}

/** One item is the text itself; several are numbered, because the node they feed works through every one. */
function displayText(items: readonly string[]): string | null {
  if (items.length === 0) return null
  const shown = items.map(readable)
  return shown.length === 1 ? shown[0] : numbered(shown)
}

function nodeName(node: InspectorNode): string {
  const { label, title } = node.data
  if (nonEmptyString(label)) return label
  if (nonEmptyString(title)) return title
  return node.id
}

const edgeKey = (edge: InspectorEdge): string =>
  edge.id ?? `${edge.source}:${edge.sourceHandle ?? ""}:${edge.targetHandle ?? ""}`

const isAddress = (value: string): boolean => /^https?:\/\//i.test(value.trim())

/** Repeat ×N and multi-model runs fill a node's run list with markers, not text (repeat-types). */
const isRunMarker = (value: string): boolean => value === REPEAT_PLACEHOLDER || decodeProviderItem(value) !== undefined

/** The node whose list fans this one out: the first wire that delivers each item in turn (node-input-resolver). */
function fanOutSource(node: InspectorNode, graph: Graph): InspectorNode | undefined {
  const drives = (edge: InspectorEdge): boolean => {
    const source = graph.byId.get(edge.source)
    if (!source?.type) return false
    const mode = stringValue(edge.data?.outputMode)
    if (mode !== undefined) return mode === "each"
    return FAN_OUT_EACH_TYPES.has(source.type) || (source.type === "llm-chat" && edge.sourceHandle === "items")
  }
  const edge = incomingEdges(node, graph).find(drives)
  return edge ? graph.byId.get(edge.source) : undefined
}

/**
 * A node a List fanned out to keeps the inputs it ran on (`__listInputs`) —
 * the only record of its prompt when the list feeds its generic input.
 */
function listInputsField(node: InspectorNode, graph: Graph): InspectorField[] {
  const inputs = nonEmptyStrings(node.data.__listInputs).filter((value) => !isAddress(value) && !isRunMarker(value))
  const value = displayText(inputs)
  if (value === null) return []
  const from = fanOutSource(node, graph)
  return [{ key: "wired:list-inputs", label: "Prompt", source: from ? nodeName(from) : "List", value }]
}

/**
 * What a node RECEIVED on its text wires, in wire order: a media node whose
 * prompt comes from a selector or an LLM stores no prompt of its own, so this
 * is the only place a reader can see what it was generated from.
 */
export function wiredInputFields(
  node: InspectorNode,
  nodes: readonly InspectorNode[],
  edges: readonly InspectorEdge[],
): InspectorField[] {
  const graph = indexGraph(nodes, edges)
  const wired = incomingEdges(node, graph).flatMap((edge) => {
    const label = edge.targetHandle ? WIRED_TEXT_HANDLES[edge.targetHandle] : undefined
    const source = graph.byId.get(edge.source)
    if (!label || !source || !reachesText(source, node, edge.targetHandle)) return []
    const value = displayText(wireItems(edge, source, graph))
    if (value === null) return []
    return [{ key: `wired:${edgeKey(edge)}`, label, source: nodeName(source), value }]
  })
  const listed = listInputsField(node, graph).filter((field) => !wired.some((w) => w.value === field.value))
  return [...wired, ...listed]
}

/**
 * What the plumbing nodes of a template SHOW when its run left their output
 * unsaved: Split Text's parts and a selector's picks, re-derived with the same
 * functions as the inspector, keyed by node id. Display only — the patches are
 * merged into the canvas's copy of the snapshot and never written anywhere.
 */
export function derivedPlumbingData(
  nodes: readonly InspectorNode[],
  edges: readonly InspectorEdge[],
): ReadonlyMap<string, Readonly<Record<string, unknown>>> {
  const graph = indexGraph(nodes, edges)
  const patches = nodes.flatMap((node): Array<readonly [string, Record<string, unknown>]> => {
    if (node.type === "split-text" && nonEmptyStrings(node.data.splitResults).length === 0) {
      const parts = splitItems(node, graph, 0)
      return parts.length > 0 ? [[node.id, { splitResults: parts }]] : []
    }
    const unsavedPick =
      nonEmptyStrings(node.data.__pickedResults).length === 0 && nonEmptyStrings(node.data.pickedResults).length === 0
    if (node.type === "selector" && unsavedPick) {
      const picked = selectorItems(node, "picked", graph, 0)
      return picked.length > 0 ? [[node.id, { pickedResults: picked, restResults: selectorItems(node, "rest", graph, 0) }]] : []
    }
    return []
  })
  return new Map(patches)
}

/** Short settings worth a chip, in display order. */
const SETTING_FIELDS: ReadonlyArray<readonly [key: string, label: string]> = [
  ["provider", "Model"],
  ["llmModel", "Model"],
  ["resolution", "Resolution"],
  ["aspectRatio", "Aspect ratio"],
  ["quality", "Quality"],
  ["duration", "Duration"],
  ["mode", "Mode"],
  ["timestamp", "Seconds"],
  ["filename", "File"],
]

/** Bookkeeping keys that are never a setting a reader cares about. */
const NOT_A_SETTING = new Set([
  "label", "title", "hintMode", "templateId", "style", "className", "color", "textColor", "alignment", "fontSize",
  "url", "r2Url", "thumbnailUrl", "assetId", "mimeType", "kieTaskId", "generatedImageUrl", "generatedVideoUrl",
  ...TEXT_FIELDS.map(([key]) => key),
])
const SHORT_VALUE_MAX = 40

const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0

export function inspectorFields(node: InspectorNode): InspectorField[] {
  const texts = TEXT_FIELDS.flatMap(([key, label]) => {
    const value = node.data[key]
    if (!nonEmptyString(value)) return []
    const shown = key === "text" && node.type === "sticky-note" ? "Note" : label
    return [{ key, label: shown, value }]
  })
  const address = URL_IS_AN_INPUT.has(node.type ?? "") && nonEmptyString(node.data.url)
    ? [{ key: "url", label: "Address", value: node.data.url }]
    : []
  return [...address, ...texts, ...jsonResultField(node)]
}

/**
 * Known settings first (model, size, seconds). A node with none of them — a
 * picker — shows its own short string fields instead, so the chosen tiles are
 * readable ("lightingStyle · on-camera-flash").
 */
export function inspectorSettings(node: InspectorNode): InspectorSetting[] {
  const known = SETTING_FIELDS.flatMap(([key, label]) => {
    const value = node.data[key]
    if (nonEmptyString(value)) return [{ label, value }]
    if (typeof value === "number" && Number.isFinite(value)) return [{ label, value: String(value) }]
    return []
  })
  if (known.length > 0) return known
  return Object.entries(node.data).flatMap(([key, value]) =>
    !NOT_A_SETTING.has(key) && nonEmptyString(value) && value.length <= SHORT_VALUE_MAX ? [{ label: key, value }] : [],
  )
}

/** The topmost node (last in draw order) whose box contains the point. */
export function nodeAtPoint(rects: readonly NodeRect[], point: { readonly x: number; readonly y: number }): string | null {
  for (let i = rects.length - 1; i >= 0; i -= 1) {
    const r = rects[i]
    if (r.width <= 0 || r.height <= 0) continue
    if (point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height) return r.id
  }
  return null
}
