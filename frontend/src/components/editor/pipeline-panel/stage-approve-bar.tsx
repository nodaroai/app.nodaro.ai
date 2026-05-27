import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Props {
  /** Human-readable stage label, e.g. "2. Characters". */
  stageLabel: string
  /** Approve the stage's variant batch and advance to the next stage. */
  onApprove: () => Promise<void>
}

/**
 * Stage-level "approve the variant batch & continue" bar for the entity stages
 * (characters / objects / locations).
 *
 * Those stages pause at a stage-level batch-approval gate
 * (`pipeline_stages.status='awaiting_approval'`) once every entity has its
 * variants generated. But — unlike the script stage, which renders a StageRow
 * with Approve/Reject — the entity grids render only PER-ENTITY approve. There
 * was no UI path to call `approveStage(id, stage)`, so a manual-mode pipeline
 * could never advance past characters even after all variants generated. This
 * bar closes that gap. The parent renders it only when the entity stage is at
 * `awaiting_approval` and mode !== 'auto'.
 */
export function StageApproveBar({ stageLabel, onApprove }: Props) {
  const [busy, setBusy] = useState(false)

  async function handleClick() {
    setBusy(true)
    try {
      await onApprove()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="rounded border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950 p-3 flex items-center justify-between gap-3"
      data-testid="stage-approve-bar"
    >
      <div className="text-sm text-blue-900 dark:text-blue-200">
        All variants for <span className="font-semibold">{stageLabel}</span> are
        ready. Approve to continue to the next stage.
      </div>
      <Button
        size="sm"
        disabled={busy}
        onClick={handleClick}
        className="shrink-0 bg-[#ff0073] hover:bg-[#ff0073]/90 text-white"
        data-testid="stage-approve-button"
      >
        {busy && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
        {busy ? "Approving…" : "Approve variants & continue"}
      </Button>
    </div>
  )
}
