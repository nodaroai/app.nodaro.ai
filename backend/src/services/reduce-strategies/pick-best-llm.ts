import { LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import { llmComplete, type LlmContentBlock, type LlmMessage } from "../../lib/llm-client.js"
import { EmptyInputError, type StrategyContext, type StrategyResult } from "./types.js"

type Config = { criteria: string; inputKind: "text" | "image-url"; llmModel?: string }

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
  // Track each survivor's ORIGINAL index so the reported selectedIndex is
  // correct even when survivors contain duplicate strings (an indexOf-by-value
  // lookup would collapse duplicates to the first occurrence).
  const survivorIndices: number[] = []
  items.forEach((s, i) => {
    if (s.trim() !== "") survivorIndices.push(i)
  })
  const survivors = survivorIndices.map((i) => items[i]!)
  if (survivors.length === 0) throw new EmptyInputError()

  const messages: LlmMessage[] = config.inputKind === "image-url"
    ? [{ role: "user", content: buildImageContent(survivors, config.criteria) }]
    : [{ role: "user", content: buildTextUserPrompt(survivors, config.criteria) }]

  // The judge model is the user's pick (config.llmModel, validated against
  // LLM_MODEL_IDS at the route) or the feature default. Every model in the
  // registry with image support handles the image-url mode; llmComplete picks
  // the lane per model (direct SDK / KIE) — nothing here is model-specific.
  const modelId = config.llmModel || LLM_FEATURE_DEFAULTS["pick-best-llm"]
  const resp = await llmComplete({
    feature: "pick-best-llm",
    modelId,
    system: SYSTEM_PROMPT,
    messages,
    // Room for a full one-sentence reasoning plus the JSON envelope on the
    // wordier models — 200 truncated some replies mid-sentence into an
    // unparseable JSON, which silently fell back to "first survivor".
    maxTokens: 400,
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
  const originalIndex = survivorIndices[chosenIndex] ?? chosenIndex

  ctx.logger.info({ jobId: ctx.jobId, chosenIndex: originalIndex, reasoning }, "pick-best-llm: chose")

  return {
    result: chosenSurvivor,
    meta: {
      selectedIndex: originalIndex,
      reasoning,
      summary: `Chose #${originalIndex + 1} of ${items.length}: ${reasoning.slice(0, 80)}`,
    },
  }
}
