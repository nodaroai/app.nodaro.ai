/**
 * THE OWNED-SETTINGS GUARD for `update_workflow_json`.
 *
 * `workflows.settings` is one JSON column shared by several writers, and the
 * tool's full-body form replaces it wholesale: an agent that read the
 * workflow, edited one key and wrote the object back without the others erased
 * them in one call. Three keys are another writer's and are guarded:
 *
 *  - `studio` — a Studio production's document (shots, results, plan); audit
 *    2026-09-06 fix #6, C-13(3).
 *  - `mcpConversation` — which assistant chat built this flow, and how far it
 *    got; the MCP server reads it to continue the chat and to list it
 *    (lib/mcp/flows/conversation-store.ts).
 *  - `mcpHub` — the month marker of the hub that month's conversations hang
 *    under; without it the month's conversations disappear from the list.
 *
 * A write that changes or drops a STORED owned key is refused with a message
 * naming the key; echoing it back unchanged (as `get_workflow_json` returned
 * it) passes; a workflow with no stored copy is untouched — the key may be
 * created. The delta form's `set.settings` is merged by the server key by key
 * (`apply_workflow_delta`), so there a key left out is kept and only a key
 * SENT changed (or sent as null) is refused.
 */
import { isDeepStrictEqual } from "node:util"

export interface OwnedSettingsKey {
  readonly key: string
  /** The refusal the agent reads: what the key is, whose it is, what to do. */
  readonly message: string
}

const ECHO_IT =
  "Send it back unchanged — copy it from a fresh get_workflow_json, it may have moved since you read it — or leave `settings` out."

/** The refusal for a write that changes or drops a stored `settings.studio`. */
export const STUDIO_SETTINGS_GUARD_MESSAGE =
  "This workflow is a Studio production: `settings.studio` holds its shots, results and plan and is owned by Studio. " +
  "Send it back unchanged (copy `settings.studio` from get_workflow_json into your settings) or leave `settings` out."

/** The refusal for a write that changes or drops a stored `settings.mcpConversation`. */
export const MCP_CONVERSATION_GUARD_MESSAGE =
  "This workflow is an MCP conversation: `settings.mcpConversation` records which assistant chat built it and is owned by the server. " +
  ECHO_IT

/** The refusal for a write that changes or drops a stored `settings.mcpHub`. */
export const MCP_HUB_GUARD_MESSAGE =
  "This workflow is a month's hub of MCP conversations: `settings.mcpHub` is owned by the server. " + ECHO_IT

/**
 * The keys of `settings` another writer owns, each with its refusal. A new
 * server-owned key joins this list; the guard, the tool descriptions and the
 * docs name the list, never a key of their own.
 */
export const OWNED_SETTINGS_KEYS: readonly OwnedSettingsKey[] = [
  { key: "studio", message: STUDIO_SETTINGS_GUARD_MESSAGE },
  { key: "mcpConversation", message: MCP_CONVERSATION_GUARD_MESSAGE },
  { key: "mcpHub", message: MCP_HUB_GUARD_MESSAGE },
]

/**
 * How the write reaches the column: `replace` (the full-body form — a key
 * left out is dropped) or `merge` (a delta's `set.settings` — a key left out
 * is kept by the server's per-key merge).
 */
export type SettingsWriteMode = "replace" | "merge"

function keyOf(settings: unknown, key: string): unknown {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return undefined
  return (settings as Record<string, unknown>)[key]
}

/**
 * The refusal for a settings write that would change or drop a stored owned
 * key, or null when the write may go through.
 */
export function ownedSettingsRefusal(next: unknown, stored: unknown, mode: SettingsWriteMode): string | null {
  for (const owned of OWNED_SETTINGS_KEYS) {
    const storedValue = keyOf(stored, owned.key)
    if (storedValue === undefined || storedValue === null) continue
    const sent = next && typeof next === "object" && !Array.isArray(next) && owned.key in (next as Record<string, unknown>)
    if (!sent) {
      if (mode === "merge") continue
      return owned.message
    }
    if (!isDeepStrictEqual(keyOf(next, owned.key), storedValue)) return owned.message
  }
  return null
}
