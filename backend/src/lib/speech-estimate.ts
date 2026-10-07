/**
 * Length-based speech pricing — the ESTIMATE half: what a Text to Speech or
 * Text to Dialogue NODE will send, as far as its data can tell, and the
 * (unit row, units) pair every pre-run surface prices it with — the workflow
 * estimate behind published apps, templates, components and the editor's
 * total; the seeded-pipeline estimate; the published-app backfill. The frontend
 * mirrors this file (frontend/src/lib/speech-estimate.ts); the two agree on a
 * shared fixture (tools/fixtures/speech-estimate-cases.json).
 *
 * Exact when the text is literal on the node (affixes applied, then the one
 * counter: clamp to the run-as model's cap, strip tags it does not perform).
 * Unknown — upstream text, a {Reference}, a field mapping, no text — prices at
 * the model's cap, or at the exposed input's character limit when the app
 * declares one: an estimate may over-quote, never under-quote. Undefined for
 * every node while SPEECH_LENGTH_PRICING_ENABLED is off, so each estimate loop
 * keeps today's flat-row branch byte for byte.
 *
 * Also the marked-up JOB override for the seams that hold a payload rather
 * than a request body (the orchestrator, the pipeline services). It lives
 * here and not in speech-credits.ts so that file keeps its thin, mock-free
 * import graph (payload-builder.ts imports it): the override reads
 * `getAppSettings`, which reaches the database client.
 */
import {
  DEFAULT_TTS_PROVIDER,
  dialogueProviderOf,
  getDialogueCapabilities,
  getMaxTtsChars,
  readPromptAffixes,
  speechPriceUnits,
  speechUnitCreditId,
} from "@nodaro/shared"
import { applyPromptAffixes } from "@nodaro/prompts"
import { getAppSettings } from "./app-settings.js"
import { speechLengthPricingEnabled } from "./config.js"
import { resolveOmittedTtsProvider } from "./omitted-tts-provider.js"
import { LLM_MAX_TOKENS_LIMIT, LLM_TEXT_NODE_TYPES, llmNodeOutputTokenCap } from "./llm-node-output-cap.js"
import { SLOWEST_VOICE_SPEED, slowScriptChars } from "./video-output-length.js"
import { billableDialogueChars, billableSpeechChars, dialogueBaseCredits, speechBaseCredits, speechRunsAs } from "./speech-credits.js"

export const SPEECH_NODE_TYPES: ReadonlySet<string> = new Set(["text-to-speech", "text-to-dialogue"])
/** A `{Label}` reference — resolved at run time, so its length is unknown now (the add-captions precedent). */
const REFERENCE = /\{[^{}]+\}/
const NO_REFS: ReadonlyMap<string, string> = new Map()

export interface SpeechEstimateChars {
  chars: number
  /** True when `chars` is the literal text the run will send; false when it is a ceiling. */
  exact: boolean
  /** The run-as model's per-request cap (what an unknown text is priced at without a tighter limit). */
  cap: number
  /** The model whose unit row prices this node. */
  runsAs: string
}

/** What the graph says about a connected text — resolved by the caller (`upstreamSpeechText`), so this module stays pure. */
export interface SpeechEstimateContext {
  /**
   * The largest character limit among the exposed app inputs that may feed this
   * node's text (its own `directText`, the upstream Text node's `text`) when
   * EVERY unknown source has one. A set limit also marks the wire as unknown.
   */
  textCap?: number
  /** The node's own `directText` is an exposed app input (with or without a limit): its stored value is a placeholder, not the text that runs. */
  exposed?: boolean
  /** The literal text of the one Text node wired into `prompt` (possibly blank) — the run sends exactly this when it is not blank, plus the affixes. */
  upstreamText?: string
  /** An edge feeds `prompt` whose text cannot be read now (not a literal Text node, an exposed input with no limit, several edges, a {Reference}): it can be any length up to the cap, and it outranks any literal fallback on the node. */
  wireUnknown?: boolean
  /**
   * The most tokens the one LLM node (Prompt, AI Writer) feeding `prompt` can
   * write (`llmNodeOutputTokenCap`; the model's own ceiling when its cap cannot be
   * read now). A LENGTH bound only, for the listing (`llmScriptChars`): the text is
   * still unknown (`wireUnknown`), so the node's own price does not read it.
   */
  llmOutputTokens?: number
}

/** Characters a token can be, at most (decided 2026-10-07): the safe upper bound an LLM-written script is counted at. */
export const MAX_CHARS_PER_TOKEN = 8

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
  // The run wraps the text in the node's pre/post text (readPromptAffixes +
  // applyPromptAffixes, as payload-builder does). With no references to
  // resolve, a `{…}` that survives — in the core or an affix — is a reference
  // the run resolves later: its length is unknown now.
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
  // Omitted provider: the length rule on literal text (the lane's own rule); the
  // default model when the text is unknown.
  const runsAs = speechRunsAs(named ?? (text !== undefined ? resolveOmittedTtsProvider(text) : DEFAULT_TTS_PROVIDER))
  const cap = getMaxTtsChars(runsAs)
  if (text !== undefined) return { chars: billableSpeechChars(runsAs, text), exact: true, cap, runsAs }
  return { chars: limitedChars(runsAs, cap, textCap, data), exact: false, cap, runsAs }
}

/**
 * What changes how long a speech node's script takes to speak, beyond its
 * character count (decided 2026-10-07): the node's speed, and how many of a
 * literal text's characters are in a slow script (Chinese, Japanese, Korean).
 * An unreadable speed (mapped to a wire, or not a number) is the slider's floor,
 * the slowest the voice speaks, so a listing never quotes below the run. A
 * dialogue has no speed.
 */
export function speechScriptTraits(nodeType: string, data: Record<string, unknown>, ctx: SpeechEstimateContext = {}): { speed: number; slowChars: number } {
  if (nodeType === "text-to-dialogue") {
    const lines = Array.isArray(data.dialogue) && !mapped(data, "dialogue") ? data.dialogue : []
    const slowChars = lines.reduce((sum, l) => sum + (typeof (l as { text?: unknown } | null)?.text === "string" ? slowScriptChars((l as { text: string }).text) : 0), 0)
    return { speed: 1, slowChars }
  }
  const raw = data.speed
  const speed = mapped(data, "speed") || (raw !== undefined && (typeof raw !== "number" || !Number.isFinite(raw)))
    ? SLOWEST_VOICE_SPEED
    : Math.min(1.2, Math.max(SLOWEST_VOICE_SPEED, raw ?? 1))
  const text = speechTextOf(data, ctx)
  return { speed, slowChars: text === undefined ? 0 : slowScriptChars(text) }
}

/**
 * How many characters a speech node's script can be when an LLM node writes it
 * (decided 2026-10-07): the tokens that node can write x {@link MAX_CHARS_PER_TOKEN},
 * as the run sends it (wrapped in the node's pre/post text); never less than the
 * node's own literal text, which a blank LLM output falls back to (wrapped the
 * same way). Undefined when no single LLM node writes the script, when the
 * node's own text holds a {Reference} (it can resolve to any length), when the text is known (it is then
 * counted by `speechEstimateChars`), or when a reference in a pre/post text makes
 * the wrapper's length unknown. A length bound for the listing only: `speechEstimate`
 * (the node's price) never reads it.
 */
export function llmScriptChars(nodeType: string, data: Record<string, unknown>, ctx: SpeechEstimateContext = {}): number | undefined {
  if (nodeType !== "text-to-speech" || ctx.llmOutputTokens === undefined || ctx.exposed || mapped(data, "directText")) return undefined
  if (speechTextOf(data, ctx) !== undefined) return undefined
  const written = applyPromptAffixes("a".repeat(ctx.llmOutputTokens * MAX_CHARS_PER_TOKEN), readPromptAffixes(data), NO_REFS)
  if (REFERENCE.test(written)) return undefined
  const ownText = typeof data.directText === "string" && present(data.directText) ? data.directText : undefined
  // A {Reference} in the node's own text resolves at run time to any length, and
  // the node speaks that text in direct mode (the wire is ignored) or when the
  // LLM's output is blank: the script is unknown, so no bound applies.
  if (ownText !== undefined && REFERENCE.test(ownText)) return undefined
  // The fallback is sent wrapped in the pre/post text, like the LLM's output.
  const own = ownText === undefined ? 0 : applyPromptAffixes(ownText, readPromptAffixes(data), NO_REFS).length
  return Math.max(written.length, own)
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

export interface SpeechEstimate extends SpeechEstimateChars {
  /** The `:per-100-chars` row the estimate prices on. */
  id: string
  /** Started hundreds, at least the floor — the estimate's multiplier. */
  units: number
}

/** The (unit row, units) pair for a speech node; undefined for any other node and for every node while the flag is off. */
export function speechEstimate(nodeType: string, data: Record<string, unknown>, ctx?: SpeechEstimateContext): SpeechEstimate | undefined {
  if (!SPEECH_NODE_TYPES.has(nodeType) || !speechLengthPricingEnabled()) return undefined
  const chars = speechEstimateChars(nodeType, data, ctx)
  return { ...chars, id: speechUnitCreditId(chars.runsAs), units: speechPriceUnits(chars.chars) }
}

/** One LITERAL line as its own text-to-speech job (the pipeline services): the one counter, no reference heuristic — an LLM-written `{` is text. */
export function speechLineEstimate(model: string, text: string): { id: string; units: number } {
  const runsAs = speechRunsAs(model)
  return { id: speechUnitCreditId(runsAs), units: speechPriceUnits(billableSpeechChars(runsAs, text)) }
}

type GraphNode = { id?: string; type?: string; data?: Record<string, unknown> }
type GraphEdge = { source?: string; target: string; targetHandle?: string | null }

/**
 * Every exposed text input of a published app, "<nodeId>:<field>" → its
 * character limit, or null when it has none. A key that is absent = the field
 * is not exposed. Built at publish from the presentation items.
 */
export type ExposedTextCaps = Readonly<Record<string, number | null>>

/** The LLM node settings an app can expose (and a field mapping can write) that change how many tokens a run may write. */
export const LLM_CAP_FIELDS = ["llmModel", "reasoningEffort", "advancedMode"] as const

/**
 * What an LLM node's run can write, in tokens, as far as the graph says: its
 * `maxTokens` (the node's default when unset) raised to the reasoning floor of its
 * model and effort (`llmNodeOutputTokenCap`, the one rule the request layer
 * also follows). A setting a field mapping writes, or that an app exposes to its
 * user (`exposedTextCaps`: a slider's largest value, or any model / effort /
 * advanced-mode input), is read at the most it can be: the route's own ceiling.
 */
function llmOutputTokens(source: GraphNode, caps: ExposedTextCaps): number {
  const data = source.data ?? {}
  const id = source.id
  const writable = (field: string): boolean => mapped(data, field) || (id !== undefined && Object.hasOwn(caps, `${id}:${field}`))
  if (LLM_CAP_FIELDS.some(writable)) return LLM_MAX_TOKENS_LIMIT
  const exposedMax = id === undefined ? undefined : caps[`${id}:maxTokens`]
  if (mapped(data, "maxTokens") || (id !== undefined && Object.hasOwn(caps, `${id}:maxTokens`) && exposedMax === null)) return LLM_MAX_TOKENS_LIMIT
  return llmNodeOutputTokenCap(source.type ?? "llm-chat", data, typeof exposedMax === "number" ? Math.max(exposedMax, 1) : undefined)
}

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
  const ctx: { exposed?: true; upstreamText?: string; llmOutputTokens?: number } = {}
  const into = edges.filter((e) => e.target === node.id && (e.targetHandle === "prompt" || e.targetHandle == null))
  let wireUnknown = false
  if (into.length > 0) {
    const first = into[0]!
    const source = into.length === 1 && first.source ? nodes.find((n) => n.id === first.source) : undefined
    const text = source?.data?.text
    if (!source || source.type !== "text-prompt") {
      wireUnknown = true
      limits.push(null)
      if (source && LLM_TEXT_NODE_TYPES.has(source.type ?? "")) ctx.llmOutputTokens = llmOutputTokens(source, caps)
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
  if (Object.hasOwn(caps, ownKey) && ((node.data?.textSource ?? "connected") === "direct" || (ctx.upstreamText !== undefined && ctx.upstreamText.trim() === ""))) {
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

/**
 * What a speech JOB is reserved at, marked up once at the model it runs as —
 * the one function for every seam that holds a payload rather than a request
 * body: the orchestrator (node-executor) and the pipeline services
 * (ee/pipelines/services/_run-worker-job.ts). Undefined for every other job
 * and for every job while the flag is off (the flat DB row then reserves).
 * The margin key is the model the request RUNS as — the id the REST guard
 * marks up at: a node saved with the legacy alias carries `elevenlabs`, while
 * the guard bills it as turbo.
 */
export async function speechChargeOverride(jobName: string, payload: Record<string, unknown>, modelIdentifier: string): Promise<number | undefined> {
  if (jobName !== "text-to-speech" && jobName !== "text-to-dialogue") return undefined
  if (!speechLengthPricingEnabled()) return undefined
  const isSpeech = jobName === "text-to-speech"
  const base = isSpeech ? await speechBaseCredits(payload.provider, payload.text) : await dialogueBaseCredits(payload.dialogue, payload.provider)
  const { applyServiceMarkup } = await import("../ee/billing/service-margin.js")
  return applyServiceMarkup(base, await getAppSettings(), isSpeech ? speechRunsAs(payload.provider) : modelIdentifier)
}
