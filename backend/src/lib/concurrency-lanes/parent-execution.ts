// backend/src/lib/concurrency-lanes/parent-execution.ts — the run a nested
// workflow execution belongs to.
//
// A component node and a use-case node of a running run each start an
// execution of their own, through the component route and the use-case
// routes. The node executor names its execution in PARENT_EXECUTION_HEADER on
// those internal calls; the route puts it on the nested execution's
// orchestrator payload as `parentExecutionId`, and the orchestrator admits such
// an execution with no run slot and exempt from refusal by its server share
// (run-admit.ts) — otherwise a parent holding the last run slot would wait on a
// child waiting for one. Only the internal lane is believed: from a user, an
// API token or an app it would buy a run without a slot.
import type { FastifyRequest } from "fastify"

/** The header the node executor names its execution in, on a call that may start a nested execution. */
export const PARENT_EXECUTION_HEADER = "x-nodaro-parent-execution"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The parent execution an internal request names; undefined for any other caller or a malformed value. */
export function parentExecutionIdOf(req: Pick<FastifyRequest, "headers" | "authKind">): string | undefined {
  if (req.authKind !== "internal") return undefined
  const raw = req.headers[PARENT_EXECUTION_HEADER]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === "string" && UUID.test(value.trim()) ? value.trim() : undefined
}
