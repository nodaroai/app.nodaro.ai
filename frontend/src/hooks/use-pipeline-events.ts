import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type {
  PipelineEvent,
  PipelineDriftSummary,
  SubGateName,
} from "@nodaro/shared"
import type { ChatTurn } from "@nodaro/client"
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

  // React Query cache — Phase 1D.2b chat events update the chat-history cache
  // in place without an extra GET roundtrip. `queryClient` is referentially
  // stable across renders so it's safe to include in the effect deps.
  const queryClient = useQueryClient()

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
      // SSE must bypass the Vite dev proxy (it buffers responses → socket
      // hang up). Call VITE_API_URL directly when set; fall back to
      // same-origin otherwise. Mirrors the AI-writer streaming path.
      const sseBaseUrl = import.meta.env.VITE_API_URL || ""
      try {
        setConnected(true)
        for await (const frame of streamGet<{
          type: string
          data?: PipelineEvent
        }>(url, { signal: abortCtrl.signal, headers, baseUrl: sseBaseUrl || undefined })) {
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
          } else if (evt.type === "chat:turn") {
            // Phase 1D.2b — Append the new turn to the chat-history cache
            // without refetching. Idempotent on turn.id collision (handles
            // double-publish of the same SSE event during reconnect).
            queryClient.setQueryData<{ turns: ChatTurn[] }>(
              ["pipelines", evt.pipelineId, "stages", evt.stageName, "chat"],
              (prev) => {
                const turns = prev?.turns ?? []
                if (turns.some((t) => t.id === evt.turn.id)) return prev
                // SSE payload omits llm_call_id / applied_to_attempt_id /
                // created_at — they exist on the DB row but aren't load-
                // bearing for chat-history rendering. Fill defaults so the
                // cache row shape matches `ChatTurn`.
                const turn: ChatTurn = {
                  id: evt.turn.id,
                  turn_n: evt.turn.turn_n,
                  role: evt.turn.role,
                  content: evt.turn.content,
                  proposed_change: evt.turn.proposed_change,
                  llm_call_id: null,
                  applied_to_attempt_id: null,
                  created_at: new Date().toISOString(),
                }
                return { turns: [...turns, turn] }
              },
            )
          } else if (evt.type === "chat:proposal_applied") {
            // Phase 1D.2b — Mark the source turn as applied + force a refetch
            // of the pipeline / stages so the panel sees the new attempt and
            // the stage's status=approved transition.
            queryClient.setQueryData<{ turns: ChatTurn[] }>(
              ["pipelines", evt.pipelineId, "stages", evt.stageName, "chat"],
              (prev) =>
                prev
                  ? {
                      turns: prev.turns.map((t) =>
                        t.id === evt.turnId
                          ? { ...t, applied_to_attempt_id: evt.attemptId }
                          : t,
                      ),
                    }
                  : prev,
            )
            queryClient.invalidateQueries({
              queryKey: ["pipelines", evt.pipelineId],
            })
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
  }, [
    pipelineId,
    updateNodeDataByEntityId,
    setStoreLastAddedNodeId,
    setStoreActiveStatus,
    queryClient,
  ])

  return { lastEvent, connected, drift, currentSubGate }
}
