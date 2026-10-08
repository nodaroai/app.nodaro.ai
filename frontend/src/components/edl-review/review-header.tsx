"use client"

/**
 * The review inspector's header (§2.3 of the inspectors design):
 *  - title: "Review cut · {plan} → {render}", the node labels as the canvas
 *    shows them;
 *  - meta: the render picker (TA2 item 4: one render per review, chosen among
 *    the renders the plan feeds, `rendersOfPlan`), the take's badge (Preview,
 *    or Final), and the validity badge — the anchored render's own rule over
 *    every render its Run would make with the edit in place (TA1 a);
 *  - actions: the Cut | JSON switch and the ⋯ menu (Reset to plan, Copy JSON).
 */
import { useMemo } from "react"
import { ChevronDown, MoreHorizontal } from "lucide-react"
import type { SavedRenderItem } from "@nodaro/shared"
import { EdlValidityBadge } from "@/components/inspector/edl-validity-badge"
import { INSPECTOR_POPPER } from "@/components/inspector/inspector-shell"
import { PreviewBadge, isPreviewQuality } from "@/components/render/preview-badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { EdlValidity } from "@/lib/edl-validity"
import { useT } from "@/lib/i18n"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import { cn } from "@/lib/utils"
import { rendersOfPlan } from "@/components/editor/workflow-editor/render-final-set"

export type ReviewView = "cut" | "json"

const POPPER_CLASS = cn(INSPECTOR_POPPER.className, "z-[10000]")

/** A node's label as the canvas shows it. */
function useNodeLabel(id: string | null): string {
  const localize = useLocalizeNodeLabel()
  const label = useWorkflowStore((s) => {
    const node = id ? s.nodes.find((n) => n.id === id) : undefined
    const value = (node?.data as { label?: unknown } | undefined)?.label
    return typeof value === "string" ? value : ""
  })
  return localize(label)
}

export function ReviewTitle({ planId, renderId, kind = "edl" }: { readonly planId: string | null; readonly renderId: string; readonly kind?: "edl" | "clips" }) {
  const t = useT()
  const plan = useNodeLabel(planId)
  const render = useNodeLabel(renderId)
  return <>{t(kind === "clips" ? "clipReview.title" : "edlReview.title", { plan, render })}</>
}

interface RenderChoice {
  readonly id: string
  readonly label: string
  readonly audio: boolean
}

/**
 * The renders the plan feeds, in canvas order (`rendersOfPlan`). Selected as a
 * string, so a run's progress ticks (which change no label, output or wire) do
 * not re-render the header.
 */
function useRendersOfPlan(planId: string | null): readonly RenderChoice[] {
  const key = useWorkflowStore((s) =>
    planId
      ? JSON.stringify(
          rendersOfPlan(planId, s.nodes, s.edges).map((n): RenderChoice => {
            const data = (n.data ?? {}) as { label?: unknown; output?: unknown }
            return { id: n.id, label: typeof data.label === "string" ? data.label : n.id, audio: data.output === "audio" }
          }),
        )
      : "[]",
  )
  return useMemo(() => JSON.parse(key) as RenderChoice[], [key])
}

export interface ReviewMetaProps {
  readonly planId: string | null
  readonly renderId: string
  readonly onRenderChange: (id: string) => void
  readonly take: SavedRenderItem | undefined
  /** The anchored render's own rule on the renders its Run would make
   *  (`useReviewChecks().validity`); null shows no badge. */
  readonly validity: EdlValidity | null
}

export function ReviewMeta({ planId, renderId, onRenderChange, take, validity }: ReviewMetaProps) {
  const t = useT()
  const localize = useLocalizeNodeLabel()
  const choices = useRendersOfPlan(planId)
  return (
    <span className="inline-flex items-center gap-2">
      {choices.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={t("edlReview.chooseRender")} title={t("edlReview.chooseRender")} className="rounded p-0.5 hover:bg-muted">
            <ChevronDown className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className={POPPER_CLASS} onWheel={INSPECTOR_POPPER.onWheel}>
            <DropdownMenuRadioGroup value={renderId} onValueChange={onRenderChange}>
              {choices.map((c) => (
                <DropdownMenuRadioItem key={c.id} value={c.id}>
                  {t("common.qualified", { token: localize(c.label), qualifier: t(c.audio ? "out.audio" : "out.video") })}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {take && (isPreviewQuality(take) ? (
        <PreviewBadge />
      ) : (
        <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
          {t("edlReview.finalBadge")}
        </span>
      ))}
      {validity && <EdlValidityBadge verdict={validity} />}
    </span>
  )
}

export interface ReviewActionsProps {
  readonly view: ReviewView
  readonly onViewChange: (view: ReviewView) => void
  readonly canReset: boolean
  readonly onReset: () => void
  readonly onCopyJson: () => void
}

export function ReviewActions({ view, onViewChange, canReset, onReset, onCopyJson }: ReviewActionsProps) {
  const t = useT()
  const tab = (value: ReviewView, label: string) => (
    <button
      type="button"
      aria-pressed={view === value}
      className={cn("rounded px-2 py-0.5 text-xs", view === value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
      onClick={() => onViewChange(value)}
    >
      {label}
    </button>
  )
  return (
    <>
      <div role="group" aria-label={t("edlReview.view")} className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
        {tab("cut", t("edlReview.tabCut"))}
        {tab("json", t("out.json"))}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={t("edlReview.moreActions")} title={t("edlReview.moreActions")} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={POPPER_CLASS} onWheel={INSPECTOR_POPPER.onWheel}>
          <DropdownMenuItem disabled={!canReset} onSelect={onReset}>{t("edlReview.resetToPlan")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={onCopyJson}>{t("cfgext.scrapeCopyJson")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
