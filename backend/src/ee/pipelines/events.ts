import { EventEmitter } from "node:events"
import IORedis, { type Redis } from "ioredis"
import type { PipelineEvent } from "@nodaro/shared"
import { config } from "../../lib/config.js"

const CHANNEL = "pipeline-events"

// Unique per process so the Redis bridge can skip events this process
// already emitted locally — avoids double-fanout when the same process
// both publishes and subscribes (e.g. server.ts publishes from
// approve/reject routes AND subscribes for SSE).
const PROCESS_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`

/**
 * Cross-process pub/sub for pipeline lifecycle events.
 *
 * Why this exists: the pipeline orchestrator runs in `pipeline-worker.ts`
 * (a separate Node process from the API server) but the SSE endpoint
 * that streams events to browsers lives in `server.ts`. Without a
 * cross-process bridge, every `pipelineEvents.publish()` from the worker
 * goes into a local EventEmitter that no SSE subscriber listens to, and
 * the events never reach the browser. 3-second React Query polling
 * masks this for most updates, but transient progress events (e.g.
 * `stage:progress` while the Showrunner LLM streams) are sub-second and
 * can never appear in the UI without a real-time bridge.
 *
 * Design:
 *   - `publish(event)` emits to the local EventEmitter (same-process
 *     subscribers see it synchronously) AND publishes the event to the
 *     Redis channel tagged with this process's `PROCESS_ID`.
 *   - `startCrossProcessBridge()` is called once from `server.ts` on
 *     boot. It subscribes to the Redis channel and forwards every
 *     incoming message whose `PROCESS_ID` differs from this process's
 *     into the local emitter. Same-process messages are skipped so we
 *     don't double-fire local subscribers.
 *   - `subscribe(pipelineId, listener)` is unchanged — same API as the
 *     original in-process broker.
 *
 * Redis is already a hard dependency (BullMQ uses it for the pipeline
 * orchestration queue itself — if Redis is down the pipeline can't run
 * at all), so the bridge inheriting that dependency is acceptable.
 */
class PipelineEventBroker {
  private emitter = new EventEmitter()
  private publisher: Redis | null = null
  private subscriber: Redis | null = null

  constructor() {
    // Many concurrent pipelines = many listeners. Bump default cap.
    this.emitter.setMaxListeners(0)
  }

  publish(event: PipelineEvent): void {
    const pipelineId = "pipelineId" in event ? event.pipelineId : null
    if (!pipelineId) return

    // Local fanout — same-process subscribers see the event synchronously.
    this.emitter.emit(pipelineId, event)

    // Cross-process fanout via Redis. Lazily construct the publisher on
    // first use so test environments that never publish don't open a
    // socket. Fire-and-forget — publish errors are logged but never
    // re-thrown to the caller (matches the existing API contract: the
    // emitter version was also synchronous and non-throwing).
    if (!this.publisher) {
      this.publisher = new IORedis(config.REDIS_URL, {
        maxRetriesPerRequest: null,
      })
    }
    const payload = JSON.stringify({ source: PROCESS_ID, event })
    void this.publisher.publish(CHANNEL, payload).catch((err) => {
      // eslint-disable-next-line no-console -- publish failure is observable, not fatal
      console.error(
        "[pipelineEvents] Redis publish failed:",
        err instanceof Error ? err.message : String(err),
      )
    })
  }

  subscribe(pipelineId: string, listener: (event: PipelineEvent) => void): () => void {
    this.emitter.on(pipelineId, listener)
    return () => this.emitter.off(pipelineId, listener)
  }

  /**
   * Boot the cross-process subscriber bridge. Call once from `server.ts`
   * on startup. After this resolves, events published by ANY process
   * (worker or otherwise) reach this process's local emitter and
   * propagate to local subscribers (SSE in our case).
   *
   * Idempotent — a second call is a no-op.
   *
   * The bridge filters out messages whose `source` matches this process's
   * `PROCESS_ID` to avoid double-fanout for events that were already
   * emitted locally by `publish()` in this process.
   */
  async startCrossProcessBridge(): Promise<void> {
    if (this.subscriber) return
    this.subscriber = new IORedis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
    })
    this.subscriber.on("message", (channel, message) => {
      if (channel !== CHANNEL) return
      let parsed: { source?: unknown; event?: unknown }
      try {
        parsed = JSON.parse(message)
      } catch (err) {
        // Malformed payload — log but don't crash the bridge.
        // eslint-disable-next-line no-console
        console.error(
          "[pipelineEvents] failed to parse Redis message:",
          err instanceof Error ? err.message : String(err),
        )
        return
      }
      // Skip our own events — already emitted locally by publish().
      if (parsed.source === PROCESS_ID) return
      const event = parsed.event as PipelineEvent | undefined
      if (!event) return
      const pipelineId =
        event && "pipelineId" in event ? event.pipelineId : null
      if (!pipelineId) return
      this.emitter.emit(pipelineId, event)
    })
    await this.subscriber.subscribe(CHANNEL)
    // eslint-disable-next-line no-console
    console.log(
      `[pipelineEvents] cross-process bridge started (process_id=${PROCESS_ID})`,
    )
  }

  /**
   * Close Redis clients. Tests call this between cases; production
   * cleanup happens on process exit.
   */
  async close(): Promise<void> {
    if (this.publisher) {
      try {
        await this.publisher.quit()
      } catch {
        /* swallow — best-effort shutdown */
      }
      this.publisher = null
    }
    if (this.subscriber) {
      try {
        await this.subscriber.quit()
      } catch {
        /* swallow */
      }
      this.subscriber = null
    }
  }

  /** Test-only — observable process identifier (used by bridge dedupe). */
  get _processId(): string {
    return PROCESS_ID
  }
}

export const pipelineEvents = new PipelineEventBroker()
