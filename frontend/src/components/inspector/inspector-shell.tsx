"use client"

/**
 * The one modal every node result inspector opens in.
 *
 * Node results (an Edit Plan, a video analysis, an audit report) used to be shown
 * in private copies of the same hand-rolled `createPortal` modal, one per node
 * file. This is that modal once, on the Radix Dialog primitive, so focus, Escape,
 * the backdrop and the canvas isolation below are decided in one place and every
 * inspector gets them. The EDL review inspectors (Track A) mount here at `full`
 * size.
 *
 * ISOLATION FROM THE CANVAS. An inspector is opened from inside a React Flow node:
 *  - React Flow's keys (Delete/Backspace remove the selected nodes; arrows move
 *    them) are skipped for any event whose target is inside `.nokey` — both its
 *    document delete listener and its node keydown check `isInputDOMNode`. The
 *    content carries that class. If focus ever falls to `<body>` anyway, the
 *    canvas refuses deletes while a modal is open (`refuseDeleteUnderModal`).
 *  - The editor's shortcuts (undo, redo, select-all, Escape's sidebar close, …)
 *    stand down while a modal dialog is open (`lib/modal-open.ts`). Radix sets
 *    the role but not `aria-modal`, so the content sets it.
 *  - Keys are NOT stopped here: listeners that should keep working under a modal
 *    (Cmd/Ctrl+S saves the workflow from a window listener) must still see them.
 *  - Clicks, double-clicks and context menus ARE stopped: React bubbles a
 *    portal's events through the REACT tree, into the node that rendered it, whose
 *    click selects it and opens its settings. Stopping them at the content would
 *    also hide every inside click from a Radix popover open above it (it would
 *    never close), so the content is registered as a dismissable surface: its
 *    clicks count as outside interactions for poppers, though stopped.
 *  - Pressing the backdrop keeps focus in the dialog (no `<body>` focus for the
 *    canvas to act on); a left click still closes it.
 *
 * POPPERS INSIDE AN INSPECTOR (popovers, menus, selects) portal to `<body>`,
 * outside the content: spread `INSPECTOR_POPPER` on their content so they are
 * `.nokey` too and their lists scroll (the modal's scroll lock cancels wheel
 * events outside the content).
 */
import type { ReactNode, SyntheticEvent } from "react"
import { useCallback, useRef } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { useDismissableLayerSurface } from "@radix-ui/react-dismissable-layer"
import { X } from "lucide-react"
import { cn, copyToClipboard } from "@/lib/utils"
import { useT } from "@/lib/i18n"

export type InspectorSize = "compact" | "full"

const SIZE_CLASS: Record<InspectorSize, string> = {
  // Today's result modal: a centred 48 rem column, never taller than 85% of the viewport.
  compact: "w-[calc(100%-4rem)] max-w-3xl max-h-[85vh]",
  // The review inspectors: almost the whole window.
  full: "w-[96vw] h-[92vh]",
}

export interface InspectorShellProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: ReactNode
  readonly icon?: ReactNode
  /** Secondary header text beside the title (counts, a summary). */
  readonly meta?: ReactNode
  /** Extra header controls, rendered before Copy JSON and the close button. */
  readonly actions?: ReactNode
  /** When set, the header offers "Copy JSON" for this value. */
  readonly copyValue?: unknown
  readonly size?: InspectorSize
  /** Pinned below the scrolling body. */
  readonly footer?: ReactNode
  /** Classes for the scrolling body; the default pads and stacks its children. */
  readonly bodyClassName?: string
  readonly children: ReactNode
}

const stop = (e: SyntheticEvent) => e.stopPropagation()

/** Pointer gestures that must not reach the node the inspector was opened from. */
const CONTAINED = { onClick: stop, onDoubleClick: stop, onContextMenu: stop } as const

/** Spread on the content of any popper (popover, menu, select) shown inside an
 *  inspector — see the header. Merge `className` with your own. */
export const INSPECTOR_POPPER = { className: "nokey", onWheel: stop } as const

export function InspectorShell({
  open, onClose, title, icon, meta, actions, copyValue, size = "compact", footer, bodyClassName, children,
}: InspectorShellProps) {
  const t = useT()
  const contentRef = useRef<HTMLDivElement | null>(null)
  // Whatever had focus when the inspector opened (its Expand button): focus goes
  // back there on close. There is no Dialog.Trigger, so Radix would drop it on <body>.
  const openerRef = useRef<HTMLElement | null>(null)
  const surfaceRef = useDismissableLayerSurface()
  const setContent = useCallback((el: HTMLDivElement | null) => {
    contentRef.current = el
    surfaceRef(el)
  }, [surfaceRef])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="inspector-overlay"
          className="fixed inset-0 z-[9999] bg-black/80"
          // Keep focus in the dialog when the backdrop is pressed (a right-click
          // keeps a modal open but would otherwise blur it to <body>). Radix
          // dismisses on pointerdown/click, so a left click still closes it.
          onMouseDown={(e) => e.preventDefault()}
          {...CONTAINED}
        />
        <DialogPrimitive.Content
          ref={setContent}
          data-slot="inspector"
          data-size={size}
          aria-modal="true"
          // No description element: the title names the dialog.
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
            // Land focus on the dialog itself, not on its first button.
            contentRef.current?.focus()
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            const opener = openerRef.current
            openerRef.current = null
            if (opener?.isConnected) opener.focus()
          }}
          tabIndex={-1}
          className={cn(
            "nokey fixed left-1/2 top-1/2 z-[9999] -translate-x-1/2 -translate-y-1/2 flex flex-col",
            "bg-background rounded-lg border border-border shadow-xl outline-none",
            SIZE_CLASS[size],
          )}
          {...CONTAINED}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {icon && <span className="text-muted-foreground shrink-0 [&_svg]:w-4 [&_svg]:h-4">{icon}</span>}
              <DialogPrimitive.Title className="text-sm font-medium truncate">{title}</DialogPrimitive.Title>
              {meta && <span className="text-xs text-muted-foreground tabular-nums truncate">{meta}</span>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {actions}
              {copyValue !== undefined && (
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80 transition-colors"
                  onClick={() => copyToClipboard(JSON.stringify(copyValue, null, 2), t("node.dataCopied"))}
                >
                  {t("cfgext.scrapeCopyJson")}
                </button>
              )}
              <DialogPrimitive.Close
                aria-label={t("common.close")}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </DialogPrimitive.Close>
            </div>
          </div>
          <div className={cn("flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-3", bodyClassName)}>
            {children}
          </div>
          {footer && <div className="shrink-0 border-t border-border px-4 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
