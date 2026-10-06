"use client"

/**
 * The span popover (M3 of the inspectors design): what a struck word, a reason
 * chip or a pause chip opens. It names the dropped span — reason · in → out ·
 * length — and offers:
 *  - ↺ Restore, or, when the render rule would refuse the restored edit, 🔒
 *    "Can't restore: {label}" with the rule's own messages (left to right);
 *    the lock is judged once, when the popover opens (`canRestore`);
 *  - Restore all {n} of the reason, which leaves the locked spans cut and says
 *    how many.
 * While edits are locked (R9 a) or the plan cannot be edited here, it only
 * names the span. A Radix layer: Escape closes it before anything else.
 */
import { useEffect, useMemo, useRef } from "react"
import { Lock, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import type { Edl, EdlDropped } from "@nodaro/shared"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { INSPECTOR_POPPER } from "@/components/inspector/inspector-shell"
import { dropReasonLabel, dropReasonStyle } from "@/lib/edl-review/drop-reasons"
import type { Interval } from "@/lib/edl-review/intervals"
import type { KeptSet } from "@/lib/edl-review/kept-set"
import { canRestore, type LockedSpan, type RestoreLock, type ReviewRenderContext } from "@/lib/edl-review/restore"
import { restoreLockLabel } from "@/lib/edl-review/restore-lock-labels"
import { positionOf } from "@/lib/edl-review/review-time"
import { interpolateNodes } from "@/lib/i18n/interpolate-nodes"
import { tx, useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useReviewFormat } from "./use-review-format"

export interface SpanTarget {
  /**
   * The span itself, not its index in `dropped`: an undo, a redo or a re-plan
   * while the popover is open renumbers the spans, and the popover must keep
   * naming (and restoring) the one that was clicked. It closes once that span
   * is gone from the edit.
   */
  readonly span: EdlDropped
  /** What was clicked: the popover points at it while it is mounted. */
  readonly anchor: HTMLElement
  /** Where it was when clicked: the fallback once its row unmounts. */
  readonly rect: DOMRect
}

export interface SpanPopoverProps {
  readonly target: SpanTarget | null
  readonly onClose: () => void
  readonly shown: Edl
  readonly base: Edl | null
  readonly kept: KeptSet | null
  readonly render: ReviewRenderContext
  readonly canEdit: boolean
  readonly onRestore: (span: Interval) => RestoreLock | undefined
  readonly onRestoreReason: (reason: string) => readonly LockedSpan[]
}

/** Tell the reviewer how many spans of a reason stayed cut, and why (the first one's lock). */
export function toastLockedSpans(locked: readonly LockedSpan[]): void {
  if (locked.length === 0) return
  const reason = restoreLockLabel(locked[0]!.reason)
  toast.error(locked.length === 1 ? tx("edlReview.restoreLockedOne", { reason }) : tx("edlReview.restoreLockedMany", { n: locked.length, reason }))
}

/** Tell the reviewer why one restore was refused. */
export function toastRestoreLock(lock: RestoreLock): void {
  toast.error(tx("edlReview.cantRestore", { reason: restoreLockLabel(lock.reason) }))
}

function LockNote({ lock }: { readonly lock: RestoreLock }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-1" data-testid="restore-lock">
      <div className="flex items-start gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <Lock className="mt-0.5 h-3 w-3 shrink-0" />
        <span>{t("edlReview.cantRestore", { reason: restoreLockLabel(lock.reason, t) })}</span>
      </div>
      {lock.issues.length > 0 && (
        <ul dir="ltr" className="flex max-h-32 flex-col gap-0.5 overflow-auto">
          {lock.issues.map((issue, i) => (
            <li key={i} className="break-words rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] leading-snug">{issue}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** `span` as the shown edit still drops it, or undefined once it is gone. */
const findSpan = (shown: Edl, span: EdlDropped): EdlDropped | undefined =>
  shown.dropped?.find((d) => d.inMs === span.inMs && d.outMs === span.outMs && d.reason === span.reason)

function SpanBody({ target, onClose, shown, base, kept, render, canEdit, onRestore, onRestoreReason }: SpanPopoverProps & { readonly target: SpanTarget }) {
  const t = useT()
  const format = useReviewFormat()
  const span = findSpan(shown, target.span)
  const editable = canEdit && !!base && !!kept && !!span
  // The lock, judged once per open: one run of the render rule (≤ 50 ms on a 3-hour plan).
  const lock = useMemo<RestoreLock | undefined>(() => {
    if (!editable) return undefined
    const verdict = canRestore(base!, kept!, span!, render)
    return verdict.ok ? undefined : { reason: verdict.reason, issues: verdict.issues }
  }, [editable, base, kept, span, render])
  if (!span) return null
  const sameReason = (shown.dropped ?? []).filter((d) => d.reason === span.reason).length
  const label = dropReasonLabel(span.reason, t)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", dropReasonStyle(span.reason).swatch)} />
        <span>
          {interpolateNodes(t("edlReview.spanSummary"), {
            reason: <span className="font-medium">{label}</span>,
            range: <bdi dir="ltr" className="tabular-nums">{positionOf(span.inMs)} → {positionOf(span.outMs)}</bdi>,
            length: <span className="tabular-nums">{format.length(span.outMs - span.inMs)}</span>,
          })}
        </span>
      </div>
      {editable && (lock ? <LockNote lock={lock} /> : (
        <button
          type="button"
          className="inline-flex w-fit items-center gap-1 rounded bg-muted px-2 py-1 text-xs hover:bg-muted/80"
          onClick={() => {
            const refused = onRestore(span)
            if (refused) toastRestoreLock(refused)
            onClose()
          }}
        >
          <RotateCcw className="h-3 w-3" />
          {t("edlReview.restore")}
        </button>
      ))}
      {editable && (
        <button
          type="button"
          className="w-fit text-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => {
            toastLockedSpans(onRestoreReason(span.reason))
            onClose()
          }}
        >
          {t("edlReview.restoreAll", { reason: label, n: sameReason })}
        </button>
      )}
    </div>
  )
}

export function SpanPopover(props: SpanPopoverProps) {
  const { target, onClose, shown } = props
  const gone = target !== null && !findSpan(shown, target.span)
  useEffect(() => {
    if (gone) onClose()
  }, [gone, onClose])
  // The anchor while its row is mounted; where it was once the row scrolls away.
  const anchor = useRef({ getBoundingClientRect: () => new DOMRect() })
  anchor.current = {
    getBoundingClientRect: () => (target?.anchor.isConnected ? target.anchor.getBoundingClientRect() : (target?.rect ?? new DOMRect())),
  }
  return (
    <Popover open={target !== null && !gone} onOpenChange={(open) => { if (!open) onClose() }}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        align="start"
        side="bottom"
        onWheel={INSPECTOR_POPPER.onWheel}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn(INSPECTOR_POPPER.className, "z-[10000] w-80 p-3")}
        data-testid="span-popover"
      >
        {target && <SpanBody {...props} target={target} />}
      </PopoverContent>
    </Popover>
  )
}
