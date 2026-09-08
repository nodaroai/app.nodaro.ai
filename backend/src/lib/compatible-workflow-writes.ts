import { supabase } from "./supabase.js"
import type { PluginWorkflowsToolkit } from "./private-plugins/types.js"

/** Privileged transport for an authorized, codec-validated server write. */
export const writeCompatible: NonNullable<PluginWorkflowsToolkit["writeCompatible"]> = async (input) => {
  const result = input.kind === "create"
    ? await supabase.rpc("create_compatible_workflow", { p_row: input.row })
    : await supabase.rpc("compare_and_swap_compatible_workflow", {
      p_workflow_id: input.workflowId, p_expected_version: input.expectedVersion, p_patch: input.patch,
    })
  return { data: (Array.isArray(result.data) ? result.data[0] : result.data) ?? null, error: result.error }
}
