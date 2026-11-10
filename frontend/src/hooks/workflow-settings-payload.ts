/**
 * The `settings` column the editor writes.
 *
 * `workflows.settings` is one JSON column shared by several writers: the
 * editor keeps its own four keys there, an assistant's MCP conversation keeps
 * which chat built the flow (`mcpConversation`) and a month's hub its marker
 * (`mcpHub`), Studio keeps its production document (`studio`), a demo seed
 * its flag. Both editor writers — the save (`use-workflow-persistence.ts`)
 * and the unload keepalive save (`unload-save.ts`) — REPLACE the whole
 * column, so each writes the column as the server holds it at the version
 * the write is pinned to, with the editor's keys over it: a key the editor
 * does not manage rides through exactly as stored.
 *
 * Why the stored column and not a server-side merge: each write is pinned
 * to the row it read — the save to `loadedVersion` (the version CAS), the
 * unload save to `loadedUpdatedAt` — and a content write bumps both (a
 * backfill that leaves `updated_at` alone still bumps `version`), so the
 * stored column this tab holds IS the row's column whenever the write
 * lands; a key another writer moved since the load fails the pin, and the
 * save's conflict path re-reads the row. The stored column is refreshed
 * wherever the cursor moves (load, remote reconcile, the conflict rebase, a
 * save's own write), which is what keeps the two paired.
 */
import type { WorkflowState } from "./use-workflow-store"

/** The keys of `settings` the editor manages; every other key is another writer's. */
export const EDITOR_SETTINGS_KEYS = ["characterDefinitions", "flowPromptTemplates", "presentationSettings", "viewport"] as const

/** What a settings write reads from the store (the save reads them at its start, so they are passed in). */
export type EditorSettingsSource = Pick<
  WorkflowState,
  "characterDefinitions" | "flowPromptTemplates" | "presentationSettings" | "savedViewport" | "lastSavedSnapshot"
>

/**
 * The settings column to write: the stored column, then the editor's four
 * keys over it. A new object; not cloned — each writer clones as it sends.
 */
export function editorSettingsPayload(source: EditorSettingsSource): Record<string, unknown> {
  return {
    ...(source.lastSavedSnapshot?.storedSettings ?? {}),
    characterDefinitions: source.characterDefinitions,
    flowPromptTemplates: source.flowPromptTemplates,
    presentationSettings: source.presentationSettings,
    viewport: source.savedViewport,
  }
}
