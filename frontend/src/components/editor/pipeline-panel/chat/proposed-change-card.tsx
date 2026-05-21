import { useState } from "react"
import type { ProposedChange } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { DiffRenderer } from "./diff-renderer"

interface Props {
  proposedChange: ProposedChange
  /** The chat turn id this proposal belongs to — used by Apply mutation. */
  turnId: string
  /** True once the source turn was applied (set by SSE chat:proposal_applied). */
  applied?: boolean
  /** Called on Apply click. The hook owns the mutation. */
  onApply: (turnId: string) => void
  /** Hides the buttons + shows a "Skipped" pill. Local UI-only state. */
  onSkip?: () => void
  isApplying?: boolean
  /** Apply mutation error from the hook. Shows the failed-apply badge. */
  applyError?: unknown
}

/**
 * Phase 1D.2b — Proposed-change disclosure card inside an assistant chat
 * turn. Two variants based on `change_type`:
 *
 *  - `edit_artifact` — shows the LLM-authored summary + a collapsible
 *    diff (rendered by DiffRenderer). [Apply] commits the patch through
 *    `applyStageEdit`; [Skip] hides the apply controls but keeps the
 *    diff visible for context.
 *  - `suggest_branch` — the LLM thinks a deeper change is needed.
 *    Renders the reason and a hint pointing the user at the panel's
 *    "Re-run from here" branch flow; no Apply button (branching is a
 *    different code path).
 */
export function ProposedChangeCard({
  proposedChange,
  turnId,
  applied = false,
  onApply,
  onSkip,
  isApplying = false,
  applyError,
}: Props) {
  const [showDiff, setShowDiff] = useState(false)
  const [skipped, setSkipped] = useState(false)

  if (proposedChange.change_type === "suggest_branch") {
    return (
      <div
        className="mt-2 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-3 text-xs"
        data-testid="proposed-change-card-suggest-branch"
      >
        <div className="font-medium text-amber-800 dark:text-amber-200 mb-1">
          Suggested: branch from this stage
        </div>
        <div className="text-amber-700 dark:text-amber-300 mb-2">
          {proposedChange.reason}
        </div>
        <div className="text-[11px] text-amber-700/80 dark:text-amber-300/80 italic">
          Use the "Re-run from here" controls in the panel header to branch.
        </div>
      </div>
    )
  }

  // edit_artifact
  const errorMessage =
    applyError instanceof Error ? applyError.message : applyError ? String(applyError) : null
  const showActions = !applied && !skipped

  return (
    <div
      className="mt-2 rounded border border-zinc-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 text-xs"
      data-testid="proposed-change-card-edit-artifact"
    >
      <div className="font-medium text-zinc-800 dark:text-zinc-100 mb-1">
        Proposed change
      </div>
      <div className="text-zinc-700 dark:text-zinc-200 mb-2">
        {proposedChange.summary}
      </div>
      <button
        type="button"
        className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 underline-offset-2 hover:underline"
        onClick={() => setShowDiff((v) => !v)}
        data-testid="proposed-change-toggle-diff"
      >
        {showDiff ? "Hide diff" : "View diff"}
      </button>
      {showDiff && (
        <div className="mt-2 rounded bg-zinc-50 dark:bg-[#121212] p-2 border border-zinc-200 dark:border-[#2D2D2D]">
          <DiffRenderer ops={proposedChange.json_patch} />
        </div>
      )}
      {errorMessage && (
        <div
          className="mt-2 rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 p-2 text-red-700 dark:text-red-300"
          data-testid="proposed-change-apply-error"
        >
          Apply failed: {errorMessage}
        </div>
      )}
      {applied && (
        <div
          className="mt-2 text-green-700 dark:text-green-400 font-medium"
          data-testid="proposed-change-applied"
        >
          Applied
        </div>
      )}
      {skipped && !applied && (
        <div
          className="mt-2 text-zinc-500 dark:text-zinc-400 italic"
          data-testid="proposed-change-skipped"
        >
          Skipped
        </div>
      )}
      {showActions && (
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            disabled={isApplying || !!errorMessage}
            onClick={() => onApply(turnId)}
            data-testid="proposed-change-apply-btn"
          >
            {isApplying ? "Applying…" : "Apply"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isApplying}
            onClick={() => {
              setSkipped(true)
              onSkip?.()
            }}
            data-testid="proposed-change-skip-btn"
          >
            Skip
          </Button>
        </div>
      )}
    </div>
  )
}
