import { supabase } from "./supabase.js"
import { workflowAccess } from "./workflow-access.js"
import { runStatesNeedReaderRelation, type ProviderWordsReader } from "./provider-words.js"

/**
 * Who may read a RUN's provider words (lib/provider-words.ts): the lookups the
 * funnel itself never makes, kept here so the funnel stays free of database
 * reads (every job read imports it).
 *
 * A run's node states carry each failed node's `errorDetail`, which can quote
 * the prompt of the workflow the run executed — so a run is read with its
 * words only by a reader who can open that workflow (its creator; with
 * workspaces, a member it is shared with), or an admin. The person who ran
 * someone else's share link or published app owns the run but cannot open the
 * workflow, and so never reads them. A share link's own reads go further, by
 * decision: the workflow's creator only (`readerCreatedWorkflow`).
 *
 * Every lookup is made only when its answer can change a response (a state
 * carries words, the reader is not an admin, and the deployment lets such a
 * reader read them); otherwise none is made and the response is exactly what
 * it was. A lookup that fails counts as "may not read": the words are display
 * only, and a missed one returns on the next read.
 */

/** Can this reader open this workflow (any access but none)? False when it cannot be told. */
export async function readerCanOpenWorkflow(readerId: string, workflowId: unknown): Promise<boolean> {
  if (typeof workflowId !== "string" || workflowId === "") return false
  try {
    return (await workflowAccess(readerId, workflowId)) !== "none"
  } catch {
    return false
  }
}

/** Which of these workflows the reader can open, each looked up once. */
export async function workflowsReaderCanOpen(readerId: string, workflowIds: Iterable<unknown>): Promise<Set<string>> {
  const ids = [...new Set([...workflowIds].filter((id): id is string => typeof id === "string" && id !== ""))]
  const answers = await Promise.all(ids.map(async (id) => [id, await readerCanOpenWorkflow(readerId, id)] as const))
  return new Set(answers.filter(([, open]) => open).map(([id]) => id))
}

/** Did this reader create this workflow? False when it cannot be told. */
export async function readerCreatedWorkflow(readerId: string, workflowId: unknown): Promise<boolean> {
  if (typeof workflowId !== "string" || workflowId === "") return false
  // A lookup that throws means "not the creator", as readerCanOpenWorkflow treats one: the words stay withheld.
  try {
    const { data, error } = await supabase
      // tenant-scope-ignore: reads a workflow's creator in order to compare it with the reader.
      .from("workflows")
      .select("user_id")
      .eq("id", workflowId)
      .maybeSingle()
    if (error || !data) return false
    return (data as { user_id?: unknown }).user_id === readerId
  } catch {
    return false
  }
}

/**
 * The reader of one run's states: whether they can open the run's workflow,
 * looked up only when `states` carry words a non-admin reader could be shown.
 * (`canRead: true` otherwise, which then changes nothing.)
 */
export async function runStatesReader(
  states: unknown,
  reader: { readonly isAdmin: boolean; readonly userId: string; readonly workflowId: unknown },
): Promise<ProviderWordsReader> {
  if (!runStatesNeedReaderRelation(states, reader.isAdmin)) return { isAdmin: reader.isAdmin, canRead: true }
  return { isAdmin: reader.isAdmin, canRead: await readerCanOpenWorkflow(reader.userId, reader.workflowId) }
}
