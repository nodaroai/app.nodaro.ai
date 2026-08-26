/**
 * The model↔tools loop.
 *
 * Direct Anthropic SDK, not `llm-client`: KIE's Claude proxy mangles
 * `tool_use` (see backend/CLAUDE.md), and this loop needs streamed prose,
 * per-call abort, per-iteration cost accounting and raw block persistence
 * that a single-shot helper cannot express.
 *
 * Everything that bounds the turn lives here: iteration / tool-call / wall
 * clock caps, the USD budget derived from the credit reservation, the
 * identical-call short circuit, and the cancel check before every tool call.
 */
import type Anthropic from "@anthropic-ai/sdk"
import { getAnthropicClient } from "../../lib/anthropic.js"
import { calculateLlmCost } from "../../lib/pricing/llm-cost.js"
import { COPILOT_TIERS, DEFAULT_COPILOT_TIER, TURN_CAPS, type CopilotTierSpec } from "./constants.js"
import { estimateNextCallUsd, wouldExceedBudget, type TurnBudget } from "./budget.js"
import { newUntrustedNonce, wrapUntrusted } from "./untrusted.js"
import { toolLabel } from "./tool-labels.js"
import { dispatchTool, type DispatchDeps, type ToolDefinition } from "./tools/registry.js"
import type { RunProposal } from "./tools/types.js"

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
  proposal?: RunProposal
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
  const client = getAnthropicClient()
  const tier = input.tier ?? COPILOT_TIERS[DEFAULT_COPILOT_TIER]
  const nonce = newUntrustedNonce()
  const deadline = Date.now() + tier.caps.wallClockMs
  const usage: LoopUsage = { ...EMPTY_USAGE }
  const turnMessages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: input.userContent }]
  const callCounts = new Map<string, number>()
  let assistantText = ""
  let iterations = 0
  let toolCalls = 0
  let proposal: RunProposal | undefined

  const finish = (stopReason: LoopStopReason): LoopResult => ({
    stopReason,
    messages: turnMessages,
    assistantText,
    usage,
    iterations,
    toolCalls,
    proposal,
  })

  while (true) {
    if (input.signal.aborted) return finish("cancelled")
    if (iterations >= tier.caps.maxIterations) return finish("capped")
    if (Date.now() > deadline) return finish("capped")

    const messages = [...input.history, ...turnMessages]
    // From the second iteration on the prefix is a cache hit — pricing it at
    // the full input rate would end turns early over money never spent.
    const nextCallUsd = estimateNextCallUsd(tier.registryId, promptChars(input.system, messages), iterations > 0)
    if (wouldExceedBudget(input.budget, usage.costUsd, nextCallUsd)) return finish("budget")

    // Cache breakpoints: the system prefix (stable per process) and the last
    // message (so the growing history is read from cache next iteration).
    const cachedSystem: Anthropic.Messages.TextBlockParam[] = [
      { type: "text", text: input.system, cache_control: { type: "ephemeral" } },
    ]
    const withBreakpoint = markLastForCache(messages)

    const stream = client.messages.stream(
      {
        model: tier.anthropicModelId,
        max_tokens: TURN_CAPS.maxTokensPerCall,
        system: cachedSystem,
        messages: withBreakpoint,
        tools: input.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
        // Economy (Haiku) declares no reasoning efforts — sending one anyway
        // is an API error, so the thinking block rides only with an effort.
        ...(tier.reasoningEffort
          ? { thinking: { type: "adaptive" as const }, output_config: { effort: tier.reasoningEffort } }
          : {}),
      } as unknown as Anthropic.Messages.MessageCreateParamsStreaming,
      { timeout: Math.max(30_000, deadline - Date.now()) },
    )

    const abortStream = (): void => stream.abort()
    input.signal.addEventListener("abort", abortStream, { once: true })
    stream.on("text", (delta) => {
      assistantText += delta
      input.events.onToken(delta)
    })

    let final: Anthropic.Messages.Message
    try {
      final = await stream.finalMessage()
    } catch (err) {
      input.signal.removeEventListener("abort", abortStream)
      if (input.signal.aborted) return finish("cancelled")
      throw err
    }
    input.signal.removeEventListener("abort", abortStream)

    iterations += 1
    accumulateUsage(usage, final.usage, tier.registryId)
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
