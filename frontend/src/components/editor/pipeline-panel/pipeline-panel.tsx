import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { ShowrunnerPlan } from "@nodaro/shared"
import { pipelinesApi } from "@/lib/pipelines-api"
import { usePipelineEvents } from "@/hooks/use-pipeline-events"
import { StageRow } from "./stage-row"
import { Button } from "@/components/ui/button"

interface Props {
  pipelineId: string
  onClose: () => void
}

export function PipelinePanel({ pipelineId, onClose }: Props) {
  const [rejectMode, setRejectMode] = useState(false)
  const [feedback, setFeedback] = useState("")

  const pipelineQuery = useQuery({
    queryKey: ["pipeline", pipelineId],
    queryFn: () => pipelinesApi.get(pipelineId),
    refetchInterval: (q) =>
      q.state.data?.status === "completed" || q.state.data?.status === "failed" ? false : 3000,
  })

  const stageQuery = useQuery({
    queryKey: ["pipeline-stage", pipelineId, "script"],
    queryFn: () => pipelinesApi.getStage(pipelineId, "script"),
    refetchInterval: (q) => (q.state.data?.status === "approved" ? false : 5000),
    retry: false,
  })

  const { events } = usePipelineEvents(pipelineId)

  // Refetch when SSE indicates a state change.
  useEffect(() => {
    if (events.length === 0) return
    const latest = events[events.length - 1]
    if (latest.type === "stage:status" || latest.type === "pipeline:status") {
      void pipelineQuery.refetch()
      void stageQuery.refetch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length])

  async function handleApprove() {
    await pipelinesApi.approveStage(pipelineId, "script")
    void pipelineQuery.refetch()
  }

  async function handleReject() {
    if (!feedback.trim()) return
    await pipelinesApi.rejectStage(pipelineId, "script", feedback)
    setRejectMode(false)
    setFeedback("")
    void pipelineQuery.refetch()
    void stageQuery.refetch()
  }

  async function handleCancel() {
    if (!confirm("Cancel this pipeline run? Unspent credits will be refunded.")) return
    await pipelinesApi.cancel(pipelineId)
    void pipelineQuery.refetch()
  }

  const pipeline = pipelineQuery.data
  const stage = stageQuery.data
  const plan = (stage?.output as { plan?: ShowrunnerPlan } | undefined)?.plan ?? null
  const status = (stage?.status as "pending" | "running" | "awaiting_approval" | "approved" | "rejected" | "failed" | "cancelled" | undefined) ?? "queued"

  return (
    <aside className="fixed right-0 top-0 h-full w-[420px] border-l border-zinc-200 bg-zinc-50 p-4 overflow-y-auto z-40">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs uppercase text-zinc-500">Pipeline</div>
          <div className="font-semibold">{pipeline?.status ?? "loading..."}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>×</Button>
      </div>

      <div className="space-y-2">
        <StageRow
          stageLabel="1. Script"
          status={status}
          output={plan}
          onApprove={handleApprove}
          onReject={() => setRejectMode(true)}
        />
        {/* Phase 1B+ stages render below as they ship */}
      </div>

      {rejectMode && (
        <div className="mt-4 p-3 rounded border border-zinc-200 bg-white">
          <div className="text-sm font-semibold mb-2">Reject with feedback</div>
          <textarea
            className="w-full rounded border border-zinc-300 p-2 text-sm"
            rows={4}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What should the Showrunner change?"
          />
          <div className="flex gap-2 mt-2">
            <Button size="sm" onClick={handleReject} disabled={!feedback.trim()}>Submit</Button>
            <Button size="sm" variant="outline" onClick={() => setRejectMode(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="mt-6 text-xs text-zinc-500">
        Estimated cost: {pipeline?.upfront_credit_estimate ?? "—"} credits ·
        Spent: {pipeline?.spent_credits ?? 0}
      </div>

      <div className="mt-4">
        <Button size="sm" variant="outline" onClick={handleCancel}
          disabled={pipeline?.status === "completed" || pipeline?.status === "failed" || pipeline?.status === "cancelled"}>
          Cancel run
        </Button>
      </div>
    </aside>
  )
}
