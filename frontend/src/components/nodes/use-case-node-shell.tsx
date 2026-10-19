"use client"

import type { ReactNode } from "react"
import { Position } from "@xyflow/react"
import { Loader2, AlertCircle, RotateCcw, type LucideIcon } from "lucide-react"
import { RENDER_FINAL_ALREADY_RENDERED } from "@nodaro/shared/nodes"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { useUnitNodeKit } from "./use-unit-node-kit"
import { useUseCaseContinue, useUseCaseListDriven } from "./use-case-node-hooks"
import { useUseCaseCredits } from "@/hooks/use-use-case-credits"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { executionErrorText, nodeErrorCodeText } from "@/lib/execution-error-text"
import { cn } from "@/lib/utils"

/**
 * The frame every use-case node shares (Tighten Episode, Chapters, Trailer —
 * decided 2026-10-13/14): its label, run strip and fee, its pips' places, and
 * its states — running, failed (with Continue: the next single-node run
 * continues that run from where it failed, its finished steps kept), and
 * empty. Each node supplies only its own parts: its result, what goes beside
 * it (a review, Render final), its pips and its sizing. A list-driven node
 * (one run per item) offers no Continue: no one run to name.
 */

/** The refusals of a Render final that leave nothing to continue (a final under way, or this edit already rendered). */
export const USE_CASE_REFUSED_FINAL_CODES: ReadonlySet<string> = new Set([RENDER_FINAL_ALREADY_RENDERED, "already_running"])

/** What a use-case node's run state reads, beside its own data. */
export interface UseCaseShellData {
  readonly label: string
  readonly executionStatus?: string
  readonly errorMessage?: string
  readonly currentJobProgress?: number
  readonly useCaseJobId?: string
}

/** The run state of a use-case node, as its face reads it. */
export interface UseCaseNodeRun {
  readonly credits: number | undefined
  readonly status: string
  /** A list feeds the node (one run per item). */
  readonly listDriven: boolean
  /** The last refusal's code, when it has one. */
  readonly errorCode: string | undefined
  /** The failure as the reader reads it: a known code in their language, else the message sent. */
  readonly shownError: string | undefined
}

/**
 * The run state of use-case node `id` of `nodeType`. The type is only read to
 * word a refusal (`nodeErrorCodeText`), so it is a plain string: a freshly
 * scaffolded node calls this before its type is in the built use-case list.
 */
export function useUseCaseNodeRun(id: string, nodeType: string, data: UseCaseShellData): UseCaseNodeRun {
  const credits = useUseCaseCredits(id)
  // A list-driven node runs once per item: no one run for Continue or Render final to name.
  const listDriven = useUseCaseListDriven(id)
  const raw = (data as { errorCode?: unknown }).errorCode
  const errorCode = typeof raw === "string" ? raw : undefined
  // A refusal on this node names its own remedy (its review, its one recording), in the reader's language.
  const coded = errorCode !== undefined ? (nodeErrorCodeText(errorCode, nodeType) ?? executionErrorText(errorCode)) : null
  // A known sentence of the run (a clip set none of whose clips rendered, …) reads in the reader's language too.
  const shownError = coded && coded !== errorCode ? coded : data.errorMessage ? (executionErrorText(data.errorMessage) ?? data.errorMessage) : data.errorMessage
  return { credits, status: data.executionStatus ?? "idle", listDriven, errorCode, shownError }
}

/** One pip's place on the card: an input on the left, an output on the right, at the top, the middle or the bottom. */
export interface UseCaseHandleSlot {
  readonly id: string
  readonly type: "target" | "source"
  readonly at: "top" | "middle" | "bottom"
}

const SLOT_TOP: Readonly<Record<UseCaseHandleSlot["at"], string>> = { top: "24px", middle: "50%", bottom: "calc(100% - 24px)" }

/** A slot's offset from the card's top — the shell's handle and the node's own pip read the same one. */
export function usecaseSlotTop(at: UseCaseHandleSlot["at"]): string {
  return SLOT_TOP[at]
}

export function UseCaseNodeShell({
  id,
  data,
  run,
  selected,
  icon: Icon,
  sizing,
  bodyMinHeight,
  handles,
  pips,
  hasResult,
  badge,
  result,
  afterResult,
  continueBlocked = false,
  emptyText,
}: {
  readonly id: string
  readonly data: UseCaseShellData
  readonly run: UseCaseNodeRun
  readonly selected?: boolean
  readonly icon: LucideIcon
  /** The card's size (a media node's from `videoNodeSizing`, the shared invariant). */
  readonly sizing: { readonly minWidth?: number; readonly minHeight?: number; readonly imageAspectRatio?: number }
  readonly bodyMinHeight: number
  readonly handles: readonly UseCaseHandleSlot[]
  /** The pips themselves (`HandleWithPopover`), drawn over the card. */
  readonly pips: ReactNode
  readonly hasResult: boolean
  /** Over the card's corner, before anything else (a Preview badge). */
  readonly badge?: ReactNode
  /** The node's result, shown when it has one. */
  readonly result?: ReactNode
  /** Under the result: what acts on it (a review, Render final). */
  readonly afterResult?: ReactNode
  /** A failure with nothing to continue (a refused Render final). */
  readonly continueBlocked?: boolean
  /** What the empty card says. */
  readonly emptyText: string
}) {
  const t = useT()
  // The workflow store's services, bound to this node (the same kit a unit's own face uses).
  const kit = useUnitNodeKit(id)
  const continueUseCase = useUseCaseContinue(id)
  const { credits, status, listDriven, shownError } = run
  const jobId = data.useCaseJobId
  const canContinue = !!jobId && !listDriven && !continueBlocked
  // The continuation is this click's run option, never node data: a click that
  // never starts (the price confirm declined, the balance refused) leaves
  // nothing behind, and the next Run is a fresh run.
  const continueRun = () => {
    if (!jobId) return
    continueUseCase(jobId)
  }

  return (
    <div className="relative group/node" style={{ width: "100%", height: "100%", overflow: "visible" }}>
      <EditableNodeLabel label={data.label} icon={<Icon className="w-3.5 h-3.5" />} onSave={(newLabel) => kit.updateNodeData({ label: newLabel })} />
      <BaseNode
        id={id}
        label={data.label}
        icon={<Icon className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        {...sizing}
        topToolbarContent={<RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={() => kit.run()} />}
        handles={handles.map((h) => ({
          id: h.id,
          type: h.type,
          position: h.type === "target" ? Position.Left : Position.Right,
          customStyle: h.type === "target" ? { top: SLOT_TOP[h.at], left: "-29px" } : { top: SLOT_TOP[h.at], right: "-29px" },
          external: true,
        }))}
      >
        <div className="relative flex flex-col gap-1 p-2 h-full" style={{ minHeight: bodyMinHeight }}>
          {badge}
          {status === "running" && (
            <div className="flex flex-col items-center justify-center gap-2 flex-1 rounded-md bg-muted/30">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={data.currentJobProgress} />
            </div>
          )}

          {hasResult && result}

          {afterResult}

          {/* Under an earlier result it is a compact strip; alone it fills the card. */}
          {status === "failed" && (
            <div className={cn("flex flex-col items-center justify-center gap-1 rounded-md bg-red-500/5 text-red-500 p-2", !hasResult && "flex-1")}>
              <div className="flex items-center gap-1.5"><AlertCircle className="w-4 h-4 shrink-0" /><span className="font-medium">{t("node.failed")}</span></div>
              {shownError && (
                <p className="text-[10px] text-center text-red-400 line-clamp-2" title={shownError}>{shownError}</p>
              )}
              {canContinue && (
                <Button size="sm" variant="secondary" className="nodrag" onClick={continueRun} title={t("node.tightenContinueHint")}>
                  <RotateCcw className="w-3.5 h-3.5 me-1" />{t("node.tightenContinue")}
                </Button>
              )}
            </div>
          )}

          {status !== "running" && !hasResult && status !== "failed" && (
            <div className="flex flex-col items-center justify-center gap-1 flex-1 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
              <Icon className="w-5 h-5" />
              <span className="text-[10px] text-center px-2">{emptyText}</span>
            </div>
          )}
        </div>
      </BaseNode>

      {pips}
    </div>
  )
}
