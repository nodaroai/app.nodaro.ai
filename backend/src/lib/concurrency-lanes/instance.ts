// backend/src/lib/concurrency-lanes/instance.ts — the process's concurrency
// gate, on the BullMQ connection (lib/queue-connection.ts, the leaf lib/queue.ts
// re-exports — never lib/queue.ts itself, whose removal funnel reaches this
// module through the withdraw). Kept apart from gate.ts so
// importing the gate (its tests, the twin) never opens a connection. That
// connection queues commands while Redis is unreachable; the gate bounds every
// call (LANE_GATE_CALL_TIMEOUT_MS), so an outage rejects instead of hanging.
import { redis } from "../queue-connection.js"
import { ConcurrencyGate } from "./gate.js"

let gate: ConcurrencyGate | undefined

export function concurrencyGate(): ConcurrencyGate {
  // A call while the connection is down (or still coming up) is not queued
  // behind it: it fails at once, and its caller fails open — a cancel's
  // withdraw or a pickup never waits out the call timeout during an outage.
  gate ??= new ConcurrencyGate({ client: () => redis, connected: () => redis.status === "ready" })
  return gate
}
