/**
 * The write marker for a graph the workflow store adopts as stored (a save
 * conflict's merge of the stored row with this tab's edits): the store's audio
 * lock takes such a graph as it is, and strips the marker before the patch is
 * applied (`withAudioLock`, use-workflow-store.ts). It belongs to the WRITE,
 * never to the state: `WorkflowState` has no such field, so nothing can read it
 * back. A load or a remote change needs none — it raises `loadGeneration`.
 */
import type { WorkflowState } from "./use-workflow-store"

/** A store write, as the store's write wrapper reads it: the patch, and the marker. */
export type WorkflowWrite = Partial<WorkflowState> & { readonly adoptedAsStored?: true }

/** `patch`, marked as a graph adopted as stored (typed as the plain patch, for `setState`). */
export function adoptedAsStored<P extends Partial<WorkflowState>>(patch: P): P {
  return { ...patch, adoptedAsStored: true } as P
}
