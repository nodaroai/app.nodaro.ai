// backend/src/lib/concurrency-lanes/instance.ts — the process's concurrency
// gate, on the BullMQ connection from lib/queue.ts. Kept apart from gate.ts so
// importing the gate (its tests, the twin) never opens a connection. That
// connection queues commands while Redis is unreachable; the gate bounds every
// call (LANE_GATE_CALL_TIMEOUT_MS), so an outage rejects instead of hanging.
import { redis } from "../queue.js"
import { ConcurrencyGate } from "./gate.js"

let gate: ConcurrencyGate | undefined

export function concurrencyGate(): ConcurrencyGate {
  gate ??= new ConcurrencyGate({ client: () => redis })
  return gate
}
