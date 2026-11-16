/**
 * Where an LLM call that carries a video or an audio reference runs, and how a
 * reference the model never read is caught.
 *
 * The default (aggregator) lane hands a video or audio link to the model for it
 * to fetch, and FAILS OPEN: it sometimes answers without having read the file,
 * with a fluent description of media that does not exist (see
 * `LlmRequest.minPromptTokens`; seen again on production 2026-11-16, three
 * calls of three). The vendor's own API fetches the file itself and fails
 * loudly when it cannot (`lib/gemini/media.ts`), so:
 *
 *  - a Gemini call with a video or audio reference is PINNED to the vendor's
 *    own API when this install can serve it there (a Gemini key, and metered
 *    pricing, which holds and charges by the lane that serves);
 *  - any other such call keeps its lane and carries a floor of prompt tokens:
 *    an answer reported below it was made without the media and is discarded
 *    (`assertMediaIngested`). The floor is deliberately low, so it never fails
 *    a call that read its media; with a long prompt it cannot tell the two
 *    apart, which is why the pin comes first.
 *
 * A run kept to the cheap lanes (`cheapLanesOnly`) is never moved to the
 * vendor's API: it keeps the floor. Advanced mode pins the lane itself.
 */
import { getLlmModel } from "@nodaro/shared/llm-models"
import { llmMeteredPricing } from "./config.js"
import { geminiKeySet } from "./llm/anthropic-availability.js"
import type { LlmRequest } from "./llm/types.js"

/** The fewest prompt tokens one video stands for: under one frame of the smallest clip measured. */
export const MEDIA_FLOOR_VIDEO_TOKENS = 60
/** The fewest prompt tokens one audio clip stands for: under one second of sound. */
export const MEDIA_FLOOR_AUDIO_TOKENS = 20
/** Characters per token the floor counts text at: far above the real ~4, so the text never lifts the floor past what was sent. */
export const MEDIA_FLOOR_CHARS_PER_TOKEN = 8

/** What the person reads when the model answered without its media. */
export const MEDIA_NOT_READ_MESSAGE =
  "The model answered without reading the video or audio you sent, so the answer was discarded. Run it again, or turn Advanced mode on."
export const MEDIA_NOT_READ_CODE = "media_not_ingested"

export function mediaLaneParams(input: {
  modelId: string
  videos?: readonly string[]
  audios?: readonly string[]
  /** The text sent with the media (system prompt and user input). */
  text: readonly string[]
  cheapLanesOnly?: boolean
}): Pick<LlmRequest, "requireLane" | "minPromptTokens"> {
  const videos = input.videos?.length ?? 0
  const audios = input.audios?.length ?? 0
  if (videos + audios === 0) return {}
  const model = getLlmModel(input.modelId)
  if (model?.directGeminiModel && geminiKeySet() && llmMeteredPricing() && input.cheapLanesOnly !== true) {
    return { requireLane: "direct" }
  }
  const chars = input.text.reduce((n, t) => n + t.length, 0)
  return {
    minPromptTokens: Math.floor(chars / MEDIA_FLOOR_CHARS_PER_TOKEN) + videos * MEDIA_FLOOR_VIDEO_TOKENS + audios * MEDIA_FLOOR_AUDIO_TOKENS,
  }
}

/** Whether `err` is the client's "answered without its media" refusal (`assertMediaIngested`). */
export function isMediaNotRead(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("media_not_ingested:")
}
