/**
 * What a Claude call served by KIE cost: KIE's own charge when the reply
 * stated it, else an estimate from the SIZE of the request and the answer at
 * the KIE rate table. Never from KIE's reported `input_tokens`: on its Claude
 * wires that count leaves out the caller's own prompt (a few tokens for a
 * long request), so a cost read from it is close to nothing whatever was sent.
 */
import { getLlmModel } from "@nodaro/shared/llm-models"
import { calculateLlmCost } from "../pricing/llm-cost.js"
import type { LlmFailureUsage } from "../llm-errors.js"
import { extractActualUsd } from "./response.js"
import { sentSchemaText } from "./structured-schema.js"
import type { LlmRequest } from "./types.js"

/** Characters one image stands for in the size estimate — about 1,600 tokens at 4 characters a token. */
export const KIE_IMAGE_ESTIMATE_CHARS = 6_400

/**
 * Characters one page of a document stands for in the size estimate — about
 * 500 tokens, what a dense text page measured on GPT-6.1 Terra (2026-11-13).
 * An estimate of what was spent (a stopped stream), not the hold's ceiling
 * (`LLM_FILE_PAGE_TOKENS`).
 */
export const KIE_FILE_PAGE_ESTIMATE_CHARS = 2_000

/**
 * The fewest input tokens a document page is charged at when the reply states
 * no charge and reports less input than its documents (a stream's reply may
 * carry no stated charge, and a document call has reported 0 input): about
 * 500 a page measured on GPT-6.1 Terra (2026-11-13: 3 dense text pages, about
 * 1,500 tokens), plus a margin. The measured rate, never the hold's ceiling
 * (`LLM_FILE_PAGE_TOKENS`).
 */
export const LLM_FILE_CHARGE_PAGE_TOKENS = 600

/** The fewest input tokens a document is charged at beyond its pages: its name and wrapper. */
export const LLM_FILE_CHARGE_FILE_TOKENS = 100

/**
 * The fewest input tokens a call that sent documents is charged at when its
 * reply states no charge (decided 2026-11-13): its documents at the measured
 * rate ({@link LLM_FILE_CHARGE_PAGE_TOKENS} a page,
 * {@link LLM_FILE_CHARGE_FILE_TOKENS} a file) plus its text's size estimate
 * (system prompt, the schema as sent, text: chars ÷ 4). 0 for a call with no
 * document, which is never floored.
 */
export function documentInputFloorTokens(req: LlmRequest): number {
  let files = 0
  let pages = 0
  let textChars = req.system.length + sentSchemaText(req).length
  for (const message of req.messages) {
    if (typeof message.content === "string") {
      textChars += message.content.length
      continue
    }
    for (const block of message.content) {
      if (block.type === "file_base64") {
        files++
        pages += block.pages
      } else if (block.type === "text") textChars += block.text.length
    }
  }
  if (files === 0) return 0
  return files * LLM_FILE_CHARGE_FILE_TOKENS + pages * LLM_FILE_CHARGE_PAGE_TOKENS + kieInputTokens(textChars)
}

/**
 * The models whose KIE endpoint reports a top-level `usage.input_tokens: 0`
 * (GPT-6 on codex/v1/responses, measured 2026-10-08 — the real counts sit in
 * `usage.attribution`). Named one by one, never by an id prefix: GPT-6.1 Terra
 * shares the endpoint and the `gpt-6` prefix but reports its real input count,
 * the instructions KIE adds included (measured 2026-11-12), so costing it from
 * the request's size would leave those billed tokens out.
 */
const KIE_INPUT_UNREPORTED: ReadonlySet<string> = new Set(["gpt-6-astra", "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol"])

/**
 * Whether KIE's reported INPUT token count for `modelId` cannot be billed
 * from: its Claude wires leave the caller's own prompt out of the count (a few
 * tokens for a long request), and its GPT-6 endpoint reports a top-level
 * `input_tokens: 0` for the models in {@link KIE_INPUT_UNREPORTED}. Such a call
 * is costed from the request's size (`requestChars ÷ 4`) when KIE stated no
 * charge (`kieCostUsd`). Its OUTPUT count is sound and is used as is.
 */
export function kieInputUntrusted(modelId: string): boolean {
  const model = getLlmModel(modelId)
  if (!model) return false
  return model.vendor === "anthropic" || KIE_INPUT_UNREPORTED.has(model.id)
}

/**
 * The request's size in characters: system prompt, schema as it is sent (only
 * when the model's calls send it — `sentSchemaText`, which counts a prompt-JSON
 * call's one-object rule and the schema's wire form), text,
 * {@link KIE_FILE_PAGE_ESTIMATE_CHARS} per document page and
 * {@link KIE_IMAGE_ESTIMATE_CHARS} per other media block.
 */
export function requestChars(req: LlmRequest): number {
  let chars = req.system.length + sentSchemaText(req).length
  for (const message of req.messages) {
    if (typeof message.content === "string") {
      chars += message.content.length
      continue
    }
    for (const block of message.content) {
      chars += block.type === "text" ? block.text.length : block.type === "file_base64" ? block.pages * KIE_FILE_PAGE_ESTIMATE_CHARS : KIE_IMAGE_ESTIMATE_CHARS
    }
  }
  return chars
}

/**
 * The input token count recorded for a KIE Claude call (`llm_calls`,
 * `copilot_turns`): the size estimate (chars ÷ 4, rounded up) — KIE's own
 * count leaves out the caller's prompt.
 */
export function kieInputTokens(promptChars: number): number {
  return Math.ceil(promptChars / 4)
}

/**
 * KIE's charge (`creditsUsd`) when known, else the size estimate (chars ÷ 4) at
 * the KIE rates of `modelId` (a registry id). A BILLING input (Copilot, the
 * pipelines, the metered settle): a model with no KIE rate throws
 * `LlmRateMissingError` rather than costing the call $0 — a caller that only
 * logs the figure catches that error itself.
 */
export function kieCostUsd(modelId: string, opts: { creditsUsd?: number; promptChars: number; answerChars: number }): number {
  if (opts.creditsUsd !== undefined) return opts.creditsUsd
  return calculateLlmCost(
    modelId,
    { inputTokens: kieInputTokens(opts.promptChars), outputTokens: Math.ceil(opts.answerChars / 4) },
    "kie",
  )
}

/**
 * What a KIE Claude call that failed AFTER it was billed (a refusal, a cut-off
 * answer, an error after usage) cost: KIE's stated charge when the failure
 * carried one, else the size estimate — the prompt's size, and the answer
 * sized from KIE's reported output count (that count is sound; only its input
 * count is not). Never the failure's `providerCost` alone, which without a
 * stated charge is the rate-table figure from KIE's input count.
 */
export function kieFailureCostUsd(modelId: string, usage: LlmFailureUsage, promptChars: number): number {
  return kieCostUsd(modelId, { creditsUsd: usage.creditsUsd, promptChars, answerChars: usage.outputTokens * 4 })
}

/**
 * KIE's charge (USD) from one SSE event of its Anthropic-compatible
 * `/anthropic` wire. The field arrives on `message_delta`; it is read at the
 * event's top level first (where the `/claude` wire puts it), then inside
 * `usage`, then inside `delta`.
 */
export function kieCreditsUsdOf(event: unknown): number | undefined {
  if (!event || typeof event !== "object") return undefined
  const e = event as { usage?: unknown; delta?: unknown }
  const nested = (value: unknown): number | undefined =>
    value && typeof value === "object" ? extractActualUsd(value) : undefined
  return extractActualUsd(e) ?? nested(e.usage) ?? nested(e.delta)
}
