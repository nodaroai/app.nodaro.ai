import { useEffect, useId, useRef } from "react"
import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The page's one way of asking before an action it cannot take back: a small
 * panel in place (the switch, a ceiling's Remove, a waiting job's Cancel) with
 * the action and a way out. Nothing changes until its action is clicked. When
 * it opens it puts focus on the way out, the button that changes nothing (so
 * a second Enter never confirms) — once, on mount, so a poll that redraws the
 * page behind it never pulls focus back — and says itself to a screen reader
 * as an alert dialog named by its title.
 */
export function InlineConfirm({ title, body, confirmLabel, cancelLabel = "Cancel", destructive = false, pending, onConfirm, onCancel, className }: {
  title: string
  body?: ReactNode
  confirmLabel: string
  /** The button that changes nothing; it takes the focus. */
  cancelLabel?: string
  destructive?: boolean
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
  className?: string
}) {
  const titleId = useId()
  const bodyId = useId()
  const safe = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    safe.current?.focus()
  }, [])
  return (
    <div
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={body ? bodyId : undefined}
      className={cn("space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-start", className)}
    >
      <p id={titleId} className="text-sm font-semibold">{title}</p>
      {body && <div id={bodyId} className="text-sm">{body}</div>}
      <div className="flex gap-2">
        <Button size="sm" variant={destructive ? "destructive" : "default"} onClick={onConfirm} disabled={pending}>
          {pending && <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />}
          {confirmLabel}
        </Button>
        <Button ref={safe} size="sm" variant="outline" onClick={onCancel} disabled={pending}>{cancelLabel}</Button>
      </div>
    </div>
  )
}
