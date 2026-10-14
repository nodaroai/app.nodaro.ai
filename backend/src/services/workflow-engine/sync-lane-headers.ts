/**
 * The headers every call the backend engine makes on the internal lane
 * carries — one copy for the sync-HTTP nodes, the UGC runners and the
 * use-case nodes (use-case-node.ts), kept out of node-executor.ts so a module
 * it imports can use it without a cycle.
 */
import { WORKSPACE_HEADER_LOWER } from "@nodaro/shared/organizations"
import { config } from "../../lib/config.js"
import type { OrchestratorContext } from "./types.js"

/** The orchestrator's internal-lane headers: the secret, the run's user, X-App-Run, X-Web-Free-Mode, the workspace payer. */
export function syncLaneHeaders(ctx: OrchestratorContext): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Authenticate to the auth hook with the shared orchestrator secret — NOT req.ip,
    // which is always 127.0.0.1 behind the Caddy reverse proxy.
    "X-Internal-Orchestrator-Secret": config.INTERNAL_ORCHESTRATOR_SECRET,
    // The user this call acts for, for the rate limiter (it runs before the
    // body is read). The auth hook still takes the user from the body. Without
    // it every run on an instance shared one bucket on a limited route (#1888).
    "X-Internal-User-Id": ctx.userId,
  }
  // Propagate app-run context so the route's credit reservation applies the
  // free-tier app allowance gate (and avoids crediting allowance on app runs).
  if (ctx.isAppRun) {
    headers["X-App-Run"] = "true"
  }
  // Same propagation pattern as X-App-Run: the route's credit guard applies
  // pool-aware payg semantics when the RUN originated on a consumer surface.
  if (ctx.webFreeMode) {
    headers["X-Web-Free-Mode"] = "true"
  }
  // Forward the execution's resolved payer as the validated workspace
  // header — on the internal lane the header IS the decision (the billing
  // hook resolves rung-2-only there), and its absence means the parent
  // decided personal. Only a workspace payer sends it; a personal run's
  // loopback wire shape stays as it was before workspace payers.
  if (ctx.billingContext.payer === "workspace") {
    headers[WORKSPACE_HEADER_LOWER] = ctx.billingContext.workspaceId
  }
  return headers
}
