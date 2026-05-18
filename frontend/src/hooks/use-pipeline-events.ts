import { useEffect, useState } from "react"
import type {
  PipelineEvent,
  PipelineDriftSummary,
} from "@nodaro/shared"
import { pipelinesApi } from "@/lib/pipelines-api"
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
    // Mirror into the workflow store so the canvas-side live-build hooks
    // (auto-pan + ELK) can react without re-subscribing to SSE.
    setStoreLastAddedNodeId(null)

    const url = pipelinesApi.eventsUrl(pipelineId)
    const source = new EventSource(url, { withCredentials: true })

    source.addEventListener("open", () => setConnected(true))
    source.addEventListener("error", () => setConnected(false))

    source.addEventListener("execution", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data) as { data: PipelineEvent }
        const evt = parsed.data
        setLastEvent(evt)

        // ── Phase 1B.4 side-effects ───────────────────────────────────────
        if (evt.type === "entity:state_change") {
          updateNodeDataByEntityId(evt.pipelineEntityId, { pipeline_state: evt.newState })
          if (evt.newState === "pipeline_owned_running") {
            // The matching React Flow node id is whichever node in the store
            // carries this `pipeline_entity_id`. Looked up via the current
            // workflow store snapshot so this stays in sync with the canvas
            // materializer's node create.
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
          // Mirror coarse status changes so the canvas can decide whether the
          // live-build hooks (ELK, auto-pan) are active.
          setStoreActiveStatus(evt.status)
        }
      } catch {
        // ignore malformed event
      }
    })

    source.addEventListener("done", () => {
      setConnected(false)
      source.close()
    })

    return () => {
      source.close()
      setConnected(false)
      // Phase 1B.4 — clear shared live-build state on unmount/pipeline switch
      // so the canvas stops auto-panning to a stale node after the panel
      // closes. The next mount re-arms on the first running pipeline event.
      setStoreLastAddedNodeId(null)
      setStoreActiveStatus(null)
    }
  }, [pipelineId, updateNodeDataByEntityId, setStoreLastAddedNodeId, setStoreActiveStatus])

  return { lastEvent, connected, drift }
}
