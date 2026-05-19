import { Badge } from "@/components/ui/badge"
import { SubGateApprovalCard } from "./sub-gate-approval-card"

/**
 * Mirrors `DialogueRecheckResult` from
 * `backend/src/ee/pipelines/sub-steps/dialogue-recheck.ts`. The shape is
 * persisted onto `pipeline_stages.output.dialogue_recheck_result` and fanned
 * out to the SSE consumer via `stage:awaiting_sub_gate.payload`.
 *
 * Kept frontend-local because the result type isn't exported through
 * `@nodaro/shared` (it's a server-side coordination contract, not a public
 * API). Whenever the backend shape grows, this mirror needs to grow too.
 */
export interface DialogueRebalanceEntry {
  readonly scene_entity_id: string
  readonly shot_id: string
  readonly delta_sec: number
  readonly new_intended_duration_sec: number
}

export interface DialogueRecheckResult {
  readonly ok: boolean
  readonly rebalances: ReadonlyArray<DialogueRebalanceEntry>
  readonly warnings: ReadonlyArray<string>
  readonly awaitingUserDecision: boolean
}

interface Props {
  readonly pipelineId: string
  readonly rebalanceResult: DialogueRecheckResult
}

/**
 * Phase 1C.2 — Stage 7 sub-gate `dialogue_recheck`.
 *
 * Surfaces the rebalance plan the dialogue-recheck sub-step computed when
 * actual ElevenLabs audio durations diverged from the shot-list estimate.
 * The approve/reject state machine lives in `SubGateApprovalCard`; this
 * component contributes the amber-themed Card styling + rebalance grid.
 */
export function DialogueRecheckBanner({ pipelineId, rebalanceResult }: Props) {
  const { rebalances, warnings } = rebalanceResult

  return (
    <SubGateApprovalCard
      pipelineId={pipelineId}
      gate="dialogue_recheck"
      title="Dialogue duration recheck"
      description={
        <div className="text-xs text-amber-800/80 dark:text-amber-200/80">
          Actual audio durations diverged from the shot-list estimate. Review
          the proposed rebalance below.
        </div>
      }
      approveLabel="Approve rebalance"
      rejectTitle="Reject rebalance"
      rejectPlaceholder="What should change about the dialogue plan? (optional)"
      className="border-amber-300 bg-amber-50/60 dark:bg-amber-950/20"
      cardTestId="dialogue-recheck-banner"
      rejectButtonVariant="outline"
    >
      {rebalances.length === 0 && (
        <div className="text-sm text-amber-800 dark:text-amber-200">
          No shot durations need adjustment.
        </div>
      )}
      {rebalances.length > 0 && (
        <div className="rounded border border-amber-200 bg-white dark:bg-zinc-900 divide-y divide-amber-100 dark:divide-amber-900/40">
          {rebalances.map((entry) => (
            <div
              key={`${entry.scene_entity_id}:${entry.shot_id}`}
              className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
              data-testid="dialogue-rebalance-entry"
            >
              <div className="min-w-0 truncate">
                <span className="font-mono text-zinc-500">scene</span>{" "}
                <span className="font-medium" title={entry.scene_entity_id}>
                  {entry.scene_entity_id.slice(0, 8)}
                </span>
                {" · "}
                <span className="font-mono text-zinc-500">shot</span>{" "}
                <span className="font-medium">{entry.shot_id}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="font-mono">
                  {entry.delta_sec >= 0 ? "+" : ""}
                  {entry.delta_sec.toFixed(2)}s
                </Badge>
                <span className="text-zinc-600 dark:text-zinc-300">
                  → {entry.new_intended_duration_sec.toFixed(2)}s
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="rounded border border-amber-200 bg-white/70 dark:bg-zinc-900/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 list-disc list-inside space-y-1">
          {warnings.map((w, i) => (
            <li key={i} data-testid="dialogue-recheck-warning">
              {w}
            </li>
          ))}
        </ul>
      )}
    </SubGateApprovalCard>
  )
}
