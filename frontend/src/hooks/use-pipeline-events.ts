import { useEffect, useState } from "react"
import type {
  PipelineEvent,
  PipelineDriftSummary,
  SubGateName,
} from "@nodaro/shared"
import { pipelinesApi } from "@/lib/pipelines-api"
import { getAuthHeaders } from "@/lib/api"
import { streamGet } from "@/lib/sse-client"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

interface UsePipelineEventsResult {
  /**
   * The most recent SSE event received (or `null` before the first event).
   * Replaces a growing `events[]` array — only the latest event has ever
   * been consumed downstream, so the array was pure memory pressure with no
   * functional benefit.
   */
  readonly lastEvent: PipelineEvent | null
  readonly connected: boolean
  /**
   * Phase 1B.4 — most recent drift summary attached to a stage's
   * `awaiting_reason=canvas_drift` row. Cleared whenever the pipeline forks
   * or the SSE connection re-opens. `null` when no drift is active.
   */
  readonly drift: PipelineDriftSummary | null
  /**
   * Phase 1C.2 — name of the active Stage 7 sub-gate
   * (`silent_cut_preview` | `dialogue_recheck`), or `null` when no sub-gate
   * is active. Set on `stage:awaiting_sub_gate`; cleared on the next
   * `stage:status` (which fires when the orchestrator resumes post-approval)
   * or on a fresh SSE reconnect against a different pipeline.
   *
   * The full sub-gate payload (preview URL, rebalance result) lives on the
   * stage's `output` JSONB — the panel reads that via `pipelinesApi.getStage`
   * rather than mirroring every field into hook state.
   */
  readonly currentSubGate: SubGateName | null
}

/**
 * Subscribe to pipeline SSE events and (Phase 1B.4) bridge entity-level
 * lifecycle events into the canvas workflow store. The hook:
 *  - exposes `lastEvent` so consumers can `useEffect` on its `.type`
 *  - applies `entity:state_change` / `entity:stale` to the workflow store via
 *    `updateNodeDataByEntityId` so the entity nodes' `<PipelineStateOverlay>`
 *    updates without a poll round-trip
 *  - mirrors `activePipelineStatus` + `lastAddedPipelineNodeId` into the
 *    workflow store so the canvas-side live-build hooks (auto-pan + ELK)
 *    can react without re-subscribing to SSE
 *  - tracks `drift` from `pipeline:drift`
 *
 * `drift` resets when the SSE connection re-opens for a different pipeline
 * (rare in practice — the panel unmounts on close).
 */
export function usePipelineEvents(pipelineId: string | undefined): UsePipelineEventsResult {
  const [lastEvent, setLastEvent] = useState<PipelineEvent | null>(null)
  const [connected, setConnected] = useState(false)
  const [drift, setDrift] = useState<PipelineDriftSummary | null>(null)
  const [currentSubGate, setCurrentSubGate] = useState<SubGateName | null>(null)

  // Zustand setters are referentially stable — read once per effect run and
  // call directly inside the SSE handler. No ref wrappers needed.
  const updateNodeDataByEntityId = useWorkflowStore((s) => s.updateNodeDataByEntityId)
  const setStoreLastAddedNodeId = useWorkflowStore((s) => s.setLastAddedPipelineNodeId)
  const setStoreActiveStatus = useWorkflowStore((s) => s.setActivePipelineStatus)

  useEffect(() => {
    if (!pipelineId) return
    // Reset 1B.4 lifecycle state on every new pipeline subscription so a
    // panel re-open against a different pipeline doesn't carry stale drift.
    setDrift(null)
    setLastEvent(null)
    setCurrentSubGate(null)
    // Mirror into the workflow store so the canvas-side live-build hooks
    // (auto-pan + ELK) can react without re-subscribing to SSE.
    setStoreLastAddedNodeId(null)

    // Native EventSource can't send Authorization headers, and the
    // backend's auth middleware only reads them from there (not cookies
    // or query strings). Use the existing fetch-based `streamGet` instead
    // so we can attach the Supabase access token.
    const abortCtrl = new AbortController()
    void (async () => {
      const headers = await getAuthHeaders()
      const url = pipelinesApi.eventsUrl(pipelineId)
      try {
        setConnected(true)
        for await (const frame of streamGet<{
          type: string
          data?: PipelineEvent
        }>(url, { signal: abortCtrl.signal, headers })) {
          if (frame.type !== "execution" || !frame.data) continue
          const evt = frame.data
          setLastEvent(evt)

          // ── Phase 1B.4 side-effects ─────────────────────────────────────
          if (evt.type === "entity:state_change") {
            updateNodeDataByEntityId(evt.pipelineEntityId, { pipeline_state: evt.newState })
            if (evt.newState === "pipeline_owned_running") {
              const match = useWorkflowStore
                .getState()
                .nodes.find(
                  (n) =>
                    (n.data as Record<string, unknown>).pipeline_entity_id ===
                    evt.pipelineEntityId,
                )
              if (match) {
                setStoreLastAddedNodeId(match.id)
              }
            }
          } else if (evt.type === "entity:stale") {
            updateNodeDataByEntityId(evt.pipelineEntityId, { is_stale: true })
          } else if (evt.type === "pipeline:forked") {
            setDrift(null)
            setStoreActiveStatus("forked")
          } else if (evt.type === "pipeline:drift") {
            setDrift(evt)
          } else if (evt.type === "pipeline:status") {
            setStoreActiveStatus(evt.status)
          } else if (evt.type === "stage:awaiting_sub_gate") {
            setCurrentSubGate(evt.subGate)
          } else if (evt.type === "stage:status") {
            if (
              evt.stageName === "animate_audio_edit" &&
              evt.status !== "awaiting_approval"
            ) {
              setCurrentSubGate(null)
            }
          } else if (evt.type === "pipeline:music_ready") {
            // eslint-disable-next-line no-console
            console.info("[pipeline] music_ready", evt.musicAssetUrl)
          } else if (evt.type === "pipeline:editor_decisions_ready") {
            // eslint-disable-next-line no-console
            console.info("[pipeline] editor_decisions_ready", evt.pipelineId)
          }
        }
      } catch (err) {
        if (!abortCtrl.signal.aborted) {
          // The panel falls back to React Query polling, so an SSE failure
          // is not user-facing — log it for dev visibility only.
          // eslint-disable-next-line no-console
          console.warn("[pipeline-events] SSE stream ended:", err)
        }
      } finally {
        setConnected(false)
      }
    })()

    return () => {
      abortCtrl.abort()
      setConnected(false)
      setStoreLastAddedNodeId(null)
      setStoreActiveStatus(null)
    }
  }, [pipelineId, updateNodeDataByEntityId, setStoreLastAddedNodeId, setStoreActiveStatus])

  return { lastEvent, connected, drift, currentSubGate }
}
