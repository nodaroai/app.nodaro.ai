import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { PipelineStageStatus, ShowrunnerPlan, SubGateName } from "@nodaro/shared"
import { pipelinesApi } from "@/lib/pipelines-api"
import { usePipelineEvents } from "@/hooks/use-pipeline-events"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { StageRow } from "./stage-row"
import { EntityGrid } from "./entity-grid"
import { SceneGrid } from "./scene-grid"
import { DriftBanner } from "./drift-banner"
import { ForkButton } from "./fork-button"
import { SilentCutPreview } from "./silent-cut-preview"
import {
  DialogueRecheckBanner,
  type DialogueRecheckResult,
} from "./dialogue-recheck-banner"
import { Button } from "@/components/ui/button"

interface Props {
  pipelineId: string
  onClose: () => void
}

export function PipelinePanel({ pipelineId, onClose }: Props) {
  const [rejectMode, setRejectMode] = useState(false)
  const [feedback, setFeedback] = useState("")
  // Phase 1B.4 — local "dismissed" flag for the drift banner. Clears on the
  // next `pipeline:drift` SSE event (the hook returns a fresh object each
  // time, so the effect below resets dismissal on a new drift).
  const [driftDismissed, setDriftDismissed] = useState(false)

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

  const { lastEvent, drift, currentSubGate } = usePipelineEvents(pipelineId)

  // Phase 1C.2 — Stage 7 sub-gate detection. We pull `animate_audio_edit`
  // whenever the pipeline could plausibly be paused at one of its sub-gates:
  //   - SSE has just fired `stage:awaiting_sub_gate`, OR
  //   - the pipeline's `current_stage` is exactly `animate_audio_edit` (covers
  //     re-opening the panel against a paused pipeline before any SSE event
  //     arrives).
  // The query stays idle for earlier stages — and for `post_merge`, which
  // has its own dedicated query path in the panel — to avoid spurious 404s.
  const animateStageReachable =
    pipelineQuery.data?.current_stage === "animate_audio_edit"
  const subGateActive = Boolean(currentSubGate)
  const animateStageQuery = useQuery({
    queryKey: ["pipeline-stage", pipelineId, "animate_audio_edit"],
    queryFn: () => pipelinesApi.getStage(pipelineId, "animate_audio_edit"),
    enabled: subGateActive || animateStageReachable,
    refetchInterval: (q) =>
      q.state.data?.status === "awaiting_approval" ? 3000 : false,
    retry: false,
  })
  const setActivePipelineStatus = useWorkflowStore((s) => s.setActivePipelineStatus)
  // SSE `pipeline:forked` flips `activePipelineStatus` to "forked"; reading
  // from the store wins over the polled value so the ForkButton hides
  // immediately after a successful fork (before the next 3s poll).
  const activePipelineStatus = useWorkflowStore((s) => s.activePipelineStatus)

  // Phase 1B.4 — seed the canvas's `activePipelineStatus` from the polled
  // pipeline status. SSE events keep it fresh in real-time; this poll is the
  // safety net (e.g. the panel opens against an in-flight pipeline that has
  // already passed the initial status event).
  useEffect(() => {
    if (pipelineQuery.data?.status) {
      setActivePipelineStatus(pipelineQuery.data.status)
    }
  }, [pipelineQuery.data?.status, setActivePipelineStatus])

  // Refetch when SSE indicates a state change. Keyed on `lastEvent?.type` so
  // a no-op SSE re-fire (entity-level events) doesn't trigger a refetch.
  useEffect(() => {
    if (!lastEvent) return
    if (
      lastEvent.type === "stage:status" ||
      lastEvent.type === "pipeline:status" ||
      lastEvent.type === "pipeline:forked"
    ) {
      void pipelineQuery.refetch()
      void stageQuery.refetch()
      // Phase 1C.2 — refetch the animate_audio_edit stage too so any
      // sub-gate output (preview URL, rebalance result) lands in time for
      // the matching sub-gate UI to render.
      void animateStageQuery.refetch()
    }
    // Phase 1C.2 — sub-gate just opened; pull the latest stage output so
    // the panel renders the gate-specific data without waiting for the
    // 3s poll.
    if (lastEvent.type === "stage:awaiting_sub_gate") {
      void animateStageQuery.refetch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent?.type])

  // Phase 1B.4 — re-show the drift banner whenever a fresh drift summary
  // arrives. `drift` is referentially-stable per event so the effect only
  // fires on a real new event.
  useEffect(() => {
    if (drift) setDriftDismissed(false)
  }, [drift])

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
  const status = (stage?.status as PipelineStageStatus | undefined) ?? "queued"

  // Phase 1C.2 — derive the active sub-gate. SSE-driven `currentSubGate`
  // is the fast path (fires before any poll round-trips); the persisted
  // `animate_audio_edit.output.current_sub_gate` is the safety net when
  // the panel opens against a pipeline that's already paused at a gate.
  const animateOutput = animateStageQuery.data?.output as
    | {
        current_sub_gate?: SubGateName
        silent_cut_preview_url?: string
        dialogue_recheck_result?: DialogueRecheckResult
      }
    | undefined
  const persistedSubGate = animateOutput?.current_sub_gate ?? null
  const effectiveSubGate = currentSubGate ?? persistedSubGate
  const silentCutPreviewUrl = animateOutput?.silent_cut_preview_url ?? null
  const dialogueRecheckResult = animateOutput?.dialogue_recheck_result ?? null
  // Status the ForkButton uses to decide visibility. SSE-driven
  // `activePipelineStatus` (set by `usePipelineEvents` on `pipeline:forked`)
  // wins over the polled pipelines.get value so the button hides immediately
  // after a successful fork, before the next 3s poll round-trips.
  const effectiveStatus = activePipelineStatus ?? pipeline?.status ?? "queued"

  return (
    <aside className="fixed right-0 top-0 h-full w-[420px] border-l border-zinc-200 bg-zinc-50 p-4 overflow-y-auto z-40">
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="min-w-0">
          <div className="text-xs uppercase text-zinc-500">Pipeline</div>
          <div className="font-semibold truncate">{pipeline?.status ?? "loading..."}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ForkButton
            pipelineId={pipelineId}
            pipelineStatus={effectiveStatus}
            onForked={() => {
              void pipelineQuery.refetch()
            }}
          />
          <Button size="sm" variant="ghost" onClick={onClose}>×</Button>
        </div>
      </div>

      {!driftDismissed && drift && (
        <div className="mb-4">
          <DriftBanner
            drift={drift}
            onFork={async () => {
              try {
                await pipelinesApi.forkPipeline(pipelineId)
                void pipelineQuery.refetch()
              } catch (err) {
                console.error("[pipeline-panel] fork from drift failed:", err)
              }
            }}
            onDismiss={() => setDriftDismissed(true)}
          />
        </div>
      )}

      <div className="space-y-2">
        <StageRow
          stageLabel="1. Script"
          status={status}
          output={plan}
          onApprove={handleApprove}
          onReject={() => setRejectMode(true)}
        />
        {pipeline?.current_stage === "characters" && (
          <EntityGrid pipelineId={pipelineId} entityType="character" title="2. Characters" />
        )}
        {pipeline?.current_stage === "objects" && (
          <EntityGrid pipelineId={pipelineId} entityType="object" title="3. Objects" />
        )}
        {pipeline?.current_stage === "locations" && (
          <EntityGrid pipelineId={pipelineId} entityType="location" title="4. Locations" />
        )}
        {pipeline?.current_stage === "shot_list" && (
          <SceneGrid pipelineId={pipelineId} title="5. Shot List" />
        )}
      </div>

      {/* Phase 1C.2 — Stage 7 sub-gate review UIs. The SSE `currentSubGate`
          drives which gate (if any) is active; the matching payload is read
          from the persisted `animate_audio_edit` stage output JSONB. The
          gates are mutually exclusive — at most one renders at a time. */}
      {effectiveSubGate === "silent_cut_preview" && silentCutPreviewUrl && (
        <div className="mt-4">
          <SilentCutPreview
            pipelineId={pipelineId}
            previewUrl={silentCutPreviewUrl}
          />
        </div>
      )}
      {effectiveSubGate === "dialogue_recheck" && dialogueRecheckResult && (
        <div className="mt-4">
          <DialogueRecheckBanner
            pipelineId={pipelineId}
            rebalanceResult={dialogueRecheckResult}
          />
        </div>
      )}

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
