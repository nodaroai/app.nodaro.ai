import { hasScope, type Scope } from "../scopes.js"

/**
 * Declarative scope requirement for an MCP tool. Each tool registration in
 * `./server.ts` carries one of these and the registrar consults
 * {@link passesGate} before calling `server.registerTool` — tools whose gate
 * is not satisfied by the session simply aren't visible in `tools/list`.
 *
 * Empty `required: []` = always visible (e.g. the ping diagnostic).
 */
export interface ToolGate {
  required: Scope[]
}

export function passesGate(session: { scopes: readonly Scope[] }, gate: ToolGate): boolean {
  return gate.required.every((r) => hasScope(session.scopes, r))
}
