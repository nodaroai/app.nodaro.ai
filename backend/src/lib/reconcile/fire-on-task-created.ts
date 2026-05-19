import type { ReconcileOpts } from "../../providers/provider.interface.js"

/**
 * Fire an async provider client's `onTaskCreated` hook with crash-safety.
 * Centralizes the try/catch every provider client needs between `createTask`
 * and the poll loop: a failed callback must never abort the in-flight call.
 *
 * Lives in its own file (separate from `persistence.ts`) so provider clients
 * can import it without pulling in `supabase` at module-load time — the other
 * helpers in `persistence.ts` do hit the DB and were tripping `vi.mock` setups
 * in existing provider tests that don't stub the supabase client.
 */
export async function fireOnTaskCreated(
  opts: ReconcileOpts | undefined,
  taskId: string,
  logPrefix: string,
): Promise<void> {
  if (!opts?.onTaskCreated) return
  try {
    await opts.onTaskCreated(taskId)
  } catch (err) {
    console.warn(`${logPrefix} onTaskCreated callback threw:`, err)
  }
}
