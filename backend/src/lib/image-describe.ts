/**
 * Shared image-description core — the system prompts and vision-LLM call
 * behind `POST /v1/image-to-text/describe`, extracted so in-process composers
 * (the extension reimagine route) reuse the exact same describe semantics
 * without an HTTP self-call. Route-level concerns (audit job rows, credit
 * reserve/commit, error mapping) stay with each caller.
 */
import { safeFetch } from "./safe-fetch.js"
import {
  llmComplete,
  type LlmContentBlock,
  type LlmRequest,
  type LlmResponse,
} from "./llm-client.js"
import { LLM_ROUTE_DEFAULTS } from "@nodaro/shared"
import { resolveLlmParams, type LlmAdvancedInput } from "./llm-advanced-mode.js"

export type ImageDescribeDetailLevel = "brief" | "detailed" | "structured"

export const IMAGE_DESCRIBE_SYSTEM_PROMPTS: Record<ImageDescribeDetailLevel, string> = {
  brief:
    "You are an image description assistant. Describe the image in 1-2 concise sentences. Focus on the most important visual elements.",
  detailed:
    "You are an image description assistant. Provide a comprehensive description of the image including subjects, setting, colors, lighting, mood, composition, and notable details. Write in flowing prose, 3-6 sentences.",
  structured:
    "You are an image description assistant. Describe the image using these labeled sections:\n- Subject: Main subject(s)\n- Setting: Environment/background\n- Colors: Dominant colors and palette\n- Lighting: Light quality and direction\n- Mood: Overall atmosphere\n- Details: Notable secondary elements\n\nKeep each section to 1-2 sentences.",
}

/**
 * Run the describe vision call. `customPrompt` (when non-empty) replaces the
 * detail-level system prompt, exactly as the route always behaved.
 */
export async function describeImageWithLlm(args: {
  imageUrl: string
  llmModel: string
  detailLevel: ImageDescribeDetailLevel
  customPrompt?: string
  reasoningEffort?: LlmRequest["reasoningEffort"]
  advanced?: LlmAdvancedInput
}): Promise<LlmResponse> {
  const systemPrompt = args.customPrompt || IMAGE_DESCRIBE_SYSTEM_PROMPTS[args.detailLevel]

  // Pre-fetch image to base64 — external CDNs (Instagram, etc.) often block
  // requests from LLM provider IPs, causing empty responses.
  let imageBlock: LlmContentBlock = { type: "image", url: args.imageUrl }
  try {
    // safeFetch: imageUrl is user-supplied (safeUrlSchema-validated), but
    // that's syntactic only. The fetched bytes are base64-encoded and sent to
    // a vision LLM which describes them back to the caller — a read-oracle
    // through text description for any internal endpoint whose response
    // decodes as an image. Use safeFetch so hostnames resolving to private
    // IPs are rejected at connect time.
    const imgResp = await safeFetch(args.imageUrl, { timeoutMs: 30_000 })
    if (imgResp.ok) {
      const buf = Buffer.from(await imgResp.arrayBuffer())
      const mediaType = (imgResp.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim()
      imageBlock = { type: "image_base64", mediaType, data: buf.toString("base64") }
    }
  } catch {
    // Fall back to URL — might still work for public images
  }

  return llmComplete({
    modelId: args.llmModel,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [imageBlock, { type: "text", text: "Describe this image." }],
      },
    ],
    ...resolveLlmParams(args.advanced ?? {}, LLM_ROUTE_DEFAULTS["image-to-text"]),
    reasoningEffort: args.reasoningEffort,
  })
}
