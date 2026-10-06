/**
 * What the transcript pane shows of the edit as it stands (§2.3 of the
 * inspectors design), derived from the review model and K:
 *  - `shown`: the edit (`buildEdited`, the reviewer's K), or the plan as
 *    received when it cannot be edited here (read-only);
 *  - `wordIndex`: each word kept, partial or cut, and why (`buildWordIndex`);
 *  - `rows`: the paragraphs, with long cuts collapsed (R11, `buildReviewRows`);
 *  - `cutsOnly`: with no transcript (R5 a), the kept segments and dropped spans
 *    by time instead of words;
 *  - `findIndex`: the words folded once for ⌘F.
 * Each is memoised on what it reads, so a cut rebuilds the marks and rows once.
 */
import { useMemo } from "react"
import type { Edl, Transcript } from "@nodaro/shared"
import { buildFindIndex, type FindIndex } from "@/lib/edl-review/find"
import { buildCutsOnlyRows, buildReviewRows, type CutsOnlyRow, type ReviewRow, type WordSpan } from "@/lib/edl-review/review-rows"
import { buildWordIndex, type WordIndex } from "@/lib/edl-review/word-index"
import type { ReviewEdits } from "@/hooks/use-review-edits"
import type { ReviewModel } from "@/hooks/use-review-model"

export type TranscriptWords = Transcript["words"]

export interface TranscriptView {
  readonly shown: Edl | null
  readonly words: TranscriptWords
  readonly wordIndex: WordIndex | null
  readonly rows: readonly ReviewRow[]
  readonly cutsOnly: readonly CutsOnlyRow[] | null
  readonly findIndex: FindIndex | null
}

const NO_WORDS: TranscriptWords = []

export function useTranscriptView(model: ReviewModel, edits: ReviewEdits, expanded: readonly WordSpan[]): TranscriptView {
  const { base, transcript, paragraphs, offsetMs } = model
  const shown = edits.edited ?? base
  const words = transcript?.words ?? NO_WORDS
  const wordIndex = useMemo(() => (shown && transcript ? buildWordIndex(shown, transcript) : null), [shown, transcript])
  const rows = useMemo(
    () => (shown && wordIndex ? buildReviewRows({ paragraphs, wordIndex, words, offsetMs, edited: shown, expanded }) : []),
    [shown, wordIndex, paragraphs, words, offsetMs, expanded],
  )
  const cutsOnly = useMemo(() => (shown && !transcript ? buildCutsOnlyRows(shown) : null), [shown, transcript])
  const findIndex = useMemo(() => (transcript ? buildFindIndex(transcript.words) : null), [transcript])
  return { shown, words, wordIndex, rows, cutsOnly, findIndex }
}
