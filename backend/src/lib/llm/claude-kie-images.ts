/**
 * An Anthropic-shaped user turn as the KIE Claude wire's blocks, every image
 * INLINE where it fits: KIE's own fetcher fails some image URLs outright while
 * the same bytes sent inline are read every time. `prefetchAsBase64` sizes
 * for the 5 MB per-image cap — a small readable image verbatim, a large or
 * unreadable one re-encoded to JPEG — and hands back the URL only when even
 * the re-encode does not fit or the fetch fails.
 *
 * Used by the callers that move a Claude call to KIE themselves (the film
 * pipelines' `callLLM`, the Copilot's image descriptions). The general
 * client's KIE Claude wire is not changed by it.
 *
 * `signal` (the caller's cancel) reaches every prefetch: a cancel while the
 * images are fetched rejects at once with it.
 */
import type Anthropic from "@anthropic-ai/sdk"
import { prefetchAsBase64 } from "../anthropic-image.js"
import type { LlmContentBlock } from "./types.js"

export async function inlineImagesForClaudeKie(
  blocks: readonly Anthropic.Messages.ContentBlockParam[],
  signal?: AbortSignal,
): Promise<LlmContentBlock[]> {
  return Promise.all(
    blocks.map(async (block): Promise<LlmContentBlock> => {
      if (block.type === "text") return { type: "text", text: block.text }
      if (block.type === "image" && block.source.type === "url") {
        return signal ? prefetchAsBase64(block.source.url, signal) : prefetchAsBase64(block.source.url)
      }
      if (block.type === "image" && block.source.type === "base64") {
        return { type: "image_base64", mediaType: block.source.media_type, data: block.source.data }
      }
      throw new Error(`inlineImagesForClaudeKie: a ${block.type} block has no form on the KIE Claude wire`)
    }),
  )
}
