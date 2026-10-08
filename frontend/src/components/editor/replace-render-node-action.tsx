"use client"

/**
 * "Replace with Speaker View" (SV16 b): the button, the one line under it that
 * says what the swap keeps and drops, and the confirm that lists every wire and
 * says the run history is not carried. Shown in the Apply EDL badge's popover
 * when the edit is hinted (U6) and under Camera Switch's layout-hints note (U7).
 * A refused swap shows the button disabled with its reason, before anything
 * changes. Also "Back to Apply EDL" on Speaker View (Round 2, decided
 * 2026-10-08): the same action the other way. The confirm also says when the
 * edit is not known yet and the cameras may need re-wiring, what typed-in
 * value carries over, and which of the published app's items move.
 */
import { useState } from "react"
import { Replace } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useUndoRedoActions } from "@/hooks/use-undo-redo"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import {
  describeWire,
  renderSwapRefusalText,
  renderTypeLabel,
  replaceRenderNodeOnCanvas,
  useRenderSwapPlan,
} from "@/hooks/use-replace-render-node"
import type { RenderSwapAppItem, RenderSwapPlan } from "@/lib/replace-render-node"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const unique = (xs: readonly string[]): string[] => [...new Set(xs)]

/** "keeps the edl and transcript wires; drops 1 sources wire; one undo step". */
function summary(plan: RenderSwapPlan, t: ReturnType<typeof useT>): string {
  const parts: string[] = []
  const kept = unique(plan.kept.map((w) => w.handle))
  if (kept.length > 0) parts.push(t("renderSwap.keeps", { handles: kept.join(", ") }))
  const dropped = plan.dropped
  if (dropped.length === 1) parts.push(t("renderSwap.dropsOne", { handle: dropped[0]!.handle }))
  else if (dropped.length > 1) parts.push(t("renderSwap.dropsMany", { n: dropped.length, handles: unique(dropped.map((w) => w.handle)).join(", ") }))
  if (plan.appItems.length > 0) parts.push(t("renderSwap.movesApp", { n: plan.appItems.length }))
  parts.push(t("renderSwap.oneUndo"))
  return parts.join("; ")
}

/** "App output: result — Apply EDL does not show it". */
function appItemText(item: RenderSwapAppItem, to: string, t: ReturnType<typeof useT>): string {
  const section = t(item.section === "input" ? "renderSwap.appInput" : "renderSwap.appOutput")
  const what = item.key ?? t("renderSwap.appWholeNode")
  const text = `${section}: ${what}`
  return item.shown ? text : `${text} — ${t("renderSwap.appNotShown", { to })}`
}

function WireList({ title, items }: { readonly title: string; readonly items: readonly string[] }) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-xs font-medium">{title}</div>
      <ul dir="ltr" className="flex flex-col gap-0.5">
        {items.map((s, i) => <li key={i} className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[11px]">{s}</li>)}
      </ul>
    </div>
  )
}

export function ReplaceRenderNodeAction({ nodeId, toType, label, className }: {
  readonly nodeId: string
  readonly toType: string
  /** The button text; "Replace with {to}" when absent. */
  readonly label?: string
  readonly className?: string
}) {
  const t = useT()
  const { undo } = useUndoRedoActions()
  const isReadOnly = useWorkflowStore((s) => s.isReadOnly)
  const nodes = useWorkflowStore((s) => s.nodes)
  const fromType = nodes.find((n) => n.id === nodeId)?.type ?? ""
  const plan = useRenderSwapPlan(nodeId, toType)
  const [confirming, setConfirming] = useState(false)
  if (isReadOnly || !plan) return null

  const from = renderTypeLabel(fromType)
  const to = renderTypeLabel(toType)
  const text = label ?? t("renderSwap.replaceWith", { to })
  return (
    <div data-testid="replace-render-node" className={cn("flex flex-col gap-1", className)}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!plan.ok}
        className="nodrag nopan nokey h-7 w-fit gap-1.5 text-xs"
        onClick={(e) => {
          e.stopPropagation()
          setConfirming(true)
        }}
      >
        <Replace className="h-3.5 w-3.5" />
        {text}
      </Button>
      <p className="text-[11px] text-muted-foreground">
        {plan.ok ? summary(plan, t) : renderSwapRefusalText(plan.reason, fromType, toType)}
      </p>
      {plan.ok && (
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          {/* Above the badge popover (z-[10000]) it can be opened from. */}
          <AlertDialogContent overlayClassName="z-[10001]" className="z-[10002]">
            <AlertDialogHeader>
              <AlertDialogTitle>{t("renderSwap.confirmTitle", { from, to })}</AlertDialogTitle>
              <AlertDialogDescription>{t("renderSwap.confirmHistory", { from })}</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col gap-2">
              {plan.camerasUnjudged && (
                <p role="alert" data-testid="render-swap-cameras-unjudged" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
                  {t("renderSwap.camerasUnjudged")}
                </p>
              )}
              <WireList title={t("renderSwap.confirmKept")} items={plan.kept.map((w) => describeWire(nodes, w))} />
              <WireList title={t("renderSwap.confirmMoved")} items={plan.moved.map((w) => describeWire(nodes, w))} />
              <WireList title={t("renderSwap.confirmDropped")} items={plan.dropped.map((w) => describeWire(nodes, w))} />
              <WireList title={t("renderSwap.confirmInline")} items={plan.inline} />
              <WireList title={t("renderSwap.confirmApp")} items={plan.appItems.map((i) => appItemText(i, to, t))} />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirming(false)
                  replaceRenderNodeOnCanvas(nodeId, toType, undo)
                }}
              >
                {t("renderSwap.confirmAction")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}
