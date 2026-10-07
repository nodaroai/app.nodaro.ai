/**
 * Length-based speech pricing — the EDITOR's estimator, the mirror of the
 * backend's `lib/speech-estimate.ts`: what a Text to Speech or Text to Dialogue
 * NODE will send, as far as its data can tell, and the (unit row, units) pair
 * the pill, the config panel and the Run total price it with. One fixture pins
 * the two engines case for case (tools/fixtures/speech-estimate-cases.json).
 *
 * Exact when the text is literal on the node (pre/post text applied, then the
 * one counter: clamp to the run-as model's cap, strip the `[audio tags]` it
 * does not perform). Unknown — a connected text, a `{Reference}`, a field
 * mapping, no text — prices at the model's cap, or at an exposed input's
 * character limit: an estimate may over-quote, never under-quote.
 *
 * Pure, and it never reads the flag: the server serves a model's
 * `<model>:per-100-chars` row only while it prices speech by length, so the
 * unit price the caller passes in (from the price cache) IS the flag. No price
 * → `speechQuote` is undefined → every surface quotes today's flat row.
 */
import {
  DEFAULT_TTS_PROVIDER,
  MODEL_CATALOG,
  TTS_FALLBACK_PROVIDER,
  canonicalTtsProvider,
  dialogueProviderOf,
  getDialogueCapabilities,
  getMaxTtsChars,
  readPromptAffixes,
  SPEECH_FLOOR_UNITS,
  SPEECH_UNIT_CREDIT_SUFFIX,
  speechPriceUnits,
  speechUnitCreditId,
  ttsSupportsAudioTags,
} from "@nodaro/shared"
import { applyPromptAffixes, stripAudioTags } from "@nodaro/prompts"

export const SPEECH_NODE_TYPES: ReadonlySet<string> = new Set(["text-to-speech", "text-to-dialogue"])
/** A `{Label}` reference — resolved at run time, so its length is unknown now. */
const REFERENCE = /\{[^{}]+\}/
const NO_REFS: ReadonlyMap<string, string> = new Map()

/** Whether a price identifier is a speech model's per-100-characters RATE row — priced by this estimator, never a variant of the model (the model pickers' range skips it). */
export function isSpeechUnitRow(identifier: string): boolean {
  return identifier.endsWith(SPEECH_UNIT_CREDIT_SUFFIX)
}

/**
 * The text-to-speech model a request RUNS as — the backend's `speechRunsAs`
 * (the egress seam's `ttsModelKey`): the legacy alias resolved; a missing,
 * unknown or non-string id (node data written straight into workflow JSON)
 * runs as the fallback model.
 */
export function speechRunsAs(provider: unknown): string {
  if (typeof provider !== "string") return TTS_FALLBACK_PROVIDER
  const id = canonicalTtsProvider(provider)
  // A text-to-speech model is a catalog entry that lists the `tts` mode (the
  // backend's wire-model table has exactly those rows). Own properties only.
  return Object.hasOwn(MODEL_CATALOG, id) && MODEL_CATALOG[id]!.modes.includes("tts") ? id : TTS_FALLBACK_PROVIDER
}

/** Characters of `text` the worker will send on `provider`: clamped to the model's cap, tags stripped when the model does not perform them. */
export function billableSpeechChars(provider: unknown, text: unknown): number {
  if (typeof text !== "string") return 0
  const runsAs = speechRunsAs(provider)
  const clamped = text.slice(0, getMaxTtsChars(runsAs))
  return (ttsSupportsAudioTags(runsAs) ? clamped : stripAudioTags(clamped)).length
}

/** Characters of a dialogue script: the sum of its lines' texts, at most the dialogue model's total cap. */
export function billableDialogueChars(lines: unknown, provider?: unknown): number {
  if (!Array.isArray(lines)) return 0
  let total = 0
  for (const line of lines) {
    const text = (line as { text?: unknown } | null)?.text
    if (typeof text === "string") total += text.length
  }
  return Math.min(total, getDialogueCapabilities(provider).maxChars)
}

/** The backend's omitted-provider rule (lib/omitted-tts-provider.ts): the default model up to its own cap, turbo above it. */
function resolveOmittedTtsProvider(text: string): string {
  return text.length <= getMaxTtsChars(DEFAULT_TTS_PROVIDER) ? DEFAULT_TTS_PROVIDER : "elevenlabs-turbo"
}

export interface SpeechEstimateChars {
  chars: number
  /** True when `chars` is the literal text the run will send; false when it is a ceiling. */
  exact: boolean
  /** The run-as model's per-request cap. */
  cap: number
  /** The model whose unit row prices this node. */
  runsAs: string
}

/** What the graph says about a node's text — resolved by `upstreamSpeechText`, so the estimate stays pure. */
export interface SpeechEstimateContext {
  /**
   * The largest character limit among the exposed app inputs that may feed this
   * node's text (its own `directText`, the upstream Text node's `text`) when
   * EVERY unknown source has one. A set limit also marks the wire as unknown.
   */
  textCap?: number
  /** The node's own `directText` is an exposed app input: its stored value is a placeholder, not the text that runs. */
  exposed?: boolean
  /** The literal text of the one Text node wired into `prompt` (possibly blank) — the run sends exactly this when it is not blank, plus the affixes. */
  upstreamText?: string
  /** An edge feeds `prompt` whose text cannot be read now (not a literal Text node, an exposed input with no limit, several edges, a {Reference}): it can be any length up to the cap, and it outranks any literal fallback on the node. */
  wireUnknown?: boolean
}

function mapped(data: Record<string, unknown>, field: string): boolean {
  const mappings = data.fieldMappings
  return !!mappings && typeof mappings === "object" && field in (mappings as Record<string, unknown>)
}

/** The run's own test for a usable text (resolve-prompt.ts `present`): non-blank after trim. */
const present = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0

/**
 * The text a Text to Speech node will send, or undefined when it arrives at run
 * time. Follows the run's precedence (computeNodePrompt): a direct node uses
 * its own text when it is not blank, else the wire; a connected node uses the
 * wire when it is not blank, else its own text. A blank text is absent, so it
 * falls through — and an unreadable wire outranks any literal fallback.
 */
function speechTextOf(data: Record<string, unknown>, ctx: SpeechEstimateContext): string | undefined {
  const direct = (data.textSource ?? "connected") === "direct"
  if (ctx.exposed) {
    // An exposed own text is a placeholder: unknown when it is the text that runs,
    // and whenever the wire is blank (a direct node's value, or a connected node's fallback).
    if (direct || (ctx.upstreamText !== undefined && !present(ctx.upstreamText))) return undefined
  }
  const own = typeof data.directText === "string" ? data.directText : undefined
  const wireUnknown = ctx.wireUnknown === true || ctx.textCap !== undefined
  let core: string | undefined
  if (direct) {
    if (mapped(data, "directText")) return undefined
    if (present(own)) core = own
    else if (present(ctx.upstreamText)) core = ctx.upstreamText
    else if (wireUnknown) return undefined
    else core = own
  } else if (present(ctx.upstreamText)) {
    core = ctx.upstreamText
  } else if (wireUnknown) {
    return undefined
  } else if (ctx.upstreamText !== undefined) {
    // A wired Text node that is blank: the run falls back to the node's own text.
    if (mapped(data, "directText")) return undefined
    core = own
  }
  if (core === undefined) return undefined
  // The run wraps the text in the node's pre/post text; with no references to
  // resolve, a `{…}` that survives — in the core or an affix — is resolved at
  // run time: its length is unknown now.
  const text = applyPromptAffixes(core, readPromptAffixes(data), NO_REFS)
  return REFERENCE.test(text) ? undefined : text
}

export function speechEstimateChars(nodeType: string, data: Record<string, unknown>, ctx: SpeechEstimateContext = {}): SpeechEstimateChars {
  const textCap = ctx.textCap
  if (nodeType === "text-to-dialogue") {
    const model = dialogueProviderOf(data.provider)
    const cap = getDialogueCapabilities(model).maxChars
    const lines = Array.isArray(data.dialogue) && !mapped(data, "dialogue") ? data.dialogue : undefined
    const literal = lines?.every((l) => typeof (l as { text?: unknown } | null)?.text === "string" && !REFERENCE.test((l as { text: string }).text))
    if (lines && literal) return { chars: billableDialogueChars(lines, model), exact: true, cap, runsAs: model }
    return { chars: Math.min(textCap ?? cap, cap), exact: false, cap, runsAs: model }
  }
  const text = speechTextOf(data, ctx)
  const named = typeof data.provider === "string" && data.provider && !mapped(data, "provider") ? data.provider : undefined
  // Omitted provider: the length rule on literal text; the default model when the text is unknown.
  const runsAs = speechRunsAs(named ?? (text !== undefined ? resolveOmittedTtsProvider(text) : DEFAULT_TTS_PROVIDER))
  const cap = getMaxTtsChars(runsAs)
  if (text !== undefined) return { chars: billableSpeechChars(runsAs, text), exact: true, cap, runsAs }
  return { chars: limitedChars(runsAs, cap, textCap, data), exact: false, cap, runsAs }
}

/**
 * The ceiling of an unknown text: the model's cap, or — under an input limit —
 * the longest text the limit admits AS THE RUN SENDS IT, i.e. wrapped in the
 * node's pre/post text (a plain-letter filler is the widest join), clamped and
 * tag-stripped by the one counter. A {Reference} in an affix is unknown: the cap.
 */
function limitedChars(runsAs: string, cap: number, textCap: number | undefined, data: Record<string, unknown>): number {
  if (textCap === undefined) return cap
  const wrapped = applyPromptAffixes("a".repeat(Math.min(textCap, cap)), readPromptAffixes(data), NO_REFS)
  return REFERENCE.test(wrapped) ? cap : billableSpeechChars(runsAs, wrapped)
}

export interface SpeechQuote extends SpeechEstimateChars {
  /** The `<model>:per-100-chars` row the quote prices on. */
  id: string
  /** The row's price for one started 100 characters, as the server serves it. */
  unit: number
  /** Started hundreds, at least the floor. */
  units: number
  /** `unit × units` — the Run cost (the ceiling when the text is unknown). */
  credits: number
  /** Set when the text is unknown: from the floor up to the ceiling the quote prices. */
  range?: { min: number; max: number }
}

/**
 * The quote for a speech node, or undefined when the node is not speech OR
 * the server does not serve its unit row (`unitPriceOf` answers undefined —
 * length pricing off, or a cold cache): the caller then quotes the flat row
 * with units 1, today's number. The id and the units come from this one call.
 */
export function speechQuote(
  nodeType: string,
  data: Record<string, unknown>,
  ctx: SpeechEstimateContext,
  unitPriceOf: (unitId: string) => number | undefined,
): SpeechQuote | undefined {
  if (!SPEECH_NODE_TYPES.has(nodeType)) return undefined
  const chars = speechEstimateChars(nodeType, data, ctx)
  const id = speechUnitCreditId(chars.runsAs)
  const unit = unitPriceOf(id)
  if (unit === undefined) return undefined
  const units = speechPriceUnits(chars.chars)
  const credits = unit * units
  return { ...chars, id, unit, units, credits, ...(chars.exact ? {} : { range: { min: SPEECH_FLOOR_UNITS * unit, max: credits } }) }
}

type GraphNode = { id?: string; type?: string; data?: unknown }
type GraphEdge = { source?: string; target: string; targetHandle?: string | null }

/** Every exposed text input, "<nodeId>:<field>" → its limit, or null when it has none; absent = not exposed. (In the editor: `{}`.) */
export type ExposedTextCaps = Readonly<Record<string, number | null>>

/**
 * The one-hop rule for the text a speech node is fed (the common published-app
 * shape is a Text node → Text to Speech, with the app input ON THE TEXT NODE):
 * the ONE edge into `prompt` (a null handle counts — the input resolver's
 * `inputs.prompt = output` fallback) from a `text-prompt` node whose `text` is
 * literal and NOT exposed → that text (`upstreamText`, which may be blank);
 * exposed with a limit → that limit; exposed without one, any other source, or
 * a {Reference} → unknown (`wireUnknown`). SEVERAL edges into `prompt` are
 * unknown: the run keeps the one it routes last, which depends on the resolver,
 * so no single edge may price the node. The node's own exposed `directText` is
 * read the same three ways. Both are resolved for a direct AND a connected
 * node, because a blank text falls through to the other.
 */
export function upstreamSpeechText(node: GraphNode, nodes: ReadonlyArray<GraphNode>, edges: ReadonlyArray<GraphEdge>, caps: ExposedTextCaps): SpeechEstimateContext {
  if (!node.id) return {}
  // The limit of every source whose text is unknown now (null = no limit).
  const limits: Array<number | null> = []
  const ctx: { exposed?: true; upstreamText?: string } = {}
  const into = edges.filter((e) => e.target === node.id && (e.targetHandle === "prompt" || e.targetHandle == null))
  let wireUnknown = false
  if (into.length > 0) {
    const first = into[0]!
    const source = into.length === 1 && first.source ? nodes.find((n) => n.id === first.source) : undefined
    const text = (source?.data as Record<string, unknown> | undefined)?.text
    if (!source || source.type !== "text-prompt") {
      wireUnknown = true
      limits.push(null)
    } else if (Object.hasOwn(caps, `${source.id}:text`)) {
      wireUnknown = true
      limits.push(caps[`${source.id}:text`] ?? null)
    } else if (typeof text === "string" && !REFERENCE.test(text)) {
      ctx.upstreamText = text
    } else {
      wireUnknown = true
      limits.push(null)
    }
  }
  // The node's own exposed `directText`: the text that runs on a direct node; on
  // a connected node only the fallback for a blank wired text (with no wire, or an
  // unreadable one, a connected node's text arrives some other way: the cap).
  const ownKey = `${node.id}:directText`
  if (Object.hasOwn(caps, ownKey) && (((node.data as Record<string, unknown> | undefined)?.textSource ?? "connected") === "direct" || (ctx.upstreamText !== undefined && ctx.upstreamText.trim() === ""))) {
    ctx.exposed = true
    limits.push(caps[ownKey] ?? null)
  }
  const capped = limits.length > 0 && limits.every((l): l is number => l !== null)
  return {
    ...ctx,
    ...(capped ? { textCap: Math.max(...(limits as number[])) } : {}),
    ...(wireUnknown && !capped ? { wireUnknown: true } : {}),
  }
}

/** Today's flat row for a speech node: the stored model (the default when none) / the dialogue model it runs as. */
export function speechFlatId(nodeType: string, data: Record<string, unknown>): string {
  if (nodeType === "text-to-dialogue") return dialogueProviderOf(data.provider)
  return (typeof data.provider === "string" && data.provider) || DEFAULT_TTS_PROVIDER
}

/**
 * The unit rows the speech nodes among `nodes` would price on (each once) — on
 * the model each node's estimate runs as. A pre-run estimate fetches these
 * beside the flat ids, so a node with no pill mounted can still learn that the
 * server prices speech by length.
 */
export function speechUnitIdsFor(nodes: ReadonlyArray<GraphNode>, allNodes: ReadonlyArray<GraphNode>, edges: ReadonlyArray<GraphEdge>): string[] {
  const ids = new Set<string>()
  for (const node of nodes) {
    if (!node.type || !SPEECH_NODE_TYPES.has(node.type)) continue
    const data = (node.data ?? {}) as Record<string, unknown>
    ids.add(speechUnitCreditId(speechEstimateChars(node.type, data, upstreamSpeechText(node, allNodes, edges, {})).runsAs))
  }
  return [...ids]
}
