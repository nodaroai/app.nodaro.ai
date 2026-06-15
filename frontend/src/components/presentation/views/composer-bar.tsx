import { ArrowUp, Loader2 } from "lucide-react"
import type { ReactNode } from "react"
import type { WorkflowNode } from "@/types/nodes"
import { ComposerChip } from "./composer-chip"

interface ComposerBarProps {
  inputNodes: WorkflowNode[]
  inputValues: Record<string, Record<string, unknown>>
  renderInputCard: (node: WorkflowNode, variant?: "composer") => ReactNode
  isRunning: boolean
  /** e.g. " (12 CR)" — appended to the Launch label; "" when credits are off / zero. */
  costLabel: string
  allInputsFilled: boolean
  needsMoreCredits: boolean
  onLaunch: () => void
}

/**
 * The chat composer: a wrapping row of input chips + a Launch button that shows
 * the credit cost. Launch is disabled while a run is in flight (single-run) or
 * when required inputs are missing.
 */
export function ComposerBar({
  inputNodes,
  inputValues,
  renderInputCard,
  isRunning,
  costLabel,
  allInputsFilled,
  needsMoreCredits,
  onLaunch,
}: ComposerBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {inputNodes.map((node) => (
        <ComposerChip
          key={node.id}
          node={node}
          inputValues={inputValues}
          renderInputCard={renderInputCard}
          disabled={isRunning}
        />
      ))}
      <div className="ml-auto flex items-center gap-2">
        {needsMoreCredits && !isRunning && (
          <span className="text-[11px] font-medium text-amber-600">Insufficient credits</span>
        )}
        <button
          type="button"
          onClick={onLaunch}
          disabled={isRunning || !allInputsFilled}
          className="flex items-center gap-1.5 rounded-xl bg-[#ff0073] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {isRunning ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Running…
            </>
          ) : (
            <>
              Launch{costLabel} <ArrowUp className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      </div>
    </div>
  )
}
