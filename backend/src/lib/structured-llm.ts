import type Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { getAnthropicClient } from "./anthropic.js"
import { restrictObjectSchemas } from "./json-schema-strict.js"
import { llmBlockToAnthropic, type LlmContentBlock } from "./llm-client.js"

export interface StructuredLlmArgs<T> {
  schema: z.ZodType<T, unknown>
  /** Anthropic SDK model id (use the model's directFallbackModel). */
  modelId: string
  system: string
  content: LlmContentBlock[]
  toolName?: string
  maxRetries?: number
  maxTokens?: number
}

export interface StructuredLlmResult<T> {
  output: T
  inputTokens: number
  outputTokens: number
}

/** Map our LlmContentBlock shape → Anthropic content blocks (text + image). */
function toAnthropicContent(blocks: LlmContentBlock[]): Anthropic.Messages.ContentBlockParam[] {
  return blocks.map(llmBlockToAnthropic)
}

/**
 * Forced single-tool structured output against Anthropic. Builds a JSON-Schema
 * (draft-7 — Anthropic rejects OpenAPI nullable) tool, forces tool_choice,
 * extracts tool_use.input, Zod-validates, and retries with the error appended.
 * Stateless: no audit row, no cost table, no pipeline signal.
 */
export async function callStructuredLlm<T>(args: StructuredLlmArgs<T>): Promise<StructuredLlmResult<T>> {
  const toolName = args.toolName ?? "emit"
  const retries = Math.max(0, args.maxRetries ?? 2)
  const anthropic = getAnthropicClient()

  // Draft-7: Anthropic's Messages API rejects OpenAPI extensions like nullable.
  // io:"input" mirrors zod-to-json-schema's semantics: defaulted fields stay
  // optional in the schema the LLM sees (it emits the INPUT side of the schema).
  const jsonSchema = restrictObjectSchemas(
    z.toJSONSchema(args.schema, { target: "draft-7", unrepresentable: "any", io: "input" }) as Record<string, unknown>,
  )
  delete jsonSchema.$schema
  const toolDef: Anthropic.Messages.Tool = {
    name: toolName,
    description: "Emit the structured result.",
    input_schema: jsonSchema as Anthropic.Messages.Tool.InputSchema,
  }
  const baseContent = toAnthropicContent(args.content)

  let lastError = ""
  for (let attempt = 0; attempt <= retries; attempt++) {
    const content: Anthropic.Messages.ContentBlockParam[] =
      attempt === 0
        ? baseContent
        : [...baseContent, { type: "text", text: `Your previous attempt failed validation:\n${lastError}\nRetry, honoring the schema strictly.` }]

    const resp: Anthropic.Messages.Message = await anthropic.messages.create({
      model: args.modelId,
      max_tokens: args.maxTokens ?? 4096,
      system: [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } }],
      tools: [toolDef],
      tool_choice: { type: "tool", name: toolName } as const,
      messages: [{ role: "user", content }],
    })

    const toolUse = resp.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    )
    if (!toolUse) {
      lastError = "Model did not call the tool."
      continue
    }
    const parsed = args.schema.safeParse(toolUse.input)
    if (!parsed.success) {
      lastError = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      continue
    }
    return {
      output: parsed.data,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
    }
  }
  throw new Error(`structured-llm: validation failed after ${retries + 1} attempts: ${lastError}`)
}
