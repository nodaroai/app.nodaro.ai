/**
 * Look-before-you-pick: the full-size image behind any mention thumbnail —
 * from the picker rows, the browser tiles, a variant, or a chip already in
 * the composer.
 *
 * PORTALED to `document.body` on purpose: every host sits inside a stacking
 * or containing context of its own (the home dock's backdrop-filter glass,
 * the picker's overflow-hidden card), and a `fixed` overlay rendered in place
 * gets trapped there — the exact bug that made the browser modal invisible.
 *
 * Escape handling is idempotent BY DESIGN: hosts that already own a window
 * key handler (the picker, the browser modal) close the preview from their
 * own handler; this component's listener closes it too. Both run — window
 * capture listeners on the same target are not stopped by stopPropagation —
 * and both call the same setState(null), so the double-fire is harmless. For
 * hosts with no key handling (composer chips) this listener is the only one.
 */
import { useEffect } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"

export interface MentionPreviewContent {
  src: string
  label: string
  sub?: string
}

export function MentionPreview({
  content,
  onClose,
  /** Present only pre-insertion — a chip's preview has nothing left to insert. */
  onInsert,
}: {
  content: MentionPreviewContent
  onClose: () => void
  onInsert?: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onClose])

  return createPortal(
    <div role="dialog" aria-modal aria-label={S.pickerPreviewOf(content.label)} className="fixed inset-0 z-[90] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden />
      <div className="relative flex flex-col items-center gap-3 max-w-[88vw]">
        <img
          src={content.src}
          alt={content.label}
          className="max-w-[88vw] max-h-[70vh] object-contain rounded-xl border border-[var(--copilot-strong)] shadow-[0_24px_60px_rgba(0,0,0,0.6)] bg-[var(--copilot-card)]"
        />
        <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-[var(--copilot-card)] border border-[var(--copilot-strong)] shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
          <span className="text-[12.5px] font-medium text-foreground truncate max-w-[40vw]">{content.label}</span>
          {content.sub && <span className="text-[10.5px] text-[var(--copilot-dim)] capitalize whitespace-nowrap">{content.sub}</span>}
          {onInsert && (
            <button
              type="button"
              onClick={onInsert}
              className="px-3 py-[5px] rounded-[8px] bg-primary text-primary-foreground text-[11.5px] font-semibold whitespace-nowrap"
            >
              {S.previewInsert}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={S.previewClose}
            className="w-[24px] h-[24px] rounded-[7px] border border-border text-[var(--copilot-muted)] hover:text-foreground flex items-center justify-center"
          >
            <X className="w-3 h-3" strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
