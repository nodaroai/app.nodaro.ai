/**
 * A structured call's schema as the model reads it: the wire form KIE is sent
 * ({@link kieWireSchema}), the prompt-JSON lanes that carry it in the system
 * prompt instead of a request field, and the text a request's size counts for
 * it ({@link sentSchemaText}).
 *
 * Pure — no lane, no network, no image code — so billing sizes a request from
 * the same text the lanes send (`requestChars`, `llmRequestInputBound`).
 */

import { getLlmModel, LLM_FEATURE_DEFAULTS, llmSendsSchema, type LlmFeature, type LlmModelDef } from "@nodaro/shared/llm-models"
import { extractJsonFromAIResponse } from "../json-utils.js"
import { aliasKeywordPropertyNames } from "../json-schema-property-alias.js"
import { toGeminiResponseSchema } from "../gemini/response-schema.js"
import type { LlmRequest } from "./types.js"

type JsonSchemaField = NonNullable<LlmRequest["jsonSchema"]>

/**
 * Is this a structured Claude call — which KIE's messages lane serves as
 * PROMPT-JSON (the schema in the system prompt, no `tools`), never as a tool?
 *
 * Probed 2026-10-16 against KIE's /claude/v1/messages, which documents only
 * model, messages, tools, thinkingFlag, stream and max_tokens:
 * - image + ANY tool: in KIE's documented shape (no system, no tool_choice) a
 *   503 every time; with system + tool_choice a 200 whose model never saw the
 *   image ("I don't see a photo") — production describe-to-picker job
 *   1572a638 completed with `{}` that way, and was billed;
 * - text-only + tool, in the shape `anthropicStructuredTool` sends (system +
 *   tool_choice): Opus 5.5 503s in every variant, Haiku 4.5 and Sonnet 4.6
 *   answer a 200 carrying an in-band "Server exception" — so text-only
 *   structured calls take the same route;
 * - no tools, schema in `system`: clean JSON in ~5 s, text-only and with an
 *   image (URL or base64) read correctly, with or without thinkingFlag.
 * The answer is plain text; the structured loop's parse (fences stripped),
 * Zod validation and correction retry are what make it an answer. The direct
 * lane keeps its tool (`anthropicStructuredTool`).
 */
export function kieClaudePromptJson(model: LlmModelDef, req: LlmRequest): boolean {
  return req.jsonSchema !== undefined && model.structuredOutputMode === "anthropic-tool"
}

/**
 * Is this a structured call that KIE's chat-completions lane serves as
 * PROMPT-JSON (the schema in the system prompt, no `response_format`)? For a
 * model whose KIE endpoint fails any request carrying `response_format`
 * (`kieSchemaInPrompt`: Gemini 3.8 Flash, and 3.7 Flash, served by the same
 * endpoint). The prompt carries the schema in the wire form that field sent
 * ({@link kieChatPromptJsonFormat}); the answer is plain text, put back under
 * the caller's names, and the structured loop's parse (fences stripped), Zod
 * validation and correction retry make it an answer, as for
 * {@link kieClaudePromptJson} — with one ask on the direct lane when KIE's
 * answers never validate (`directLaneBackup`, structured.ts). The direct lane
 * is unaffected: it keeps the model's enforced `responseJsonSchema`.
 */
export function kieChatPromptJson(model: LlmModelDef, req: LlmRequest): boolean {
  return req.jsonSchema !== undefined && model.kieSchemaInPrompt === true
}

/**
 * The system prompt of a {@link kieClaudePromptJson} or {@link kieChatPromptJson}
 * call: the caller's, then the one-object rule and `jsonSchema.schema` (the
 * form the lane sends — the caller's own on the Claude lane, the wire form on
 * the chat-completions one).
 */
export function kiePromptJsonSystem(system: string, jsonSchema: JsonSchemaField): string {
  return [
    system,
    `Reply with ONLY one JSON object — the \`${jsonSchema.name}\` result — that matches this JSON Schema exactly. ` +
      "No prose before or after it, and no markdown code fences.",
    JSON.stringify(jsonSchema.schema),
  ].filter(Boolean).join("\n\n")
}

/** A prompt-JSON answer's JSON, with a ```json fence or surrounding prose removed (the model sometimes adds one). */
export function kiePromptJsonText(text: string): string {
  return extractJsonFromAIResponse(text)
}

/**
 * The caller's schema as KIE is sent it: in its JSON-schema request fields
 * (`response_format`, the responses lane's `text.format`) and in the prompt of
 * a {@link kieChatPromptJson} call.
 *
 * KIE's chat-completions validator reads a property NAMED like a keyword
 * (`type`) as that keyword and refuses the request
 * (`json-schema-property-alias.ts`), so such a property is sent under a wire
 * name, and `restoreText` puts the caller's name back on the answer before
 * anything reads it. The responses lane gets the same wire form: the rename is
 * invisible to the caller either way, so no lane is left to fail on a validator
 * we have not seen yet. A schema with no such name is sent as it is. The
 * request is never changed: a fallback lane reads the caller's schema from the
 * same `req`.
 */
export function kieWireSchema(jsonSchema: JsonSchemaField, model: LlmModelDef): {
  schema: Record<string, unknown>
  restoreText: (text: string) => string
} {
  const wire = aliasKeywordPropertyNames(jsonSchema.schema)
  // KIE forwards a Google model's schema to Google's own decoder, which
  // refuses an array cap and a schema with too many enum ids exactly as it
  // does on the direct lane (`gemini/response-schema.ts`) — the proxy adds no
  // tolerance. The same wire form keeps the two lanes from failing apart;
  // the rewrite never touches property names, so the alias restore still holds.
  const schema = model.vendor === "google" ? (toGeminiResponseSchema(wire.schema) as Record<string, unknown>) : wire.schema
  return {
    schema,
    restoreText: wire.aliases.size === 0 ? (text) => text : (text) => restoreAnswerText(text, wire.restore),
  }
}

/** An answer's text under the caller's names. Text that is not JSON is returned
 *  as the model wrote it, for the caller's own parse to judge. */
function restoreAnswerText(text: string, restore: (value: unknown) => unknown): string {
  let answer: unknown
  try {
    answer = JSON.parse(extractJsonFromAIResponse(text))
  } catch {
    return text
  }
  return JSON.stringify(restore(answer))
}

/** What a prompt-JSON call sends in place of the caller's system prompt, and how its answer gets back. */
export interface PromptJsonFormat {
  /** The system prompt sent: the caller's, the one-object rule and the schema. */
  system: string
  /** The answer as the caller's JSON: any fence or prose removed, then the caller's names put back. */
  restoreText: (text: string) => string
}

/**
 * The system prompt of a {@link kieChatPromptJson} call and the way its answer
 * gets back to the caller's names, or undefined for any other request.
 *
 * The schema goes in as the wire form the lane's `response_format` sent
 * ({@link kieWireSchema}): keyword-named properties under their wire names
 * (restored on the answer, so it still validates against the caller's schema)
 * and, on a Google model, the compact form whose largest enum lists are
 * withheld over Google's budget — a caller with a catalog that size names
 * its ids in its own prompt (describe-to-picker's legend), so the full schema
 * would only send them twice.
 */
export function kieChatPromptJsonFormat(model: LlmModelDef, req: LlmRequest): PromptJsonFormat | undefined {
  if (!req.jsonSchema || !kieChatPromptJson(model, req)) return undefined
  const wire = kieWireSchema(req.jsonSchema, model)
  return {
    system: kiePromptJsonSystem(req.system, { name: req.jsonSchema.name, schema: wire.schema }),
    // Fence first: with no alias the restore is the identity and would keep it.
    restoreText: (text) => wire.restoreText(kiePromptJsonText(text)),
  }
}

/**
 * Characters of prompt-JSON text counted as one token when the media floor is
 * raised ({@link kiePromptJsonFloorRequest}). Deliberately a little BELOW the
 * density measured on a real Video Analysis prompt (about 4.4 characters per
 * token), so the raise runs a little high: the guard never weakens, and a reply
 * that never saw the media cannot slip under the floor on the schema text alone.
 */
const PROMPT_JSON_FLOOR_CHARS_PER_TOKEN = 4

/**
 * The request as the media fail-open guard (`assertMediaIngested`) reads it on a
 * {@link kieChatPromptJson} call, whose sent system prompt is `sentSystem`. The
 * schema and the one-object rule now ride the prompt, so even a reply that never
 * saw the media reports that many more prompt tokens; the caller's
 * `minPromptTokens` is raised by them (estimated a little high), so the floor
 * sits at least as far above a media-less prompt as the caller set it. A
 * request with no floor is returned as it is.
 */
export function kiePromptJsonFloorRequest(req: LlmRequest, sentSystem: string): LlmRequest {
  if (req.minPromptTokens === undefined) return req
  const added = sentSystem.length - req.system.length
  return { ...req, minPromptTokens: req.minPromptTokens + Math.floor(added / PROMPT_JSON_FLOOR_CHARS_PER_TOKEN) }
}

/**
 * The schema text a structured call sends, as a request's size counts it
 * (`requestChars`, `llmRequestInputBound`): "" with no schema, or when the
 * model's calls send none (`llmSendsSchema`).
 *
 * On a model whose KIE lane carries the schema in the system prompt, what that
 * prompt adds to the caller's: the one-object rule and the schema as sent —
 * the compact wire form on a {@link kieChatPromptJson} model (the form Google's
 * own lane is sent too), the caller's own on a {@link kieClaudePromptJson} one.
 * Every other model counts the caller's schema as JSON, as before.
 */
export function sentSchemaText(req: LlmRequest): string {
  const jsonSchema = req.jsonSchema
  if (!jsonSchema || !llmSendsSchema(req.modelId, req.feature)) return ""
  const id = req.modelId || (req.feature ? LLM_FEATURE_DEFAULTS[req.feature as LlmFeature] : undefined)
  const model = id ? getLlmModel(id) : undefined
  const promptJson = model && kieChatPromptJson(model, req)
    ? kieChatPromptJsonFormat(model, req)?.system
    : model && kieClaudePromptJson(model, req) ? kiePromptJsonSystem(req.system, jsonSchema) : undefined
  return promptJson === undefined ? JSON.stringify(jsonSchema.schema) : promptJson.slice(req.system.length)
}
