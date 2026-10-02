import { telegramAccountListeningSignature } from "@nodaro/shared"

/**
 * What the OWNER set on a Telegram account trigger in this session, through
 * the trigger's settings panel — the only changes the editor names to the
 * server as theirs. The server arms, widens or re-points a trigger only while
 * the stored node still says exactly what was set here.
 *
 * A change that reached the canvas any other way — realtime, a save's rebase,
 * paste, duplicate, an import, a preset, undo — is never named on its own: the
 * trigger keeps its stored row (switching it off always applies) until its
 * owner sets it in the panel. Diffing graphs cannot tell those apart; the
 * panel can. A click in the panel names everything the trigger will listen
 * to, so the panel shows all of it: every selected chat (one that is not in
 * the account's recent chats is marked as such), every sender filter, the
 * keywords as stored.
 *
 * Per workflow, for this session only. A workflow that has no id yet keeps
 * its intents under "" until its first save gives it one
 * (`adoptUnsavedAccountTriggerIntents`); loading or starting another
 * workflow discards them, so they never reach a workflow they were not set in.
 */
const UNSAVED = ""
const intents = new Map<string, ReadonlyMap<string, string>>()

/** The panel changed this trigger's settings: remember what they now say. */
export function recordAccountTriggerIntent(workflowId: string | null | undefined, nodeId: string, data: unknown): void {
  const key = workflowId ?? UNSAVED
  intents.set(key, new Map([...(intents.get(key) ?? []), [nodeId, telegramAccountListeningSignature(data)]]))
}

/** Node id → the settings the owner last set in the panel, for this workflow only. */
export function accountTriggerIntents(workflowId: string): ReadonlyMap<string, string> {
  return intents.get(workflowId) ?? new Map()
}

/** The unsaved workflow was just saved as `workflowId`: what was set in it is now that workflow's. */
export function adoptUnsavedAccountTriggerIntents(workflowId: string): void {
  const unsaved = intents.get(UNSAVED)
  if (!unsaved || workflowId === UNSAVED) return
  intents.set(workflowId, new Map([...(intents.get(workflowId) ?? []), ...unsaved]))
  intents.delete(UNSAVED)
}

/** Another workflow was loaded or a new one started: an unsaved one's intents go with it. */
export function discardUnsavedAccountTriggerIntents(): void {
  intents.delete(UNSAVED)
}

/**
 * A sync that named these triggers succeeded: the server holds what the owner
 * set, so those intents are spent. One is dropped only while it still says
 * what was named — a change the owner made in the panel meanwhile stays for
 * the next sync. A spent intent left in place would re-arm the trigger the
 * next time a write elsewhere put the same settings back after a stop.
 */
export function consumeAccountTriggerIntents(workflowId: string, named: ReadonlyArray<{ readonly id: string; readonly settings: string }>): void {
  const current = intents.get(workflowId)
  if (!current || named.length === 0) return
  const spent = new Map(named.map(({ id, settings }) => [id, settings]))
  intents.set(workflowId, new Map([...current].filter(([id, settings]) => spent.get(id) !== settings)))
}

/**
 * The settings panel's update for one Telegram account trigger: write the
 * change, then remember what the node now says as its owner's choice.
 */
export function recordingAccountTriggerUpdate(
  nodeId: string,
  write: (nodeId: string, patch: Record<string, unknown>) => void,
  read: () => { readonly workflowId: string | null; readonly nodes: ReadonlyArray<{ readonly id: string; readonly data?: unknown }> },
): (patch: Record<string, unknown>) => void {
  return (patch) => {
    write(nodeId, patch)
    const { workflowId, nodes } = read()
    const node = nodes.find((n) => n.id === nodeId)
    if (node) recordAccountTriggerIntent(workflowId, nodeId, node.data)
  }
}

/** Tests only. */
export function clearAccountTriggerIntents(): void {
  intents.clear()
}
