/**
 * Per-wire message/body builders shared by the KIE and direct-Anthropic lanes,
 * and the KIE structured-output (JSON-schema) request fields. The schema's wire
 * form and the prompt-JSON system prompt live in ./structured-schema.ts, which
 * billing reads without loading the lanes.
 */

import type Anthropic from "@anthropic-ai/sdk"
import { structuredWireMode, type LlmModelDef, type LlmReasoningEffort } from "@nodaro/shared/llm-models"
import { KIE_INLINE_DATA_URL_MAX_CHARS } from "../kie-inline-image.js"
import { anthropicStrictToolSchema } from "../json-schema-strict.js"
import { deriveParams } from "./params.js"
import { kieChatPromptJson, kieClaudePromptJson, kiePromptJsonSystem, kieWireSchema } from "./structured-schema.js"
import type { LlmContentBlock, LlmRequest } from "./types.js"

// ---------------------------------------------------------------------------
// Shared message builders
// ---------------------------------------------------------------------------

/** One sentence for every lane that cannot carry a `video_base64` block — which
 *  is every lane except the direct Google one. Named per lane so a stack-free
 *  error still says which wire refused it. */
const INLINE_VIDEO_LANE_ERROR = (lane: string) =>
  `llm-client: the ${lane} lane cannot carry inline video bytes (video_base64) — ` +
  `pin requireLane: "direct" on a model that declares a directGeminiModel`

/**
 * The `data:` URL KIE's OpenAI-shaped lanes (chat-completions, responses) send
 * for an `image_base64` block. Those lanes never send an image URL: KIE
 * answered every image URL there with `code 500: Network error` while the same
 * images inline read fine, so `inlineImagesForKie` (lib/kie-inline-image.ts)
 * fetches each `image` URL and fits each image to the inline limit before
 * these builders run. A block still over the limit here means a call path
 * skipped that step — refuse it rather than send what KIE would reject.
 */
function kieInlineDataUrl(b: Extract<LlmContentBlock, { type: "image_base64" }>, lane: string): string {
  const url = `data:${b.mediaType};base64,${b.data}`
  if (url.length > KIE_INLINE_DATA_URL_MAX_CHARS) {
    throw new Error(
      `llm-client: an image over the ${KIE_INLINE_DATA_URL_MAX_CHARS}-character inline limit reached the ${lane} ` +
        `builder — the request must pass through inlineImagesForKie first`,
    )
  }
  return url
}

/** An image URL has no channel on KIE's OpenAI-shaped lanes (see `kieInlineDataUrl`). */
const KIE_IMAGE_URL_LANE_ERROR = (lane: string) =>
  `llm-client: an image URL reached the ${lane} builder — the request must pass through inlineImagesForKie first`

export function buildChatCompletionsMessages(req: LlmRequest): Array<Record<string, unknown>> {
  const msgs: Array<Record<string, unknown>> = []
  if (req.system) {
    msgs.push({ role: "system", content: req.system })
  }
  for (const m of req.messages) {
    if (typeof m.content === "string") {
      msgs.push({ role: m.role, content: m.content })
    } else {
      const parts = m.content.map((b) => {
        if (b.type === "text") return { type: "text", text: b.text }
        if (b.type === "image_base64") return { type: "image_url", image_url: { url: kieInlineDataUrl(b, "KIE chat-completions") } }
        if (b.type === "image") throw new Error(KIE_IMAGE_URL_LANE_ERROR("KIE chat-completions"))
        // KIE's OpenAI-compat chat-completions proxy forwards ONLY `image_url`
        // content parts and SILENTLY drops `video_url`/`audio_url` (HTTP 200, no
        // error — the model just receives the text parts). Gemini ingests whatever
        // media the URL resolves to, keyed off its MIME type: mp4 → frames + audio
        // track, mp3 → audio. So we route video AND audio refs through `image_url`
        // too — that is the ONLY channel KIE actually delivers. Live-verified via
        // direct curl 2026-07-03 (Gate 0): mp4-as-image_url = 1,972 ingestion
        // tokens w/ correct frames; a 596s/62MB mp4 + `response_format` ingested
        // full-length (heardAudio + accurate last-30s); mp3 = speech transcribed;
        // `video_url`/`audio_url` (object AND string form) = silently dropped.
        // This ONLY applies to the KIE chat-completions (Gemini) wire — the Claude
        // `messages` and GPT `responses` builders still THROW on video/audio, which
        // is correct (those providers genuinely cannot ingest it).
        if (b.type === "video" || b.type === "audio") {
          // A sampling rate cannot survive the URL-smuggling hack: KIE hands
          // Gemini a bare URL and Gemini then samples at its 1 fps default.
          // Throwing beats returning a block that looks accepted — the caller
          // would get analysis grounded in a third of the frames it asked for,
          // with a 200 and no way to tell. Analysis pins `requireLane: "direct"`
          // (toolkit.ts), so this is only reachable by a genuine mistake.
          if (b.type === "video" && b.fps !== undefined) {
            throw new Error(
              `llm-client: video fps=${b.fps} was requested but the KIE lane cannot carry a sampling rate — pin requireLane: "direct"`,
            )
          }
          return { type: "image_url", image_url: { url: b.url } }
        }
        // Inline bytes have no channel here AT ALL: this lane's only media
        // affordance is a URL that KIE dereferences server-side. The router
        // gate (`assertInlineVideoLane`) already refuses such a request before
        // a lane is picked, so reaching this line means a NEW call site built
        // a KIE body directly — throw rather than let the block be dropped or
        // stringified into a text part.
        if (b.type === "video_base64") {
          throw new Error(INLINE_VIDEO_LANE_ERROR("KIE chat-completions"))
        }
        if (b.type === "file_base64") throw new Error(FILE_LANE_ERROR("KIE chat-completions"))
        const _exhaustive: never = b
        return _exhaustive
      })
      msgs.push({ role: m.role, content: parts })
    }
  }
  return msgs
}

export function buildMessagesBody(model: LlmModelDef, req: LlmRequest): Record<string, unknown> {
  const messages = req.messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content }
    }
    const blocks = m.content.map((b) => {
      if (b.type === "text") return { type: "text", text: b.text }
      if (b.type === "image_base64") return { type: "image", source: { type: "base64", media_type: b.mediaType, data: b.data } }
      if (b.type === "image") return { type: "image", source: { type: "url", url: b.url } }
      if (b.type === "video" || b.type === "audio") {
        throw new Error(`Claude messages API does not support ${b.type} input — pick a Gemini model for video/audio refs.`)
      }
      if (b.type === "video_base64") {
        throw new Error(INLINE_VIDEO_LANE_ERROR("Claude messages"))
      }
      if (b.type === "file_base64") throw new Error(FILE_LANE_ERROR("Claude messages"))
      const _exhaustive: never = b
      return _exhaustive
    })
    return { role: m.role, content: blocks }
  })

  const { eff, temperature, topP, maxTokens } = deriveParams(model, req)
  return {
    model: model.kieSlugOrModel,
    max_tokens: maxTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { top_p: topP } : {}),
    // KIE's Claude endpoint documents ONE reasoning switch, `thinkingFlag`
    // (docs.kie.ai/market/claude/claude-opus-5-5.md). The direct lane's
    // `thinking: {type: "adaptive"}` + `output_config: {effort}` made it 503
    // (probed 2026-10-16). The flag is binary, so the effort LEVEL is still not
    // honoured here — which is why routing and billing keep treating an
    // effort-bearing Claude call as direct (KIE_CLAUDE_EFFORT_VERIFIED).
    ...((eff !== undefined && eff !== "none") || req.thinkingFlag === true ? { thinkingFlag: true } : {}),
    // A structured call carries its schema in the system prompt, never as a
    // tool (kieClaudePromptJson says why).
    system: req.jsonSchema && kieClaudePromptJson(model, req) ? kiePromptJsonSystem(req.system, req.jsonSchema) : req.system,
    messages,
  }
}

/**
 * The tool fields of an `anthropic-tool` structured call on the direct SDK —
 * the one-shot call and the stream, so they can never ask differently. KIE's
 * messages proxy is never sent a tool ({@link kieClaudePromptJson}).
 *
 * A model that accepts a forced `tool_choice` gets exactly that — the shape
 * every Claude model before the 5.5 generation has always been sent. One that
 * declares `supportsForcedToolChoice: false` (Sonnet 5.5 / Opus 5.5 400 on a
 * forced choice) is asked with `tool_choice: auto`, an instruction naming the
 * tool appended to the system prompt, and `strict: true` on the tool whenever
 * the schema fits the strict subset (`anthropicStrictToolSchema` withholds the
 * keywords strict mode refuses; a map-shaped schema goes without `strict`).
 * The caller's Zod still validates the answer, so a withheld cap is enforced
 * there, and an answer given as plain JSON text instead of a tool call is read
 * as the response text (see `anthropicToolResponse` / `parseSseStream`).
 *
 * A call that carries a reasoning effort takes the auto shape on EVERY Claude:
 * a forced choice suppresses adaptive thinking (Fable 5, measured 2026-10-09 —
 * high and max answered with no thinking block, in a no-effort call's time),
 * so the effort was inert on exactly the calls that asked for it. Without an
 * effort nothing changes: the forced shape stays byte-identical.
 */
export function anthropicStructuredTool(
  model: LlmModelDef,
  system: string,
  jsonSchema: NonNullable<LlmRequest["jsonSchema"]>,
  { effort }: { effort?: LlmReasoningEffort } = {},
): { tools: Array<Record<string, unknown>>; toolChoice: Record<string, unknown>; system: string } {
  if (model.supportsForcedToolChoice !== false && effort === undefined) {
    return {
      tools: [{ name: jsonSchema.name, description: "Emit the structured result.", input_schema: jsonSchema.schema }],
      toolChoice: { type: "tool", name: jsonSchema.name },
      system,
    }
  }
  const strictSchema = anthropicStrictToolSchema(jsonSchema.schema)
  return {
    tools: [{
      name: jsonSchema.name,
      description: "Emit the structured result.",
      input_schema: strictSchema ?? jsonSchema.schema,
      ...(strictSchema ? { strict: true } : {}),
    }],
    toolChoice: { type: "auto" },
    system: `${system ? `${system}\n\n` : ""}Respond by calling the \`${jsonSchema.name}\` tool exactly once with the complete result. Do not answer in plain text.`,
  }
}

export function buildResponsesInput(req: LlmRequest): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = []
  if (req.system) {
    input.push({ role: "developer", content: req.system })
  }
  for (const m of req.messages) {
    if (typeof m.content === "string") {
      input.push({ role: m.role, content: m.content })
    } else {
      const parts = m.content.map((b) => {
        if (b.type === "text") return { type: "input_text", text: b.text }
        // The same inline-only image channel as chat-completions.
        if (b.type === "image_base64") return { type: "input_image", image_url: kieInlineDataUrl(b, "KIE responses") }
        if (b.type === "image") throw new Error(KIE_IMAGE_URL_LANE_ERROR("KIE responses"))
        if (b.type === "video" || b.type === "audio") {
          throw new Error(`GPT responses API does not support ${b.type} input — pick a Gemini model for video/audio refs.`)
        }
        if (b.type === "video_base64") {
          throw new Error(INLINE_VIDEO_LANE_ERROR("GPT responses"))
        }
        // A document, inline: the one lane that reads one (`input_file`, as
        // `file_data` — KIE's doc names `file_url`; both answered, 2026-11-13).
        if (b.type === "file_base64") {
          return { type: "input_file", filename: b.filename, file_data: `data:${b.mediaType};base64,${b.data}` }
        }
        const _exhaustive: never = b
        return _exhaustive
      })
      input.push({ role: m.role, content: parts })
    }
  }
  return input
}

/**
 * Map a single {@link LlmContentBlock} → Anthropic content block (text + image
 * only; Anthropic vision rejects video/audio). Shared by {@link buildAnthropicMessages}
 * and structured-llm's `toAnthropicContent` so the per-block mapping lives once.
 */
export function llmBlockToAnthropic(b: LlmContentBlock): Anthropic.Messages.ContentBlockParam {
  if (b.type === "text") return { type: "text", text: b.text }
  if (b.type === "image_base64") {
    return { type: "image", source: { type: "base64", media_type: b.mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: b.data } }
  }
  if (b.type === "image") return { type: "image", source: { type: "url", url: b.url } }
  if (b.type === "video_base64") {
    throw new Error(INLINE_VIDEO_LANE_ERROR("Anthropic"))
  }
  if (b.type === "video" || b.type === "audio") {
    throw new Error(`Anthropic does not support ${b.type} input — pick a Gemini model for video/audio refs.`)
  }
  if (b.type === "file_base64") throw new Error(FILE_LANE_ERROR("Anthropic"))
  const _exhaustive: never = b
  return _exhaustive
}

/**
 * A document on a lane that cannot carry one. The routes refuse files on a
 * model without the `file` cap before anything is held (`llmAcceptsFiles`), so
 * reaching a builder that throws this means a new call site skipped that
 * check — throw rather than drop the file and answer about nothing.
 */
export const FILE_LANE_ERROR = (lane: string): string =>
  `llm-client: a document (file_base64) cannot be sent on the ${lane} lane — only a model whose modality caps say \`file\` reads documents`

export function buildAnthropicMessages(req: LlmRequest) {
  return req.messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role as "user" | "assistant", content: m.content }
    }
    return { role: m.role as "user" | "assistant", content: m.content.map(llmBlockToAnthropic) }
  })
}

/**
 * KIE `response_format` for models that natively enforce a JSON schema (Gemini
 * via KIE — live-verified). `strict: false` avoids OpenAI strict-mode's
 * all-keys-required constraint (our schemas carry optional fields); the schema
 * still strongly constrains the shape, and `llmCompleteStructured`'s validate +
 * retry is the actual guarantee. Returns undefined for models with no native
 * mode (GPT-via-KIE ignores response_format) so the caller falls back to text.
 * A model that sends its schema only as a hint (`structuredOutputHint`, read
 * through `structuredWireMode`: Gemini 4 Carbon) is sent it the same way. A
 * `kieSchemaInPrompt` model is sent none: its schema rides the system prompt,
 * in the same wire form (`kieChatPromptJsonFormat`, ./structured-schema.ts).
 *
 * The schema goes on the wire through `kieWireSchema` (./structured-schema.ts).
 */
export function kieResponseFormat(model: LlmModelDef, req: LlmRequest): KieSchemaFormat | undefined {
  if (!req.jsonSchema || structuredWireMode(model) !== "kie-response-format" || kieChatPromptJson(model, req)) return undefined
  const wire = kieWireSchema(req.jsonSchema, model)
  return {
    body: { type: "json_schema", json_schema: { name: req.jsonSchema.name, strict: false, schema: wire.schema } },
    restoreText: wire.restoreText,
  }
}

/** A KIE structured-output request field, and the way its answer text gets back to the caller's names. */
interface KieSchemaFormat {
  body: Record<string, unknown>
  restoreText: (text: string) => string
}

/**
 * KIE responses-API `text` param for models that natively enforce a JSON
 * schema on the {family}/v1/responses endpoints (gpt-5.4/5.5 + the GPT-5.6
 * family — live-verified 2026-07-14; grok-4.6 — live-verified 2026-08-18;
 * text AND vision inputs; the format is
 * echoed back and output arrives schema-shaped). Same `strict: false`
 * rationale as {@link kieResponseFormat}; `llmCompleteStructured`'s
 * validate+retry remains the actual guarantee. Returns undefined for models
 * without the mode. The schema goes on the wire through `kieWireSchema`.
 */
export function kieResponsesTextFormat(model: LlmModelDef, req: LlmRequest): KieSchemaFormat | undefined {
  if (!req.jsonSchema || structuredWireMode(model) !== "responses-json-schema") return undefined
  const wire = kieWireSchema(req.jsonSchema, model)
  return {
    body: { format: { type: "json_schema", name: req.jsonSchema.name, strict: false, schema: wire.schema } },
    restoreText: wire.restoreText,
  }
}
