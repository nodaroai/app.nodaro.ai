import type { LlmReasoningEffort } from "@nodaro/shared/llm-models"

/**
 * Typed request body for `nodes.run("llm-chat", …)` — `POST
 * /v1/llm-chat/generate`: Generate Text, on any LLM. Answers `{ jobId,
 * generatedText }`; the call is charged the tokens it used.
 */
// A type, not an interface: `nodes.run`'s body is a plain record.
export type LlmChatParams = {
  /** Instructions for the model. May be empty. */
  systemPrompt: string
  /** The prompt. */
  userInput: string
  /** A model id (`@nodaro/shared/llm-models`); the feature's default when left out. */
  llmModel?: string
  reasoningEffort?: LlmReasoningEffort
  /** Up to 5 image links. */
  referenceImageUrls?: string[]
  /** Up to 3 video links, on a model that reads video. */
  referenceVideoUrls?: string[]
  /**
   * Frames sampled per second of each reference video: above 0, up to 24.
   * A model reads 1 frame per second when this is left out. More frames of
   * the same clip are more input tokens; a video's sound is read the same
   * at any rate. Only the provider's own API carries a sampling rate, so it
   * needs `advancedMode: true` on a model that reads video (a Gemini
   * model): without it the call answers `400 video_fps_needs_advanced_mode`,
   * and with no video `400 video_fps_without_video`.
   */
  referenceVideoFps?: number
  /** Up to 3 audio links, on a model that reads audio. */
  referenceAudioUrls?: string[]
  /**
   * Up to 5 public links to PDF documents (`LLM_REFERENCE_FILES_MAX`), on a
   * model that reads files (`llmAcceptsFiles`: GPT-6.1 Terra). Up to 6 MB and
   * 100 pages in all. Each file is read and checked before anything is
   * held; a file that is not a PDF, cannot be read, or is past a limit, and
   * any file on another model, answers `400` before any credits are held.
   */
  referenceFileUrls?: string[]
  temperature?: number
  maxTokens?: number
  advancedMode?: boolean
}
