/**
 * The one merge for a write into a node's data.
 *
 * A failed node keeps two texts: the sentence the platform wrote (`errorMessage`) and, under it,
 * the provider's own words about that failure (`errorDetail`). The card shows the words on every
 * node type, and both texts are saved with the workflow.
 *
 * A write into node data is a shallow merge, so a key the write does not name stays as it was.
 * Well over a hundred places write a failure, and most of them name the sentence only. Merged
 * plainly, such a write would leave the words of an earlier failure under the sentence of a later
 * one that has nothing to do with them.
 *
 * The rule, for one node on every merge:
 *  1. A write that names `errorDetail`, with any value, is taken as written.
 *  2. Otherwise a write that changes `errorMessage`, clearing it included, drops the words.
 *  3. Otherwise a write that sets the status to "failed" and states the sentence again, on a node
 *     that has another status, drops the words. That is a new failure, even when its sentence
 *     reads the same.
 *
 * A write that names neither text leaves both as they are, whatever status it sets: a run that
 * stopped before its node wrote anything sets "failed" alone, and the node keeps its sentence with
 * the words that go with it. So the merge never changes a saved key the write did not touch, and
 * the node in memory never differs from the saved workflow on a write that is not saved.
 *
 * So a node's sentence and its words always come from one failure, or the words are absent.
 *
 * What rule 3 leaves alone, on purpose:
 *  - a node that is already "failed": the shared poll writes a failure whole, and its caller's
 *    catch then states the status and the sentence again;
 *  - a node with no status: the status is never saved, so after a reload a failure painted back
 *    onto the node joins the sentence and the words that were saved with it.
 *
 * The limit: a new failure whose sentence is the very same one, written onto a node with no
 * status, keeps the words. Every run marks its nodes "pending" before it starts, which is a
 * status, so a failure inside a run falls under rule 3.
 *
 * Who names the words: a write that has the failed job in hand names them from the job, absent
 * ones included. A write that only has a caught error names them when the error carries them and
 * leaves the key out otherwise, so this rule decides.
 */

type Data = Record<string, unknown>

const names = (patch: Data, key: string): boolean => Object.prototype.hasOwnProperty.call(patch, key)

/** Whether merging `patch` into `current` leaves the node's words without the failure they explain. */
function dropsProviderWords(current: Data, patch: Data): boolean {
  if (current.errorDetail == null) return false
  if (names(patch, "errorDetail")) return false
  if (!names(patch, "errorMessage")) return false
  if (patch.errorMessage !== current.errorMessage) return true
  if (patch.executionStatus !== "failed") return false
  const was = current.executionStatus
  return was != null && was !== "failed"
}

/**
 * `{ ...current, ...patch }`, with the provider's words leaving when the failure they explain
 * does. Returns a new object; neither argument is changed.
 */
export function mergeNodeData<T extends object>(current: T, patch: object): T {
  const base = current as Data
  const write = patch as Data
  const merged = dropsProviderWords(base, write) ? { ...base, ...write, errorDetail: undefined } : { ...base, ...write }
  return merged as T
}
