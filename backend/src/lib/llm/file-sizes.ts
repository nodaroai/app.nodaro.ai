/**
 * What a document page is counted as, per model (decided 2026-11-17).
 *
 * Three figures size a document after the hold (the hold itself is one
 * ceiling for every model, `LLM_FILE_PAGE_TOKENS`): the input a call that
 * sent documents is counted at when its reply reports less than they hold
 * (`documentInputFloorTokens`), the size a stopped stream is estimated at
 * (`requestChars`), and the prompt tokens under which an answer was given
 * without its documents (`mediaLaneParams`). Each is a measured figure of one
 * model on one lane, so each is a row here, never a branch on a model's name.
 * A model with no row takes {@link DEFAULT_FILE_SIZES}.
 */

/** A model's document sizes. */
export interface LlmFileSizes {
  /** The fewest input tokens a page is counted at when the reply reports less than its documents. */
  readonly chargePageTokens: number
  /** The fewest input tokens a document is counted at beyond its pages: its name and wrapper. */
  readonly chargeFileTokens: number
  /** Characters a page stands for in the size estimate of a stopped stream (4 a token). */
  readonly estimatePageChars: number
  /**
   * Prompt tokens a page stands for in the not-read floor of the aggregator's
   * lane: an answer that reports fewer was given without the documents and is
   * discarded. Set only for a model whose lane can drop a document and still
   * answer; absent = no floor.
   */
  readonly notReadPageTokens?: number
}

/**
 * GPT-6.1 Terra's figures, measured 2026-11-13: a dense text page about 500
 * input tokens (3 pages, about 1,500), so 600 a page with a margin and 2,000
 * characters a page in the estimate. Its documents ride a part of their own,
 * which the lane does not drop: no not-read floor.
 */
export const DEFAULT_FILE_SIZES: LlmFileSizes = { chargePageTokens: 600, chargeFileTokens: 100, estimatePageChars: 2_000 }

const FILE_SIZES: Readonly<Record<string, LlmFileSizes>> = {
  // A page that was read is never below its image tokens: Google's own API
  // counts 520 image tokens a page before any of the page's text (probed
  // 2026-11-17 on 5-, 14- and 15-page documents), and the aggregator's totals
  // for the same documents matched (13,357 / 28,068 / 19,220 against 13,332 /
  // 28,048 / 19,207). So a scanned or near-blank page still reports about 520.
  // The count and the estimate take that least: 520 a page. The not-read floor
  // sits under it (450): the aggregator's lane dropped every document shape
  // but one with an answer all the same, so an answer below the floor was
  // given without the documents and is discarded, while a read document, even
  // of blank pages, stays above it. Nothing is added per file. Pages with
  // text measured 1,280 to 2,670 a page.
  "gemini-4-hydrogen": { chargePageTokens: 520, chargeFileTokens: 0, estimatePageChars: 520 * 4, notReadPageTokens: 450 },
  // Gemini 4 Neon reads a PDF the same way on the same lane (an `image_url`
  // part), and its one measured document matched Hydrogen's shape: a 2-page
  // PDF of one text line a page reported 1,192 prompt tokens with a 20-token
  // question (2026-11-22) — about 585 a page, over the 520 image tokens a
  // page. One document measured, so Hydrogen's figures are taken, its
  // not-read floor included (the dialect is the one that dropped other
  // document shapes for Hydrogen; not re-probed for Neon).
  "gemini-4-neon": { chargePageTokens: 520, chargeFileTokens: 0, estimatePageChars: 520 * 4, notReadPageTokens: 450 },
}

/** The document sizes of `modelId`: its own row, else {@link DEFAULT_FILE_SIZES}. */
export function llmFileSizes(modelId: string | undefined): LlmFileSizes {
  return (modelId !== undefined && Object.hasOwn(FILE_SIZES, modelId) ? FILE_SIZES[modelId] : undefined) ?? DEFAULT_FILE_SIZES
}
