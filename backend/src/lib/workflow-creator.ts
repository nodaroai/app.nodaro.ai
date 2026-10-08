import { supabase } from "./supabase.js"

/**
 * Whether `userId` built the workflow: its creator, `workflows.user_id`. That
 * is the identity the orchestrator keeps as `ctx.workflowOwnerId` and an HTTP
 * credential resolves for. It is not an access level (`workflow-access.ts`):
 * a platform or workspace admin can hold `own` on a workflow somebody else
 * built, and this asks whose steps a run carries.
 *
 * Fail closed: a workflow that is gone (deleted, with any app published from
 * it, while a run of it was still under way) answers false.
 */
export async function isWorkflowCreator(workflowId: string, userId: string): Promise<{ creator: boolean; error: unknown }> {
  const { data, error } = await supabase.from("workflows").select("id").eq("id", workflowId).eq("user_id", userId).maybeSingle()
  return { creator: !error && data !== null, error }
}
