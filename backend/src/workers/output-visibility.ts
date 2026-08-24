import { runtimeSurfaceProfile } from "../lib/surface-profile.js"

export interface OutputVisibilityInputs {
  /** The user's profile preference (public_outputs). */
  publicOutputs: boolean
  /** Uploaded/private input content, blocked prompt, etc. */
  forcePrivate: boolean
  /** Generated through an external MCP client (Claude.ai / Cursor). */
  mcpClient: boolean
  /**
   * Set to the parent workflow_execution id ONLY when that execution is
   * MCP-originated (else null) — a workflow/app run driven from an external
   * client is a private surface. A non-null value forces private.
   */
  workflowExecutionId: string | null
}

/**
 * The single source of truth for `is_public` across both media workers (B1).
 * Any private-forcing condition wins; the deployment surface switch is the
 * OUTERMOST gate — `outputs.allowPublic:false` makes every output private
 * regardless of the user's preference (a white-label / locked-down install).
 * Worker-local rules (e.g. resolving the parent execution's mcp flag) are
 * computed by the caller and passed in, or ANDed after this call.
 */
export function resolveIsPublicOutput(i: OutputVisibilityInputs): boolean {
  if (!runtimeSurfaceProfile().outputs.allowPublic) return false
  if (!i.publicOutputs) return false
  if (i.forcePrivate) return false
  if (i.mcpClient) return false
  if (i.workflowExecutionId) return false
  return true
}

/**
 * Coerce a `jobs.mcp_client` cell into the private-forcing boolean the visibility
 * decision expects. That column is TEXT holding the client NAME (e.g. "claude-ai"),
 * NOT a boolean — the historical `mcp_client === true` compare at the worker call
 * sites was ALWAYS false, so every direct-MCP generation leaked to the PUBLIC
 * gallery. Any non-empty value is a direct-MCP surface and forces the output
 * private; null/undefined/"" stay public. Single-sourced so both media workers
 * map the column identically (guarded by output-visibility-surface.test.ts).
 */
export function mcpClientForcesPrivate(mcpClient: unknown): boolean {
  return Boolean(mcpClient)
}
