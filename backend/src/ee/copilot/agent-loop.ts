/**
 * The model↔tools loop.
 *
 * The Anthropic SDK's own streaming loop, not `llm-client`: this loop needs
 * streamed prose, per-call abort, per-iteration cost accounting and raw block
 * persistence that a single-shot helper cannot express. It runs on one of two
 * clients, chosen once per turn by the turn runner (`LoopInput.lane`): the
 * platform's Anthropic account, or KIE's Anthropic-compatible `/anthropic`
 * endpoint (`kie-client.ts`) when that account cannot serve. On KIE there is
 * no thinking or effort (KIE ignores both), prior thinking is not replayed,
 * a reply arrives in one piece, a call that failed before any token or charge
 * is retried (K13), and the cost is KIE's own charge.
 *
 * Everything that bounds the turn lives here: iteration / tool-call / wall
 * clock caps, the USD budget derived from the credit reservation, the
 * identical-call short circuit, and the cancel check before every tool call.
 */
import type Anthropic from "@anthropic-ai/sdk"
import { getLlmModel } from "@nodaro/shared/llm-models"
import { getAnthropicClient } from "../../lib/anthropic.js"
import { calculateLlmCost } from "../../lib/pricing/llm-cost.js"
import { LlmPlatformExhaustedError, toPlatformExhausted } from "../../lib/llm-errors.js"
import { kieCostUsd, kieCreditsUsdOf } from "../../lib/llm/kie-cost.js"
import { COPILOT_TIERS, DEFAULT_COPILOT_TIER, TURN_CAPS, type CopilotTierSpec } from "./constants.js"
import { stripThinkingBlocks } from "./history.js"
import { estimateNextCallUsd, wouldExceedBudget, type TurnBudget } from "./budget.js"
import { getCopilotKieClient } from "./kie-client.js"
import {
  CopilotDirectRefusedError,
  KIE_COPILOT_RETRIES,
  KIE_COPILOT_RETRY_DELAY_MS,
  kieRetryable,
  type CopilotLane,
} from "./lane.js"
import { newUntrustedNonce, wrapUntrusted } from "./untrusted.js"
import { toolLabel } from "./tool-labels.js"
import { dispatchTool, type DispatchDeps, type ToolDefinition } from "./tools/registry.js"
import type { ActionProposal, RunProposal } from "./tools/types.js"

export type LoopStopReason =
  | "completed"
  | "capped"
  | "cancelled"
  | "budget"
  | "run_proposed"
  | "refused"
  /** `stop_reason: "max_tokens"` — the answer was cut off mid-sentence. */
  | "truncated"

export interface LoopUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
}

export interface LoopEvents {
  onToken: (delta: string) => void
  onToolCall: (event: { id: string; name: string; label: string; status: "started" | "finished" | "failed"; summary?: string }) => void
  /** Called after every iteration with the running totals — the caller persists them. */
  onIteration: (state: { iterations: number; toolCalls: number; usage: LoopUsage }) => Promise<void> | void
}

export interface LoopInput {
  /** The thread's model ladder rung. Defaults to standard when absent. */
  tier?: CopilotTierSpec
  /** Which client serves the turn — chosen once by the turn runner. Defaults to the direct lane. */
  lane?: CopilotLane
  /** Provider USD this turn already spent before the loop (KIE image descriptions): counted in the budget and the metered cost. */
  priorCostUsd?: number
  /** The pause between K13 retries on KIE; tests pass 0. */
  kieRetryDelayMs?: number
  /**
   * When the turn started (ms epoch). The wall clock runs from here, not from
   * this loop's start, so work done before it — the KIE image descriptions, a
   * refused first run — never buys the turn more time than its hard timeout
   * allows. Defaults to now.
   */
  startedAt?: number
  system: string
  tools: ToolDefinition[]
  /** Prior turns, already trimmed to the history budget. */
  history: Anthropic.Messages.MessageParam[]
  /** This turn's user message content blocks. */
  userContent: Anthropic.Messages.ContentBlockParam[]
  budget: TurnBudget
  signal: AbortSignal
  deps: DispatchDeps
  events: LoopEvents
  /** DB-backed cancel check, consulted before each tool call (multi-replica safe). */
  isCancelRequested: () => Promise<boolean>
}

export interface LoopResult {
  stopReason: LoopStopReason
  /** Every message produced this turn (user first), for persistence + replay. */
  messages: Anthropic.Messages.MessageParam[]
  assistantText: string
  usage: LoopUsage
  iterations: number
  toolCalls: number
  proposal?: RunProposal | ActionProposal
}

const EMPTY_USAGE: LoopUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 }

function canonical(name: string, args: unknown): string {
  return `${name}:${JSON.stringify(args ?? {})}`
}

/** Rough prompt size for the budget estimate — cheaper and steadier than a token count. */
function promptChars(system: string, messages: Anthropic.Messages.MessageParam[]): number {
  return system.length + JSON.stringify(messages).length
}

export async function runAgentLoop(input: LoopInput): Promise<LoopResult> {
  const lane: CopilotLane = input.lane ?? "direct"
  const client = lane === "kie" ? getCopilotKieClient() : getAnthropicClient()
  const tier = input.tier ?? COPILOT_TIERS[DEFAULT_COPILOT_TIER]
  const registry = getLlmModel(tier.registryId)
  // KIE serves the registry's model under its own id.
  const model = lane === "kie" ? (registry?.kieSlugOrModel ?? tier.anthropicModelId) : tier.anthropicModelId
  const nonce = newUntrustedNonce()
  const deadline = (input.startedAt ?? Date.now()) + tier.caps.wallClockMs
  const usage: LoopUsage = { ...EMPTY_USAGE, costUsd: input.priorCostUsd ?? 0 }
  const turnMessages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: input.userContent }]
  const callCounts = new Map<string, number>()
  let assistantText = ""
  let iterations = 0
  let toolCalls = 0
  let proposal: RunProposal | ActionProposal | undefined

  const finish = (stopReason: LoopStopReason): LoopResult => ({
    stopReason,
    messages: turnMessages,
    assistantText,
    usage,
    iterations,
    toolCalls,
    proposal,
  })

  // A model whose thinking is bound to its conversation prefix rejects a
  // replayed block once an earlier turn changed — and stored history is NOT
  // append-only here (buildHistory drops the oldest turns to stay in budget).
  // Prior turns therefore go back without their thinking; this turn's own
  // blocks stay, because within the loop the history only grows. KIE returns
  // no thinking and cannot validate a replayed block's signature, so a turn
  // there drops prior thinking for every model.
  const history = lane === "kie" || registry?.conversationBoundThinking
    ? stripThinkingBlocks(input.history)
    : input.history
  const tools = input.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }))
  const toolsChars = JSON.stringify(tools).length

  while (true) {
    if (input.signal.aborted) return finish("cancelled")
    if (iterations >= tier.caps.maxIterations) return finish("capped")
    if (Date.now() > deadline) return finish("capped")

    const messages = [...history, ...turnMessages]
    const sentChars = promptChars(input.system, messages)
    // From the second iteration on the prefix is a cache hit on the direct
    // lane — pricing it at the full input rate would end turns early over
    // money never spent. KIE is priced at its own rates, with no cache discount.
    const nextCallUsd = estimateNextCallUsd(tier.registryId, sentChars, lane === "direct" && iterations > 0, lane)
    if (wouldExceedBudget(input.budget, usage.costUsd, nextCallUsd)) return finish("budget")

    // Cache breakpoints: the system prefix (stable per process) and the last
    // message (so the growing history is read from cache next iteration).
    const cachedSystem: Anthropic.Messages.TextBlockParam[] = [
      { type: "text", text: input.system, cache_control: { type: "ephemeral" } },
    ]
    const params = {
      model,
      max_tokens: TURN_CAPS.maxTokensPerCall,
      system: cachedSystem,
      messages: markLastForCache(messages),
      tools,
      // A tier that names no effort sends no thinking param at all: its
      // model runs at its own default (economy — Haiku 5.5 reasons at
      // `medium` unasked). KIE is sent neither (it ignores both).
      ...(lane === "direct" && tier.reasoningEffort
        ? { thinking: { type: "adaptive" as const }, output_config: { effort: tier.reasoningEffort } }
        : {}),
    } as unknown as Anthropic.Messages.MessageCreateParamsStreaming

    const onText = (delta: string): void => {
      assistantText += delta
      input.events.onToken(delta)
    }
    const once = (state: CallState): Promise<StreamedCall> => streamOnce(client, params, input.signal, deadline, onText, state)

    let call: StreamedCall
    try {
      call = lane === "kie"
        ? await withKieRetry(once, { signal: input.signal, deadline, delayMs: input.kieRetryDelayMs ?? KIE_COPILOT_RETRY_DELAY_MS })
        : await once(newCallState())
    } catch (err) {
      if (input.signal.aborted) return finish("cancelled")
      throw typeLoopFailure(err, { lane, modelId: tier.registryId, nothingStreamed: iterations === 0 && assistantText === "" })
    }
    const final = call.final

    iterations += 1
    if (lane === "kie") {
      const costUsd = kieCostUsd(tier.registryId, {
        creditsUsd: call.creditsUsd,
        promptChars: sentChars + toolsChars,
        answerChars: JSON.stringify(final.content).length,
      })
      accumulateKieUsage(usage, final.usage, costUsd)
    } else {
      accumulateUsage(usage, final.usage, tier.registryId)
    }
    await input.events.onIteration({ iterations, toolCalls, usage })

    turnMessages.push({ role: "assistant", content: final.content })

    if (final.stop_reason === "refusal") return finish("refused")
    if (final.stop_reason === "max_tokens") return finish("truncated")
    if (final.stop_reason !== "tool_use") return finish("completed")

    const toolUses = final.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use")
    if (toolUses.length === 0) return finish("completed")

    // Every tool_use of one assistant message must be answered in ONE user
    // message, or the next request is rejected by the API.
    const results: Anthropic.Messages.ToolResultBlockParam[] = []
    for (const use of toolUses) {
      if (await input.isCancelRequested()) return finish("cancelled")
      if (input.signal.aborted) return finish("cancelled")

      if (toolCalls >= tier.caps.maxToolCalls) {
        results.push(errorResult(use.id, nonce, use.name, "Tool-call limit for this turn reached. Summarize what you have and stop."))
        continue
      }

      const key = canonical(use.name, use.input)
      const seen = (callCounts.get(key) ?? 0) + 1
      callCounts.set(key, seen)
      if (seen > TURN_CAPS.identicalCallLimit) {
        results.push(errorResult(use.id, nonce, use.name, "You already made this exact call; change your approach instead of repeating it."))
        continue
      }

      const label = toolLabel(use.name)
      input.events.onToolCall({ id: use.id, name: use.name, label, status: "started" })
      const outcome = await dispatchTool(input.deps, use.name, use.input)
      toolCalls += 1
      input.events.onToolCall({
        id: use.id,
        name: use.name,
        label,
        status: outcome.isError ? "failed" : "finished",
        summary: outcome.summary,
      })

      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: wrapUntrusted(nonce, use.name, outcome.text),
        ...(outcome.isError ? { is_error: true } : {}),
      })

      if (outcome.proposal) proposal = outcome.proposal
    }

    turnMessages.push({ role: "user", content: results })

    // A run proposal ends the turn: the user decides, and the outcome comes
    // back as their next message. Answering the tool_use first keeps the
    // stored conversation replayable.
    if (proposal) return finish("run_proposed")
  }
}

/** What one model call saw before it ended — the K13 retry reads it. */
interface CallState {
  /** KIE's charge, from `message_delta`. */
  creditsUsd: number | undefined
  /** `message_delta` arrived: the provider has stated its usage, so the call is paid for. */
  billed: boolean
  /** A text token reached the person. */
  wroteToken: boolean
}

interface StreamedCall {
  final: Anthropic.Messages.Message
  creditsUsd: number | undefined
}

function newCallState(): CallState {
  return { creditsUsd: undefined, billed: false, wroteToken: false }
}

/** One streamed model call. The turn's signal aborts it; its events fill `state`. */
async function streamOnce(
  client: Anthropic,
  params: Anthropic.Messages.MessageCreateParamsStreaming,
  signal: AbortSignal,
  deadline: number,
  onText: (delta: string) => void,
  state: CallState,
): Promise<StreamedCall> {
  const stream = client.messages.stream(params, { timeout: Math.max(30_000, deadline - Date.now()) })
  const abortStream = (): void => stream.abort()
  signal.addEventListener("abort", abortStream, { once: true })
  stream.on("text", (delta) => {
    state.wroteToken = true
    onText(delta)
  })
  // KIE states its charge on `message_delta`, which `finalMessage()` does not
  // keep — so it is read off the event itself.
  stream.on("streamEvent", (event) => {
    if (event.type !== "message_delta") return
    state.billed = true
    state.creditsUsd = kieCreditsUsdOf(event) ?? state.creditsUsd
  })
  try {
    return { final: await stream.finalMessage(), creditsUsd: state.creditsUsd }
  } finally {
    signal.removeEventListener("abort", abortStream)
  }
}

/**
 * K13: a KIE model call that failed before any token or charge (a 429, a 5xx,
 * KIE's 400 `api_error`, a stream `error` frame first) is asked again — up to
 * {@link KIE_COPILOT_RETRIES} times, `delayMs` apart. Those attempts cost
 * nothing. A failure after a token or after `message_delta` ends the turn as
 * it always did; tool edits already made stay. No attempt starts past the
 * turn's wall clock or after a cancel.
 */
async function withKieRetry(
  once: (state: CallState) => Promise<StreamedCall>,
  opts: { signal: AbortSignal; deadline: number; delayMs: number },
): Promise<StreamedCall> {
  for (let attempt = 1; ; attempt++) {
    const state = newCallState()
    try {
      return await once(state)
    } catch (err) {
      const exhausted = attempt > KIE_COPILOT_RETRIES
      if (exhausted || state.billed || state.wroteToken || opts.signal.aborted || !kieRetryable(err)) throw err
      if (Date.now() + opts.delayMs >= opts.deadline) throw err
      console.warn(
        `[copilot-kie-retry] attempt ${attempt + 1}/${KIE_COPILOT_RETRIES + 1} in ${opts.delayMs} ms — ` +
          `attempt ${attempt} failed before any token or charge: ${String(err).slice(0, 160)}`,
      )
      await pause(opts.delayMs, opts.signal)
      // A cancel ends the pause early; the next attempt must not start (its
      // stream would never see an abort that already happened).
      if (opts.signal.aborted) throw err
    }
  }
}

/** Wait `ms`, or until the turn is cancelled. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })
  })
}

/**
 * A model call's failure, typed by the lane that raised it (K10). On KIE:
 * `{ lane: "kie", provider: "kie" }`, so a KIE key or balance refusal alerts
 * as KIE and never latches the Anthropic lane. On direct: the Anthropic
 * account's refusal is alerted and latched (a refused key included); when it
 * refused the turn's first call before any token, the turn runner restarts the
 * turn on KIE ({@link CopilotDirectRefusedError}).
 */
function typeLoopFailure(err: unknown, ctx: { lane: CopilotLane; modelId: string; nothingStreamed: boolean }): unknown {
  if (ctx.lane === "kie") return toPlatformExhausted(err, { lane: "kie", provider: "kie", modelId: ctx.modelId })
  const typed = toPlatformExhausted(err, { lane: "direct", provider: "anthropic", modelId: ctx.modelId, latchAuth: true })
  if (typed instanceof LlmPlatformExhaustedError && ctx.nothingStreamed) return new CopilotDirectRefusedError(typed)
  return typed
}

function errorResult(
  toolUseId: string,
  nonce: string,
  toolName: string,
  message: string,
): Anthropic.Messages.ToolResultBlockParam {
  return { type: "tool_result", tool_use_id: toolUseId, content: wrapUntrusted(nonce, toolName, message), is_error: true }
}

/** Anthropic usage fields are disjoint; cache reads/writes are billed off the input rate. */
function accumulateUsage(target: LoopUsage, raw: Anthropic.Messages.Usage, tierRegistryId: string): void {
  const input = raw.input_tokens ?? 0
  const output = raw.output_tokens ?? 0
  const cacheRead = (raw as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0
  const cacheWrite = (raw as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0
  target.inputTokens += input
  target.outputTokens += output
  target.cacheReadTokens += cacheRead
  target.cacheWriteTokens += cacheWrite
  target.costUsd += calculateLlmCost(
    tierRegistryId,
    { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite },
    "direct",
  )
}

/**
 * A KIE call's usage: its reported input/output counts, and none of its cache
 * fields — those are KIE's own injected prefix, not our cache. The cost is the
 * one `kieCostUsd` gave (KIE's charge, or the size estimate).
 */
function accumulateKieUsage(target: LoopUsage, raw: Anthropic.Messages.Usage, costUsd: number): void {
  target.inputTokens += raw.input_tokens ?? 0
  target.outputTokens += raw.output_tokens ?? 0
  target.costUsd += costUsd
}

/**
 * Put a cache breakpoint on the last content block so the whole conversation
 * prefix is read from cache on the next iteration. Without it every iteration
 * re-bills the growing history at the full input rate.
 */
function markLastForCache(messages: Anthropic.Messages.MessageParam[]): Anthropic.Messages.MessageParam[] {
  if (messages.length === 0) return messages
  const last = messages[messages.length - 1]!
  if (typeof last.content === "string") {
    return [
      ...messages.slice(0, -1),
      { ...last, content: [{ type: "text", text: last.content, cache_control: { type: "ephemeral" } }] },
    ] as Anthropic.Messages.MessageParam[]
  }
  const blocks = [...last.content]
  const lastBlock = blocks[blocks.length - 1]
  if (!lastBlock || typeof lastBlock !== "object") return messages
  blocks[blocks.length - 1] = { ...lastBlock, cache_control: { type: "ephemeral" } } as typeof lastBlock
  return [...messages.slice(0, -1), { ...last, content: blocks }] as Anthropic.Messages.MessageParam[]
}
