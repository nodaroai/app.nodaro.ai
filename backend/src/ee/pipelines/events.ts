import { EventEmitter } from "node:events"
import type { PipelineEvent } from "@nodaro/shared"

/**
 * Single-process pub/sub for pipeline lifecycle events. The orchestrator publishes
 * here; the SSE route in routes/pipelines.ts subscribes per request. Postgres
 * NOTIFY/LISTEN could replace this for multi-worker fanout — kept in-process for
 * Phase 1A since one worker handles one pipeline.
 *
 * Topic is the pipelineId. Frontend reconnect-after-drop falls back to Supabase
 * Realtime on pipeline_stages (existing pattern).
 */
class PipelineEventBroker {
  private emitter = new EventEmitter()

  constructor() {
    // Many concurrent pipelines = many listeners. Bump default cap.
    this.emitter.setMaxListeners(0)
  }

  publish(event: PipelineEvent): void {
    const pipelineId = "pipelineId" in event ? event.pipelineId : null
    if (!pipelineId) return
    this.emitter.emit(pipelineId, event)
  }

  subscribe(pipelineId: string, listener: (event: PipelineEvent) => void): () => void {
    this.emitter.on(pipelineId, listener)
    return () => this.emitter.off(pipelineId, listener)
  }
}

export const pipelineEvents = new PipelineEventBroker()
