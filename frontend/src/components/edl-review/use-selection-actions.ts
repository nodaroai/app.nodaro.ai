import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react"
import type { ReviewEdits } from "@/hooks/use-review-edits"
import type { ReviewModel } from "@/hooks/use-review-model"
import type { ReviewPlayback } from "@/hooks/use-review-playback"
import {
  selectionCutMs,
  selectionRange,
  selectionRestoreMs,
  selectionTouchesCut,
  type WordSelection,
} from "@/lib/edl-review/selection"
import type { WordMark } from "@/lib/edl-review/word-index"
import { toastRestoreLock } from "./span-popover"
import type { TranscriptWords } from "./use-transcript-view"

/**
 * What the selection toolbar does with the selection: Cut and Restore (edits;
 * each clears the selection), Play (the player; the selection stays), and the
 * times its buttons name.
 */
export function useSelectionActions(args: {
  readonly selection: WordSelection | null
  readonly setSelection: Dispatch<SetStateAction<WordSelection | null>>
  readonly model: ReviewModel
  readonly edits: ReviewEdits
  readonly words: TranscriptWords
  readonly marks: readonly WordMark[]
  readonly playback?: ReviewPlayback
}) {
  const { selection, setSelection, model, edits, words, marks, playback } = args

  const cutSelection = useCallback(() => {
    if (!selection) return
    edits.cutSelection(selection)
    setSelection(null)
  }, [edits, selection, setSelection])

  const restoreSelection = useCallback(() => {
    if (!selection) return
    const lock = edits.restoreSelection(selection)
    if (lock) toastRestoreLock(lock)
    setSelection(null)
  }, [edits, selection, setSelection])

  const playSelection = useMemo(() => {
    const range = selection ? selectionRange(selection, words, model.offsetMs) : null
    return range && playback ? () => playback.playRange(range) : undefined
  }, [selection, words, model.offsetMs, playback])

  const touchesCut = selection !== null && selectionTouchesCut(selection, marks)
  const selectionMs = useMemo(() => {
    if (!selection || !edits.kept) return { cut: 0, restore: 0 }
    return {
      cut: selectionCutMs(selection, words, edits.kept, model.offsetMs),
      restore: selectionRestoreMs(selection, words, edits.kept, model.offsetMs),
    }
  }, [selection, words, edits.kept, model.offsetMs])

  return { cutSelection, restoreSelection, playSelection, touchesCut, selectionMs }
}
