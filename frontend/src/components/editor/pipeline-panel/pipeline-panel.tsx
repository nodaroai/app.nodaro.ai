import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type {
  ChatEnabledStage,
  PipelineStageStatus,
  ShowrunnerPlan,
  StoryboardCohesionCriticVerdict,
  SubGateName,
  VideoCriticShotFields,
} from "@nodaro/shared"
import { PIPELINE_STAGE_NAMES, type PipelineStageName } from "@nodaro/shared"
import { toast } from "sonner"
import { ArrowLeft } from "lucide-react"
import { pipelinesApi } from "@/lib/pipelines-api"
import { usePipelineEvents } from "@/hooks/use-pipeline-events"
import { usePipelineEntities } from "@/hooks/use-pipeline-entities"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { StageRow } from "./stage-row"
import { ScriptPanel } from "./script-panel"
import { EntityGrid } from "./entity-grid"
import { CharactersPanel } from "./characters-panel"
import { SceneGrid } from "./scene-grid"
import { DriftBanner } from "./drift-banner"
import { ForkButton } from "./fork-button"
import { ModeSwitchButton } from "./mode-switch-button"
import { SilentCutPreview } from "./silent-cut-preview"
import { StoryboardCohesionBanner } from "./storyboard-cohesion-banner"
import {
  VideoCriticSummaryBanner,
  type FailingShot,
} from "./video-critic-summary-banner"
import {
  DialogueRecheckBanner,
  type DialogueRecheckResult,
} from "./dialogue-recheck-banner"
import { StageProgressBanner } from "./stage-progress-banner"
import { ChatPanel } from "./chat/chat-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

/** Human-readable label for each pipeline stage (ordered). */
const STAGE_LABELS: Record<PipelineStageName, string> = {
  script: "1. Script",
  characters: "2. Characters",
  objects: "3. Objects",
  locations: "4. Locations",
  shot_list: "5. Shot List",
  scene_images: "6. Scene Images",
  animate_audio_edit: "7. Animate & Audio",
  post_merge: "8. Final Merge",
}

/**
 * Phase 1D.2c-b-i — pipeline stages at or after `scene_images`. Used to
 * gate the Stage 6 query (and therefore the Storyboard Cohesion banner)
 * so we only fetch once the pipeline has progressed to Stage 6+.
 * Hoisted to module-level so the array isn't re-allocated on every render.
 */
const STAGES_AT_OR_AFTER_SCENE_IMAGES: ReadonlyArray<PipelineStageName> = [
  "scene_images",
  "animate_audio_edit",
  "post_merge",
]

/**
 * Terminal pipeline statuses — polling on stage queries should stop once the
 * parent pipeline reaches any of these, since the persisted output is
 * immutable from that point onward.
 */
function isTerminalPipelineStatus(status: string | null | undefined): boolean {
  return status === "completed" || status === "failed" || status === "cancelled"
}

interface Props {
  pipelineId: string
  onClose: () => void
  /**
   * Phase 1D.3 — optional callback invoked when the user clicks the
   * "Branched from" breadcrumb link. The parent (workflow-editor-main.tsx)
   * is responsible for navigating to the parent pipeline's node on the canvas.
   */
  onNavigateToPipeline?: (targetPipelineId: string) => void
}

export function PipelinePanel({ pipelineId, onClose, onNavigateToPipeline }: Props) {
  const [rejectMode, setRejectMode] = useState(false)
  const [feedback, setFeedback] = useState("")
  // Phase 1B.4 — local "dismissed" flag for the drift banner. Clears on the
  // next `pipeline:drift` SSE event (the hook returns a fresh object each
  // time, so the effect below resets dismissal on a new drift).
  const [driftDismissed, setDriftDismissed] = useState(false)
  // Phase 1D.2c-b-i — local dismiss flag for the Storyboard Cohesion banner.
  // Reset on a fresh panel mount (per-pipelineId) so a new verdict on a
  // re-opened panel re-shows it. The verdict itself is persisted on the
  // stage output, so the banner re-mounts with the same data either way.
  const [cohesionDismissed, setCohesionDismissed] = useState(false)
  // Phase 1D.2c-b-ii — same dismiss pattern for the Video Critic summary
  // banner. The failing-shots list is derived from scene-entity metadata
  // (persisted by scene-internal-pipeline.ts in Stage 7), so dismissing
  // is purely local UI state — the underlying data stays put and the
  // banner re-appears on a fresh panel open.
  const [videoCriticDismissed, setVideoCriticDismissed] = useState(false)
  // Phase 1D.3 — track which stage (if any) is currently branching so the
  // button shows a loading state and the user can't double-click.
  const [branchingStage, setBranchingStage] = useState<PipelineStageName | null>(null)

  const pipelineQuery = useQuery({
    queryKey: ["pipeline", pipelineId],
    queryFn: () => pipelinesApi.get(pipelineId),
    refetchInterval: (q) => (isTerminalPipelineStatus(q.state.data?.status) ? false : 3000),
    // Don't waste 3 default retries when the pipeline genuinely doesn't
    // exist (common case: stale `pipeline_id` baked into a saved node from
    // a previous run that's since been deleted — every panel mount fires
    // a doomed GET that 404s 4x in a row, spamming the console).
    // Transient race (panel mounts in the ~50ms window between POST insert
    // and replica visibility) is rare in practice; if it does happen the
    // 3-second refetchInterval picks it up immediately. Skipping retries
    // for 404 also makes the failure surface faster so the parent can
    // clear the stale node ref.
    retry: (failureCount, err) => {
      if (err instanceof Error && err.message.startsWith("404")) return false
      return failureCount < 1
    },
  })

  const stageQuery = useQuery({
    queryKey: ["pipeline-stage", pipelineId, "script"],
    queryFn: () => pipelinesApi.getStage(pipelineId, "script"),
    refetchInterval: (q) => {
      if (isTerminalPipelineStatus(pipelineQuery.data?.status)) return false
      return q.state.data?.status === "approved" ? false : 5000
    },
    retry: false,
  })

  const { lastEvent, drift, currentSubGate, stageProgress } = usePipelineEvents(pipelineId)

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
    refetchInterval: (q) => {
      // Terminal pipeline state → stop polling entirely. Drive-by polish
      // applied alongside the sceneImagesStageQuery refetchInterval fix.
      if (isTerminalPipelineStatus(pipelineQuery.data?.status)) return false
      return q.state.data?.status === "awaiting_approval" ? 3000 : false
    },
    retry: false,
  })

  // Phase 1D.2c-b-i — Stage 6 (scene_images) query for the Storyboard
  // Cohesion verdict. The critic writes its output onto this stage during
  // Stage 6 finalization (see `scene-images.ts` — fields named
  // `storyboard_cohesion_*`). The query is enabled once the pipeline has
  // advanced through Stage 6 (current_stage is scene_images OR any later
  // stage) so the banner re-mounts even after the user re-opens the panel
  // against a paused/completed pipeline. Polling stops once the stage is
  // approved OR the pipeline reaches a terminal state — the verdict is
  // immutable after that.
  const sceneImagesStageReachable =
    pipelineQuery.data?.current_stage !== undefined &&
    pipelineQuery.data?.current_stage !== null &&
    (STAGES_AT_OR_AFTER_SCENE_IMAGES as ReadonlyArray<string>).includes(
      pipelineQuery.data.current_stage,
    )
  // The scene_images query is also relevant for completed pipelines — the
  // user re-opens the panel and we still want to surface the cohesion verdict
  // alongside the "Re-run from here" controls.
  const sceneImagesStageQuery = useQuery({
    queryKey: ["pipeline-stage", pipelineId, "scene_images"],
    queryFn: () => pipelinesApi.getStage(pipelineId, "scene_images"),
    enabled:
      sceneImagesStageReachable || pipelineQuery.data?.status === "completed",
    refetchInterval: (q) => {
      // Terminal pipeline state → stop polling entirely. The verdict is
      // immutable after the stage approves / pipeline ends; continuing to
      // poll wastes a network round-trip every 5s.
      if (isTerminalPipelineStatus(pipelineQuery.data?.status)) return false
      return q.state.data?.status === "approved" ? false : 5000
    },
    retry: false,
  })

  // Phase 1D.2c — Stage 8 (post_merge) query, gating the post-merge chat
  // mount. Stage 8 reaches `awaiting_approval` after the final video is
  // rendered (in manual + guided modes; auto-mode auto-advances and never
  // pauses here — see backend/src/ee/pipelines/stages/post-merge.ts). We
  // only fetch it when the pipeline has actually progressed there, to avoid
  // spurious 404s while earlier stages are still running. Polling stops
  // once the stage approves OR the pipeline ends.
  //
  // The `completed` clause mirrors `sceneImagesStageQuery`'s enabled gate:
  // re-opening the panel for a finished pipeline still needs the post_merge
  // stage data hydrated so the chat surface (and any post-merge details)
  // render against the persisted artifact.
  const postMergeStageReachable =
    pipelineQuery.data?.current_stage === "post_merge"
  const postMergeStageQuery = useQuery({
    queryKey: ["pipeline-stage", pipelineId, "post_merge"],
    queryFn: () => pipelinesApi.getStage(pipelineId, "post_merge"),
    enabled:
      postMergeStageReachable || pipelineQuery.data?.status === "completed",
    refetchInterval: (q) => {
      if (isTerminalPipelineStatus(pipelineQuery.data?.status)) return false
      return q.state.data?.status === "awaiting_approval" ||
        q.state.data?.status === "running"
        ? 5000
        : false
    },
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

  // Refetch when SSE indicates a state change. Keyed on `lastEvent` (the full
  // object, not `lastEvent?.type`) because back-to-back stage:status events
  // for different stages share the same `type` discriminant — keying on
  // `.type` would collapse them and silently drop the second event's
  // stage-specific refetch. `setLastEvent(evt)` in use-pipeline-events.ts:102
  // emits a fresh object reference per SSE frame, so the dep change does not
  // introduce spurious re-fires.
  useEffect(() => {
    if (!lastEvent) return
    if (
      lastEvent.type === "pipeline:status" ||
      lastEvent.type === "pipeline:forked"
    ) {
      void pipelineQuery.refetch()
      void stageQuery.refetch()
      void animateStageQuery.refetch()
      void sceneImagesStageQuery.refetch()
      void postMergeStageQuery.refetch()
    }
    // Stage-level events: only refetch the affected stage query (was
    // indiscriminately refetching every stage query on every `stage:status`
    // event, wasting ~6 refetches per pipeline run).
    if (lastEvent.type === "stage:status") {
      void pipelineQuery.refetch()
      if (lastEvent.stageName === "script") {
        void stageQuery.refetch()
      }
      if (lastEvent.stageName === "scene_images") {
        void sceneImagesStageQuery.refetch()
      }
      if (lastEvent.stageName === "animate_audio_edit") {
        void animateStageQuery.refetch()
      }
      if (lastEvent.stageName === "post_merge") {
        void postMergeStageQuery.refetch()
      }
    }
    // Phase 1C.2 — sub-gate just opened; pull the latest stage output so
    // the panel renders the gate-specific data without waiting for the
    // 3s poll.
    if (lastEvent.type === "stage:awaiting_sub_gate") {
      void animateStageQuery.refetch()
    }
    // /simplify pass-2 — Phase 1D.2c-b-ii Video Critic surface uses
    // scene-entity metadata as the source of truth for the per-shot
    // `video_critic_failed` flag (which drives the VideoCriticSummaryBanner
    // rollup + per-shot Skip/Regenerate buttons). Backend emits
    // `shot:status` on every critic verdict + after Skip/Retry recovery; the
    // panel's polling-only refresh left the banner stale up to 5s. Refetch
    // immediately on the event.
    if (lastEvent.type === "shot:status") {
      void sceneEntitiesQuery.refetch()
    }
  }, [lastEvent])

  // Phase 1B.4 — re-show the drift banner whenever a fresh drift summary
  // arrives. `drift` is referentially-stable per event so the effect only
  // fires on a real new event.
  useEffect(() => {
    if (drift) setDriftDismissed(false)
  }, [drift])

  // Phase 1D.2c-b-i — reset the cohesion-banner dismissal whenever the
  // panel switches to a different pipeline. Phase 1D.3's "Re-run from here"
  // calls `onNavigateToPipeline`, which swaps `pipelineId` in place WITHOUT
  // unmounting the panel — so without this effect the dismiss flag would
  // persist and the new pipeline's verdict would be silently suppressed.
  useEffect(() => {
    setCohesionDismissed(false)
    // Phase 1D.2c-b-ii — same reset for the Video Critic summary banner.
    setVideoCriticDismissed(false)
  }, [pipelineId])

  async function handleApprove() {
    try {
      await pipelinesApi.approveStage(pipelineId, "script")
    } catch (err) {
      // 409 `stage_already_advanced` means the stage was approved by a
      // prior click (or a concurrent path); the desired end state is
      // already reached, so we refetch to sync the UI rather than
      // surface the error. Any other error re-throws so the user sees it.
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes("stage_already_advanced")) throw err
    }
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

  /**
   * Phase 1D.3 — Branch the completed pipeline from `stage`. Creates a new
   * pipeline that inherits all upstream stages as 'approved' and re-runs from
   * the given stage. On success, toasts a confirmation; the caller is
   * responsible for navigating to the new pipeline (via `onNavigateToPipeline`).
   */
  async function handleBranch(stage: PipelineStageName) {
    setBranchingStage(stage)
    try {
      const result = await pipelinesApi.branch(pipelineId, stage)
      toast.success(`Re-run started from "${STAGE_LABELS[stage]}". New pipeline: ${result.pipelineId.slice(0, 8)}…`)
      onNavigateToPipeline?.(result.pipelineId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(`Failed to branch pipeline: ${message}`)
    } finally {
      setBranchingStage(null)
    }
  }

  const pipeline = pipelineQuery.data
  const stage = stageQuery.data
  const plan = (stage?.output as { plan?: ShowrunnerPlan } | undefined)?.plan ?? null
  const status = (stage?.status as PipelineStageStatus | undefined) ?? "queued"

  // Phase 1D.2b + 1D.2c — Guided-mode chat panel mount conditional.
  // mode==='guided' AND a chat-wired stage is currently awaiting_approval.
  // Two wired stages today:
  //   - Script (1D.2b): `stage` query above tracks the script row.
  //   - Post-merge (1D.2c): `postMergeStageQuery` tracks Stage 8.
  // shot_list is in CHAT_ENABLED_STAGES but the specialist isn't wired yet
  // (CHAT_WIRED_STAGES.shot_list === false on the backend), so we don't
  // even consider it here.
  const isScriptAwaitingApproval =
    pipelineQuery.data?.current_stage === "script" &&
    status === "awaiting_approval"
  const isPostMergeAwaitingApproval =
    pipelineQuery.data?.current_stage === "post_merge" &&
    postMergeStageQuery.data?.status === "awaiting_approval"
  const chatStage: ChatEnabledStage | null =
    pipeline?.mode === "guided"
      ? isScriptAwaitingApproval
        ? "script"
        : isPostMergeAwaitingApproval
          ? "post_merge"
          : null
      : null

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

  // Phase 1D.2c-b-i — Storyboard Cohesion verdict (Stage 6 output JSONB).
  // The banner mounts only when ALL four fields are present — the critic is
  // best-effort (`scene-images.ts` catches every error path and advances the
  // stage with NOTHING written to the cohesion-* output fields), so a
  // partial write would indicate an upstream bug; defending here keeps the
  // surface stable across schema changes regardless.
  const sceneImagesStageOutput = sceneImagesStageQuery.data?.output as
    | {
        storyboard_cohesion_findings?: StoryboardCohesionCriticVerdict["findings"]
        storyboard_cohesion_assessment?: StoryboardCohesionCriticVerdict["overall_assessment"]
        storyboard_cohesion_score?: number
        storyboard_cohesion_summary?: string
      }
    | undefined
  const cohesionFindings = sceneImagesStageOutput?.storyboard_cohesion_findings
  const cohesionAssessment = sceneImagesStageOutput?.storyboard_cohesion_assessment
  const cohesionScore = sceneImagesStageOutput?.storyboard_cohesion_score
  const cohesionSummary = sceneImagesStageOutput?.storyboard_cohesion_summary
  const showCohesionBanner =
    !cohesionDismissed &&
    cohesionFindings !== undefined &&
    cohesionAssessment !== undefined &&
    cohesionScore !== undefined &&
    cohesionSummary !== undefined

  // Phase 1D.2c-b-ii — Video Critic per-shot failure rollup.
  // Stage 7 (scene-internal-pipeline) persists `video_critic_failed` and
  // friends onto each scene's `metadata.scene_node_data.shots[N]`. We pull
  // the scene entities here (the same data the SceneGrid uses) and walk
  // them to build the failing-shots list. The query is auto-disabled by
  // `usePipelineEntities` when `pipelineId` is falsy, and only polls while
  // at least one row is still mid-flight — so the cost is bounded.
  const sceneEntitiesQuery = usePipelineEntities(pipelineId, "scene")
  const failingShots = useMemo<FailingShot[]>(() => {
    const out: FailingShot[] = []
    for (const entity of sceneEntitiesQuery.data ?? []) {
      const metadata = (entity.metadata ?? {}) as Record<string, unknown>
      const sceneNodeData = (metadata.scene_node_data ?? {}) as {
        scene_index?: number
        shots?: Array<{ shot_id?: string } & VideoCriticShotFields>
      }
      const sceneIndex = sceneNodeData.scene_index ?? 0
      const shots = sceneNodeData.shots ?? []
      shots.forEach((shot, shotIdx) => {
        if (shot.video_critic_failed === true && shot.shot_id) {
          out.push({
            sceneId: entity.id,
            sceneIndex,
            shotId: shot.shot_id,
            shotIndex: shotIdx + 1,
            findingCount: shot.video_critic_findings?.length ?? 0,
            identified_action: shot.video_critic_identified_action,
          })
        }
      })
    }
    return out
  }, [sceneEntitiesQuery.data])
  // Banner mounts when Stage 7 is awaiting_approval (the user is reviewing
  // the animated output) OR the pipeline failed (so the user can see what
  // blocked completion). Hidden during normal Stage 7 progression so it
  // doesn't flash before the retries finish.
  const stage7AwaitingApproval =
    animateStageQuery.data?.status === "awaiting_approval"
  const pipelineFailed = pipeline?.status === "failed"
  const showVideoCriticBanner =
    !videoCriticDismissed &&
    failingShots.length > 0 &&
    (stage7AwaitingApproval || pipelineFailed)
  // Status the ForkButton uses to decide visibility. SSE-driven
  // `activePipelineStatus` (set by `usePipelineEvents` on `pipeline:forked`)
  // wins over the polled pipelines.get value so the button hides immediately
  // after a successful fork, before the next 3s poll round-trips.
  const effectiveStatus = activePipelineStatus ?? pipeline?.status ?? "queued"

  return (
    <>
      {chatStage && (
        <ChatPanel
          pipelineId={pipelineId}
          stage={chatStage}
          onApplied={() => {
            void pipelineQuery.refetch()
            // Refetch the stage that just received the apply so the panel
            // sees the new attempt + the stage's approved status without
            // waiting for the next 5s poll.
            if (chatStage === "script") {
              void stageQuery.refetch()
            } else if (chatStage === "post_merge") {
              void postMergeStageQuery.refetch()
            }
          }}
        />
      )}
    <aside className="fixed right-0 top-0 h-full w-[420px] border-l border-zinc-200 dark:border-[#2D2D2D] bg-zinc-50 dark:bg-[#121212] p-4 overflow-y-auto z-40">
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="min-w-0">
          <div className="text-xs uppercase text-zinc-500 dark:text-zinc-400">Pipeline</div>
          <div className="font-semibold truncate">{pipeline?.status ?? "loading..."}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {/* Phase 1D.2a §4.5 — Auto/Guided mode badge. Visible while the
              pipeline is running in either non-manual mode; once the user
              clicks "Switch to Manual" (below) the badge disappears on the
              next pipeline refetch. */}
          {pipeline?.mode === "auto" && (
            <Badge
              variant="outline"
              className="bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-300"
              data-testid="mode-badge-auto"
            >
              Auto Mode
            </Badge>
          )}
          {pipeline?.mode === "guided" && (
            <Badge
              variant="outline"
              className="bg-pink-50 border-pink-300 text-[#ff0073] dark:bg-pink-950 dark:border-pink-700 dark:text-[#ff66ad]"
              data-testid="mode-badge-guided"
            >
              Guided
            </Badge>
          )}
          <ModeSwitchButton
            pipelineId={pipelineId}
            mode={pipeline?.mode ?? null}
            status={pipeline?.status}
            onSwitched={() => {
              void pipelineQuery.refetch()
            }}
          />
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

      {/* Phase 1D.3 — Branch lineage breadcrumb. Shown only when this pipeline
          was created via "Re-run from here" (i.e. it has a parent pipeline).
          Clicking "original pipeline" invokes the `onNavigateToPipeline` prop
          so the canvas can scroll to / select the parent node. */}
      {pipeline?.branched_from_pipeline_id && (
        <div className="text-xs text-muted-foreground mb-3 flex items-center gap-1 flex-wrap"
          data-testid="branch-lineage-breadcrumb">
          <ArrowLeft className="w-3 h-3 shrink-0" />
          <span>Branched from</span>
          <button
            className="underline hover:text-foreground transition-colors"
            onClick={() => onNavigateToPipeline?.(pipeline.branched_from_pipeline_id!)}
          >
            original pipeline
          </button>
          <span className="text-muted-foreground/70">
            (at {pipeline.branched_from_stage})
          </span>
        </div>
      )}

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

      {/* Phase 1D.2c-b-i — Storyboard Cohesion verdict banner. Mounts as soon
          as Stage 6 has written the four cohesion fields onto its output;
          stays visible until the user dismisses it. The Branch CTA only
          appears for `assessment === "incoherent"` and re-uses the existing
          handleBranch helper (which powers the "Re-run from here" buttons)
          to fork from the shot_list stage. */}
      {showCohesionBanner && (
        <div className="mb-4">
          <StoryboardCohesionBanner
            assessment={cohesionAssessment!}
            score={cohesionScore!}
            summary={cohesionSummary!}
            findings={cohesionFindings!}
            onBranchFromShotList={() => {
              void handleBranch("shot_list")
            }}
            onDismiss={() => setCohesionDismissed(true)}
          />
        </div>
      )}

      {/* Phase 1D.2c-b-ii — Video Critic per-shot failure rollup banner.
          Mounts when Stage 7 reaches awaiting_approval OR the pipeline failed
          AND ≥1 shot retains `video_critic_failed=true` after the retry
          budget exhausted. Jump-to-shot wiring is left to a future canvas
          integration (J1 will land the recovery routes; the per-shot Skip /
          Regenerate buttons in scene-configs read the same data). */}
      {showVideoCriticBanner && (
        <div className="mb-4">
          <VideoCriticSummaryBanner
            failingShots={failingShots}
            onDismiss={() => setVideoCriticDismissed(true)}
          />
        </div>
      )}

      {/* LLM-stream progress banner — Stage 1 Showrunner today; same pattern
          extends to any future stage that calls callLLM with onProgress.
          Two sources, live SSE wins:
            1. `stageProgress` from usePipelineEvents — sub-second live
               updates while the user has the panel open.
            2. `pipeline.current_progress_message` — persisted by the
               backend showrunner's onProgress. Lets a refresh-survivor
               viewer (or first-time panel mount during an in-flight stream)
               see the banner immediately, instead of staring at an empty
               panel until the next ~750ms SSE throttle window fires.
          Both are auto-cleared when the matching stage transitions out
          of `running` (SSE side) or when the stream finalizes / pipeline
          is cancelled (DB side). */}
      {stageProgress ? (
        <StageProgressBanner
          stageName={stageProgress.stageName}
          message={stageProgress.message}
          bytesSoFar={stageProgress.bytesSoFar}
        />
      ) : pipeline?.current_progress_message && pipeline?.current_stage ? (
        <StageProgressBanner
          stageName={pipeline.current_stage as PipelineStageName}
          message={pipeline.current_progress_message}
        />
      ) : null}

      <div className="space-y-2">
        {/* Phase 1 (granular-pipeline-control) — when Stage 1 is awaiting
            approval in a non-auto mode, render the inline-editing
            ScriptPanel instead of the binary approve/reject StageRow. A
            small "Regenerate all" link below preserves the reject escape
            hatch (triggers the existing rejectMode feedback box). Auto
            mode + every other state still falls through to StageRow. */}
        {isScriptAwaitingApproval && plan && pipeline?.mode !== "auto" ? (
          <>
            <ScriptPanel
              pipelineId={pipelineId}
              plan={plan}
              userEdits={(stage as { user_edits?: unknown[] | null } | undefined)?.user_edits ?? null}
            />
            <div className="flex justify-end pt-1 text-xs">
              <button
                type="button"
                onClick={() => setRejectMode(true)}
                className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Regenerate all
              </button>
            </div>
          </>
        ) : (
          <StageRow
            stageLabel="1. Script"
            status={status}
            output={plan}
            onApprove={handleApprove}
            onReject={() => setRejectMode(true)}
            mode={pipeline?.mode ?? undefined}
          />
        )}
        {pipeline?.current_stage === "characters" && (
          // Phase 3 (granular-pipeline-control) — CharactersPanel hosts the
          // Step A wizard for manual/guided pipelines and falls through to
          // the original EntityGrid when no entity is at `pending_description`
          // (the Step B review surface). Auto mode never sees a
          // `pending_description` row because the engine bulk-flips at stage
          // start, so the same component renders EntityGrid for auto runs.
          <CharactersPanel
            pipelineId={pipelineId}
            plan={plan}
            mode={pipeline?.mode ?? undefined}
          />
        )}
        {pipeline?.current_stage === "objects" && (
          <EntityGrid
            pipelineId={pipelineId}
            entityType="object"
            title="3. Objects"
            mode={pipeline?.mode ?? undefined}
          />
        )}
        {pipeline?.current_stage === "locations" && (
          <EntityGrid
            pipelineId={pipelineId}
            entityType="location"
            title="4. Locations"
            mode={pipeline?.mode ?? undefined}
          />
        )}
        {pipeline?.current_stage === "shot_list" && (
          <SceneGrid pipelineId={pipelineId} title="5. Shot List" />
        )}
      </div>

      {/* Phase 1D.2a §4.5 — Auto-mode critic-failure surface. Triggered when
          the pipeline failed with an `*_unresolvable` failure reason (e.g.
          `script_critic_unresolvable`, `locations_coverage_unresolvable`),
          which means the auto-mode critic chain exhausted its retry budget
          without producing a viable plan. The user can branch from the
          previous approved stage via the "Re-run from stage" list below —
          no separate branch button is needed here. */}
      {pipeline?.status === "failed" &&
        pipeline.failure_reason &&
        pipeline.failure_reason.endsWith("_unresolvable") && (
          <div
            className="mt-3 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded"
            data-testid="critic-failure-surface"
          >
            <div className="text-sm font-medium text-red-700 dark:text-red-300">
              Auto Mode failed: {pipeline.failure_reason}
            </div>
            <div className="text-xs text-red-600 dark:text-red-400 mt-1">
              See stage details for the specific blocking critic.
            </div>
          </div>
        )}

      {/* Phase 1D.3 — Re-run from here. When the pipeline is completed every
          stage was approved. Render a compact list so the user can branch from
          any stage without having to re-input the original story prompt. */}
      {pipeline?.status === "completed" && (
        <div className="mt-4">
          <div className="text-xs uppercase text-zinc-500 dark:text-zinc-400 mb-2">Re-run from stage</div>
          <div className="space-y-1" data-testid="rerun-stages-list">
            {PIPELINE_STAGE_NAMES.map((stageName) => (
              <div
                key={stageName}
                className="flex items-center justify-between rounded border border-zinc-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] px-3 py-2"
              >
                <span className="text-sm">{STAGE_LABELS[stageName]}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { void handleBranch(stageName) }}
                  disabled={branchingStage !== null}
                  data-testid={`rerun-btn-${stageName}`}
                >
                  {branchingStage === stageName ? "Branching…" : "Re-run from here"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

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
        <div className="mt-4 p-3 rounded border border-zinc-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E]">
          <div className="text-sm font-semibold mb-2">Reject with feedback</div>
          <textarea
            className="w-full rounded border border-zinc-300 dark:border-[#2D2D2D] bg-white dark:bg-[#121212] p-2 text-sm"
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

      <div className="mt-6 text-xs text-zinc-500 dark:text-zinc-400">
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
    </>
  )
}
