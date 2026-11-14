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
