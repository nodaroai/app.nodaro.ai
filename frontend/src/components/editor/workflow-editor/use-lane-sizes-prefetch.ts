import { useEffect } from "react"
import { refreshLaneSizes } from "./list-fan-out-width"

/**
 * Read the caller's concurrency line sizes for the open workflow as soon as it
 * opens, so a List fan-out finds them cached and never waits for them
 * (list-fan-out-width.ts). Later reads are started by the fan-outs themselves,
 * at most once per LANE_SIZES_REFRESH_MS. Not `enabled` (a read-only
 * editor, where no fan-out can run), it reads nothing; nor before the
 * workflow's id is known (the editor opens before its workflow loads), when
 * the answer could not be the open workflow's.
 */
export function useLaneSizesPrefetch(workflowId: string | null | undefined, enabled: boolean = true): void {
  useEffect(() => {
    if (enabled && workflowId) refreshLaneSizes(workflowId)
  }, [workflowId, enabled])
}
