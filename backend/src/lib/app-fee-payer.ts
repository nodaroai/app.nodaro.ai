/**
 * Who pays a monetized app's creator fee on a workspace-paid run: the
 * workspace, when its organization has approved the app (the approval is
 * keyed on the app's workflow, so it holds across versions), or the runner
 * personally otherwise. The same decision `process_app_monetization` makes
 * when it settles the fee (migrations 352 / 599 / 604), read before the run so
 * a run that cannot pay is refused up front.
 *
 * Returns null when the approval list cannot be read: the caller then skips
 * its up-front check, and the settlement still collects only what the payer
 * holds.
 */
import { supabase } from "./supabase.js"

export async function appFeeWorkspacePays(orgId: string, workflowId: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase
      // tenant-scope-ignore: the approval of one app by the payer's own organization, read by both ids
      .from("organization_approved_apps")
      .select("workflow_id")
      .eq("org_id", orgId)
      .eq("workflow_id", workflowId)
      .limit(1)
    if (error) return null
    return (data ?? []).length > 0
  } catch {
    return null
  }
}
