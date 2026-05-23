import { llmComplete, type LlmContentBlock, type LlmMessage } from "../../lib/llm-client.js"
import { filterSurvivors } from "./_normalize.js"
import { EmptyInputError, type StrategyContext, type StrategyResult } from "./types.js"

type Config = { criteria: string; inputKind: "text" | "image-url" }

const SYSTEM_PROMPT = "You are judging candidate outputs against criteria. Respond with strict JSON only — no prose, no markdown fences."

function buildTextUserPrompt(items: string[], criteria: string): string {
  const lines = items.map((s, i) => `  [${i + 1}] ${s}`).join("\n")
  return [
    `Criteria: ${criteria}`,
    "Candidates:",
    lines,
    `Reply with JSON: { "chosen_index": <1-based 1..${items.length}>, "reasoning": "<one sentence>" }`,
  ].join("\n")
}

function buildImageContent(items: string[], criteria: string): LlmContentBlock[] {
  const content: LlmContentBlock[] = [
    { type: "text", text: `Criteria: ${criteria}` },
  ]
  items.forEach((url, i) => {
    content.push({ type: "text", text: `Candidate ${i + 1}:` })
    content.push({ type: "image", url })
  })
  content.push({
    type: "text",
    text: `Reply with JSON: { "chosen_index": <1-based 1..${items.length}>, "reasoning": "<one sentence>" }`,
  })
  return content
}

export async function execute(
  items: string[],
  config: Config,
  ctx: StrategyContext,
): Promise<StrategyResult<string>> {
  const survivors = filterSurvivors(items)
  if (survivors.length === 0) throw new EmptyInputError()

  const messages: LlmMessage[] = config.inputKind === "image-url"
    ? [{ role: "user", content: buildImageContent(survivors, config.criteria) }]
    : [{ role: "user", content: buildTextUserPrompt(survivors, config.criteria) }]

  // Sonnet 4.6 has directFallbackModel: "claude-sonnet-4-6" in @nodaro/shared
  // llm-models.ts, so llmComplete() routes via the direct Anthropic SDK path
  // (which supports image content blocks) instead of the KIE proxy.
  const resp = await llmComplete({
    feature: "ai-writer",
    modelId: "claude-sonnet-4.6",
    system: SYSTEM_PROMPT,
    messages,
    maxTokens: 200,
  })

  let chosenIndex = 0
  let reasoning = "fallback: first survivor (LLM response unparseable)"
  try {
    const parsed = JSON.parse(resp.text)
    const ci = Number((parsed as { chosen_index?: unknown }).chosen_index)
    if (Number.isInteger(ci) && ci >= 1 && ci <= survivors.length) {
      chosenIndex = ci - 1
      reasoning = String((parsed as { reasoning?: unknown }).reasoning ?? "")
    } else {
      reasoning = "fallback: first survivor (chosen_index out of range)"
    }
  } catch {
    /* fall through to fallback */
  }

  const chosenSurvivor = survivors[chosenIndex]
  const originalIndex = items.indexOf(chosenSurvivor)

  ctx.logger.info({ jobId: ctx.jobId, chosenIndex: originalIndex, reasoning }, "pick-best-llm: chose")

  return {
    result: chosenSurvivor,
    meta: {
      selectedIndex: originalIndex,
      reasoning,
      summary: `Sonnet picked item ${originalIndex + 1} of ${items.length}: ${reasoning.slice(0, 80)}`,
    },
  }
}
