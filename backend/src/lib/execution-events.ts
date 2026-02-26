/**
 * In-memory EventEmitter for workflow execution state changes.
 *
 * The orchestrator worker and the SSE route run in the same Node.js process
 * (server.ts line 29), so a simple EventEmitter bridges them with zero
 * network overhead — no Redis pub/sub needed.
 *
 * Events are keyed by executionId. Every event carries the full nodeStates
 * snapshot so that late-connecting SSE clients never miss intermediate state.
 */

import { EventEmitter } from "node:events"
import type { NodeExecutionState } from "../services/workflow-engine/types.js"

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface ExecutionEvent {
  type:
    | "execution:started"
    | "node:updated"
    | "level:completed"
    | "execution:completed"
    | "execution:failed"
    | "execution:cancelled"
  executionId: string
  /** Full snapshot of all node states — always present. */
  nodeStates: Record<string, NodeExecutionState>
  completedNodes?: number
  failedNodes?: number
  totalNodes?: number
  totalCreditsUsed?: number
  errorMessage?: string
  /** Which node triggered this event (for node-level events). */
  nodeId?: string
}

// ---------------------------------------------------------------------------
// Singleton emitter
// ---------------------------------------------------------------------------

export const executionEvents = new EventEmitter()

// Allow many concurrent executions to attach listeners without warnings.
executionEvents.setMaxListeners(200)
