import { useState } from "react"
import { ArrowDown } from "lucide-react"
import type { EntityType, PipelineMode } from "@nodaro/shared"
import { usePipelineEntities } from "@/hooks/use-pipeline-entities"
import { pipelinesApi } from "@/lib/pipelines-api"
import { EntityCard } from "./entity-card"
import { Button } from "@/components/ui/button"

interface Props {
  pipelineId: string
  entityType: EntityType
  title: string
  /**
   * Phase 1D.2a §4.5 — when the parent pipeline is in `auto` mode the
   * orchestrator approves entities itself, so the user shouldn't see the
   * per-card Approve/Reject controls. Optional for backward compat with
   * existing call sites; `undefined` keeps manual-mode behavior.
   */
  mode?: PipelineMode | null
}

export function EntityGrid({ pipelineId, entityType, title, mode }: Props) {
  const { data, refetch } = usePipelineEntities(pipelineId, entityType)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)

  async function handleApprove(entityId: string) {
    setBusyId(entityId)
    try {
      await pipelinesApi.approveEntity(pipelineId, entityId)
      refetch()
    } finally {
      setBusyId(null)
    }
  }

  async function handleReject(entityId: string) {
    if (!feedback.trim()) return
    setBusyId(entityId)
    try {
      await pipelinesApi.rejectEntity(pipelineId, entityId, feedback)
      setRejectingId(null)
      setFeedback("")
      refetch()
    } finally {
      setBusyId(null)
    }
  }

  if (!data) return null

  // "Your turn" banner — surfaces when the engine is paused for the user
  // (manual/guided modes only; auto bulk-approves so this can't trigger).
  // Counts entities currently waiting on the user to review the generated
  // portrait. Failed/skipped/approved/pending/generating entities don't count
  // — they're either resolved or still mid-flight.
  //
  // Without this surface users with the pipeline panel scrolled below the fold
  // see no movement and think the pipeline is broken — see the stuck-pipeline
  // diagnostic that found 10+ pipelines sitting hours/days at awaiting_approval
  // for exactly this reason.
  const awaitingCount = data.filter((e) => e.status === "awaiting_approval").length
  const showYourTurn = (mode === "manual" || mode === "guided") && awaitingCount > 0

  // Entity-type label, singularized for "1" / pluralized otherwise. Matches
  // the surrounding panel's casual tone ("approve 1 character" reads natural,
  // "approve 1 characters" doesn't).
  const entityLabel =
    awaitingCount === 1 ? entityType : `${entityType}s`

  return (
    <div className="mb-4">
      <div className="text-xs uppercase text-zinc-500 dark:text-zinc-400 mb-2">{title}</div>
      {showYourTurn && (
        <div
          className="mb-2 rounded border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950 px-3 py-2 flex items-start gap-2"
          data-testid="your-turn-banner"
        >
          <ArrowDown className="w-4 h-4 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5 animate-bounce" />
          <div className="text-sm">
            <span className="font-medium text-amber-900 dark:text-amber-200">
              Your turn —
            </span>{" "}
            <span className="text-amber-800 dark:text-amber-200">
              review {awaitingCount} {entityLabel} below to continue.
            </span>
          </div>
        </div>
      )}
      {data.length === 0 ? (
        <div className="text-sm text-zinc-500 dark:text-zinc-400 italic">No entities yet</div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {data.map((entity) => (
            <EntityCard
              key={entity.id}
              entity={entity}
              pipelineId={pipelineId}
              onApprove={() => handleApprove(entity.id)}
              onReject={() => setRejectingId(entity.id)}
              onRecovered={() => refetch()}
              disabled={busyId === entity.id}
              mode={mode}
            />
          ))}
        </div>
      )}
      {rejectingId && (
        <div className="mt-3 p-3 rounded border border-zinc-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E]">
          <div className="text-sm font-semibold mb-2">Reject with feedback</div>
          <textarea
            className="w-full rounded border border-zinc-300 dark:border-[#2D2D2D] bg-white dark:bg-[#121212] p-2 text-sm"
            rows={3}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What should change?"
          />
          <div className="flex gap-2 mt-2">
            <Button
              size="sm"
              onClick={() => handleReject(rejectingId)}
              disabled={!feedback.trim()}
            >
              Submit
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setRejectingId(null)
                setFeedback("")
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
