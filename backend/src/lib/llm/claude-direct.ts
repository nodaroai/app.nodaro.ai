/**
 * Which Claude calls KIE cannot honour, so the router serves them direct even
 * unpinned. Pure — it imports only the shared registry — so the billing code
 * (`lib/pricing/llm-cost.ts :: llmPrimaryLane`) prices the lane the router
 * picks from the SAME rule, without loading a lane or the config.
 */
import { effectiveReasoningEffort, type LlmModelDef } from "@nodaro/shared/llm-models"
import type { LlmRequest } from "./types.js"

// KIE Claude-proxy passthrough facts. When false, the affected request class
// routes direct-Anthropic instead of through KIE.
// KIE's Claude proxy accepts `thinking` / `output_config.effort` and IGNORES
// them — measured 2026-10-08 on a reasoning-heavy prompt across Sonnet 5.5,
// Opus 5.5 and Sonnet 4.6: `low`, `max` and no effort gave the same output
// length (±15%), and no thinking block came back even at `max`. So an
// effort-carrying Claude call is served direct, and bills that way: the
// registry marks these models `effortRequiresDirect`, which `llmServesDirect`
// (@nodaro/shared) turns into the credit rung.
// Re-measured 2026-10-16: sending those fields now makes KIE 503; its documented
// switch is `thinkingFlag`, which is binary, so the LEVEL is still not
// honoured — buildMessagesBody sends the flag, and this stays false.
const KIE_CLAUDE_EFFORT_VERIFIED = false
// "Can KIE serve a structured Claude call?" Yes — but NOT as a tool: since
// 2026-10-16 KIE's messages lane sends every structured Claude call as
// prompt-JSON (`kieClaudePromptJson` in ./message-builders.ts says why: a tool
// 503s, or answers without having seen the image). Before that, a forced
// tool came back as a malformed `<tool_calls>` pseudo-tag (live-captured
// 2026-07-14), which callKieMessages still decodes if it ever reappears.
const KIE_CLAUDE_TOOLS_VERIFIED = true

/**
 * A Claude call KIE cannot honour, so it is served direct even unpinned: one
 * carrying a reasoning effort (KIE ignores it — see KIE_CLAUDE_EFFORT_VERIFIED;
 * `llmServesDirect` bills the same call one rung up), or a structured call
 * while KIE's tool passthrough is unverified. Direct is still only the
 * PRIMARY lane here: a direct failure falls back to KIE.
 */
export function claudeMustServeDirect(model: LlmModelDef, req: Pick<LlmRequest, "reasoningEffort" | "jsonSchema">): boolean {
  const eff = effectiveReasoningEffort(model.id, req.reasoningEffort)
  return (
    (eff !== undefined && !KIE_CLAUDE_EFFORT_VERIFIED) ||
    (req.jsonSchema !== undefined && model.structuredOutputMode === "anthropic-tool" && !KIE_CLAUDE_TOOLS_VERIFIED)
  )
}
