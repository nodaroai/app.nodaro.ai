import type { PipelineMode, PipelineStageStatus, ShowrunnerPlan } from "@nodaro/shared"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface Props {
  stageLabel: string
  status: PipelineStageStatus | "queued"
  output?: ShowrunnerPlan | null
  criticFeedback?: unknown
  onApprove: () => void
  onReject: () => void
  disabled?: boolean
  /**
   * Phase 1D.2a §4.5 — when the parent pipeline is running in auto mode,
   * Approve/Reject are hidden (the orchestrator gates on critic verdicts,
   * not human input) and an "Auto: critic gating…" hint is rendered while
   * the stage is actively running. Optional so existing call sites still
   * work — undefined falls back to manual-mode behavior.
   */
  mode?: PipelineMode
}

const STATUS_COPY: Record<string, string> = {
  pending: "Waiting",
  queued: "Queued",
  running: "Running...",
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected — retrying",
  failed: "Failed",
  cancelled: "Cancelled",
}

export function StageRow({ stageLabel, status, output, onApprove, onReject, disabled, mode }: Props) {
  return (
    <div className="rounded border border-zinc-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3">
      <div className="flex items-center justify-between">
        <div className="font-medium">{stageLabel}</div>
        <div
          className={cn(
            "text-xs px-2 py-0.5 rounded",
            status === "running" && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
            status === "awaiting_approval" && "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
            status === "approved" && "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
            status === "failed" && "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
            status === "cancelled" && "bg-zinc-100 text-zinc-700 dark:bg-[#2D2D2D] dark:text-zinc-300",
          )}
        >
          {STATUS_COPY[status] ?? status}
        </div>
      </div>

      {/* Phase 1D.2a §4.5 — auto-mode hint while the stage is actively
          running. The critics make the gate decision, not the user. */}
      {mode === "auto" && status === "running" && (
        <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 italic">Auto: critic gating…</div>
      )}

      {output && status === "awaiting_approval" && (
        <div className="mt-3 space-y-2">
          <div className="text-sm">
            <div className="font-semibold">Title:</div> {output.title}
          </div>
          <div className="text-sm">
            <div className="font-semibold">Logline:</div> {output.logline}
          </div>
          <div className="text-sm">
            <div className="font-semibold">Scenes ({output.scenes.length}):</div>
            <ul className="ml-4 mt-1 list-disc text-xs">
              {output.scenes.map((s) => (
                <li key={s.scene_index}>
                  {s.scene_index}. {s.description} · {s.duration_seconds}s
                </li>
              ))}
            </ul>
          </div>
          {/* Phase 1D.2a §4.5 — Approve/Reject hidden in auto mode. The
              orchestrator drives gate decisions via the critic chain; the
              user can still switch to manual via the ModeSwitchButton in
              the panel header. */}
          {mode !== "auto" && (
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={onApprove} disabled={disabled}>Approve</Button>
              <Button size="sm" variant="outline" onClick={onReject} disabled={disabled}>Reject</Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
