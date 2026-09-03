"use client"

import { useEffect, useRef, useState } from "react"
import { useT } from "@/lib/i18n"
import { Maximize, SlidersHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useUpdateNodeDoubleClickActionMutation } from "@/hooks/queries/use-user-settings-queries"
import {
  NODE_DOUBLE_CLICK_LABEL,
  type NodeDoubleClickAction,
} from "@/lib/node-double-click-action"

/** How long the post-click confirmation stays up. */
const CONFIRM_MS = 1400

const OPTIONS: ReadonlyArray<{ action: NodeDoubleClickAction; Icon: typeof Maximize }> = [
  { action: "zoom", Icon: Maximize },
  { action: "settings", Icon: SlidersHorizontal },
]

/**
 * Two-position switch for what double-clicking a node does.
 *
 * It replaced a momentary "open the settings panel" button, which is no longer
 * needed in the toolbar: every node now carries its own settings control in its
 * run strip. What the toolbar owns instead is the CHOICE.
 *
 * The state is easy to forget, so it announces itself twice: hovering explains
 * what a double-click currently does and what clicking would change it to, and
 * flipping it shows the new binding for a moment. Both read `Double-click → …`
 * rather than naming the modes, because the binding is the thing being set.
 */
export function NodeDoubleClickToggle() {
  const t = useT()
  const { user } = useAuth()
  const action = useWorkflowStore((s) => s.nodeDoubleClickAction)
  const setAction = useWorkflowStore((s) => s.setNodeDoubleClickAction)
  const mutation = useUpdateNodeDoubleClickActionMutation()
  const [confirming, setConfirming] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current) }, [])

  function choose(next: NodeDoubleClickAction) {
    if (next === action) return
    // Optimistic on the store too, not just the query cache: the canvas reads
    // the store, so the very next double-click must already honour the change
    // even if the PATCH is still in flight.
    setAction(next)
    if (user?.id) mutation.mutate({ userId: user.id, nodeDoubleClickAction: next })
    setConfirming(true)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setConfirming(false), CONFIRM_MS)
  }

  const other: NodeDoubleClickAction = action === "zoom" ? "settings" : "zoom"

  return (
    <div className="relative group/dct">
      <div
        role="radiogroup"
        aria-label={t("editor.dblClickGroup")}
        className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5"
      >
        {OPTIONS.map(({ action: value, Icon }) => {
          const active = value === action
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={t("editor.dblClickTo", { what: value === "zoom" ? t("editor.dblClickZoom") : t("editor.dblClickSettings") })}
              onClick={() => choose(value)}
              className={cn(
                "flex h-7 w-8 items-center justify-center rounded-md transition-colors",
                active
                  ? "bg-[#ff0073]/15 text-[#ff0073] ring-1 ring-inset ring-[#ff0073]/60"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          )
        })}
      </div>

      {/* Hover: what it does now, and what a click would change it to. */}
      <div
        className={cn(
          "pointer-events-none absolute end-0 top-full z-50 mt-2 w-max max-w-[19rem] rounded-lg border border-border",
          "bg-popover px-3 py-2 text-popover-foreground shadow-lg",
          "opacity-0 transition-opacity group-hover/dct:opacity-100",
          confirming && "hidden",
        )}
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {t("editor.dblClickOnANode")}
        </div>
        <div className="mt-0.5 text-sm">
          <span className="font-medium">{NODE_DOUBLE_CLICK_LABEL()[action]}</span>
          <span className="text-muted-foreground">
            {" "}
            {t("editor.dblClickSwitchTo", { what: other === "zoom" ? t("editor.dblClickSwitchZoom") : t("editor.dblClickSwitchSettings") })}
          </span>
        </div>
      </div>

      {/* Click: the new binding, briefly. Takes over from the hover card so the
          two can never stack on top of each other. */}
      {confirming && (
        <div
          role="status"
          className={cn(
            "pointer-events-none absolute end-0 top-full z-50 mt-2 w-max rounded-lg border border-border",
            "bg-popover px-3 py-2 font-mono text-sm text-popover-foreground shadow-lg",
          )}
        >
          {t("editor.dblClickArrow")} <span className="text-muted-foreground">→</span>{" "}
          {NODE_DOUBLE_CLICK_LABEL()[action]}
        </div>
      )}
    </div>
  )
}
