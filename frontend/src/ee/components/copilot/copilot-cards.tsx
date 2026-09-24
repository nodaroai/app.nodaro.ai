/**
 * The cards a turn produces: what changed on the canvas, and whether to spend
 * money on it.
 *
 * The proposal card IS the run confirmation — the editor's own confirm dialog
 * is skipped when a run starts from here, so this card has to carry everything
 * that dialog would have said: the estimate, what it will run, and a way out.
 */
import { Check, Paperclip } from "lucide-react"
import { COPILOT_KEYS as K } from "@/ee/lib/copilot/strings"
import type { CopilotWiredAsset, CopilotWorkflowUpdate } from "@/ee/lib/copilot/types"
import { creditUnits } from "@/lib/credit-units"
import { useT, type TFunction } from "@/lib/i18n"
import { formatNumber } from "@/lib/i18n/format"

const CARD = "p-3 bg-[var(--copilot-card)] border border-border rounded-[11px] flex flex-col gap-2.5"

/** "12 credits" — the figure converted to the display unit, then counted. */
function usedCredits(t: TFunction, credits: number): string {
  const n = creditUnits(credits)
  return t(n === 1 ? K.creditsOne : K.creditsOther, { n })
}

export function WorkflowUpdatedCard({
  update,
  onShowOnCanvas,
}: {
  update: CopilotWorkflowUpdate
  onShowOnCanvas: () => void
}) {
  const t = useT()
  const added = update.addedNodeIds.length
  const updated = update.updatedNodeIds.length
  const removed = update.removedNodeIds.length
  const parts = [
    added > 0 ? t(added === 1 ? K.addedNodesOne : K.addedNodesOther, { n: added }) : null,
    updated > 0 ? t(K.updatedNodes, { n: updated }) : null,
    removed > 0 ? t(K.removedNodes, { n: removed }) : null,
    t(update.edgeCount === 1 ? K.connectionsOne : K.connectionsOther, { n: update.edgeCount }),
  ].filter(Boolean)

  return (
    <div className={CARD}>
      <div className="flex items-center gap-2">
        <span className="w-[7px] h-[7px] rounded-[2px] bg-[var(--copilot-ok)]" aria-hidden />
        <span className="text-[12.5px] font-semibold text-foreground">{t(K.updatedTitle)}</span>
        <span className="ms-auto text-[11px] text-[var(--copilot-dim)] font-mono">v{update.version}</span>
      </div>
      <div className="text-xs text-[var(--copilot-muted)]">{parts.join(" · ")}</div>
      {update.adjustments.length > 0 && (
        <ul className="text-[11px] text-[var(--copilot-dim)] list-disc ps-4 space-y-0.5">
          {update.adjustments.slice(0, 3).map((note, i) => (
            // Index-keyed on purpose: these come from the server and repeat.
            <li key={`${i}:${note}`}>{note}</li>
          ))}
        </ul>
      )}
      {added > 0 && (
        <button
          type="button"
          onClick={onShowOnCanvas}
          className="self-start px-3 py-1.5 bg-[var(--copilot-surface)] border border-[var(--copilot-strong)] rounded-lg text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
        >
          {t(K.updatedShowOnCanvas)}
        </button>
      )}
    </div>
  )
}

export function RunProposalCard({
  estimate,
  estimateStale,
  nodeCount,
  nodeLabel,
  balance,
  overLimit,
  ceiling,
  wiredAssets,
  onRun,
  onSkip,
  disabled,
}: {
  estimate: number
  /** The number on screen belongs to the previous graph — say so rather than quote it. */
  estimateStale: boolean
  nodeCount: number
  /**
   * Set when ONE node was proposed. The card must NAME it: "1 step" beside a
   * price tells the user how much, not what — and on a canvas of twenty nodes
   * that is the whole question.
   */
  nodeLabel?: string
  balance: number | null
  overLimit: boolean
  ceiling: number
  /** Files the copilot attached. Named, because this card is the approval. */
  wiredAssets: CopilotWiredAsset[]
  onRun: () => void
  onSkip: () => void
  disabled?: boolean
}) {
  const t = useT()
  const detail = [
    nodeLabel ?? t(nodeCount === 1 ? K.stepsOne : K.stepsOther, { n: nodeCount }),
    balance !== null ? t(K.proposeBalance, { n: formatNumber(balance) }) : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className={`${CARD} gap-[11px]`}>
      <div className="flex items-baseline gap-2">
        <span className="text-[12.5px] font-semibold text-foreground whitespace-nowrap">{t(K.proposeTitle)}</span>
        <span className="ms-auto text-xs text-primary font-semibold tabular-nums">
          {estimateStale ? t(K.estimatePending) : t(K.proposeEstimate, { credits: creditUnits(estimate) })}
        </span>
      </div>
      <div className="text-[11.5px] text-[var(--copilot-dim)]">{detail}</div>
      {wiredAssets.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[10.5px] tracking-[0.1em] uppercase text-[var(--copilot-dim)] font-semibold">
            {t(K.proposeUsingFiles)}
          </div>
          <ul className="flex flex-col gap-0.5">
            {wiredAssets.map((asset) => (
              <li key={`${asset.nodeId}:${asset.id}`} className="flex items-center gap-1.5 min-w-0">
                <Paperclip className="w-3 h-3 flex-none text-[var(--copilot-dim)]" aria-hidden />
                <span className="text-[11.5px] text-foreground truncate">{asset.filename}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {overLimit && (
        <div className="text-[11.5px] text-[var(--copilot-muted)]">
          {t(K.autoOverLimit, { credits: creditUnits(estimate), ceiling: creditUnits(ceiling) })}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRun}
          disabled={disabled}
          className="px-4 py-[7px] bg-primary rounded-lg text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {t(K.proposeRun)}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="px-3.5 py-[7px] border border-border rounded-lg text-[12.5px] text-[var(--copilot-muted)] transition-colors hover:text-foreground"
        >
          {t(K.proposeSkip)}
        </button>
      </div>
    </div>
  )
}

export function AutoRunNotice({ estimate, ceiling, stale }: { estimate: number; ceiling: number; stale?: boolean }) {
  const t = useT()
  return (
    <div className="px-3 py-2.5 rounded-[11px] text-xs text-foreground bg-primary/[0.07] border border-primary/30">
      {stale
        ? t(K.autoNoticePending, { ceiling: creditUnits(ceiling) })
        : t(K.autoNotice, { credits: creditUnits(estimate), ceiling: creditUnits(ceiling) })}
    </div>
  )
}

export function RunningCard({
  completed,
  total,
  credits,
  onStop,
}: {
  completed: number
  total: number
  credits: number
  onStop: () => void
}) {
  const t = useT()
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full border-2 border-primary/25 border-t-primary animate-spin" aria-hidden />
        <span className="text-[12.5px] font-semibold text-foreground">{t(K.running)}</span>
        <span className="ms-auto text-xs text-[var(--copilot-muted)] tabular-nums">
          {total > 0 ? t(K.runProgress, { n: Math.min(completed + 1, total), total }) : t(K.runStarting)}
        </span>
      </div>
      <div className="h-[3px] bg-border rounded-sm overflow-hidden">
        <div className="h-full bg-primary rounded-sm transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11.5px] text-[var(--copilot-dim)] tabular-nums">
          {credits > 0 ? usedCredits(t, credits) : ""}
        </span>
        <button
          type="button"
          onClick={onStop}
          className="ms-auto px-3 py-[5px] border border-border rounded-md text-xs text-[var(--copilot-muted)] transition-colors hover:text-foreground"
        >
          {t(K.runStop)}
        </button>
      </div>
    </div>
  )
}

export function RunSucceededCard({ credits }: { credits: number }) {
  const t = useT()
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2">
        <Check className="w-3.5 h-3.5 text-[var(--copilot-ok)]" strokeWidth={2.6} />
        <span className="text-[12.5px] font-semibold text-foreground">{t(K.runSucceeded)}</span>
        <span className="ms-auto text-xs text-[var(--copilot-muted)] tabular-nums">{usedCredits(t, credits)}</span>
      </div>
    </div>
  )
}

export function RunFailedCard({
  credits,
  failedStep,
  message,
  onFix,
  disabled,
}: {
  credits: number
  failedStep: number | null
  message: string | null
  onFix: () => void
  disabled?: boolean
}) {
  const t = useT()
  return (
    <div className="p-3 bg-[var(--copilot-card)] border border-[var(--copilot-fail)]/35 rounded-[11px] flex flex-col gap-[9px]">
      <div className="flex items-center gap-2">
        <span className="w-[7px] h-[7px] rounded-full bg-[var(--copilot-fail)]" aria-hidden />
        <span className="text-[12.5px] font-semibold text-foreground">
          {failedStep === null ? t(K.runFailed) : t(K.runFailedAt, { step: failedStep })}
        </span>
        <span className="ms-auto text-xs text-[var(--copilot-muted)] tabular-nums">{usedCredits(t, credits)}</span>
      </div>
      {message && <div className="text-xs leading-[1.5] text-[var(--copilot-muted)] break-words">{message}</div>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onFix}
          disabled={disabled}
          className="px-4 py-[7px] bg-primary rounded-lg text-[12.5px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {t(K.fixIt)}
        </button>
      </div>
    </div>
  )
}
