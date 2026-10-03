import { FAN_OUT_EACH_HANDLES } from "@nodaro/shared"

/**
 * A node that runs once per upstream item and fans out per HANDLE (Camera
 * Switch per clip — `FAN_OUT_EACH_HANDLES`) keeps exactly its LAST batch on
 * `__listResults`: the per-item results its "each" handle lists (JSON, which the
 * URL-only result syncs skip), or none after a single run, so an earlier run's
 * items never fan out again. Every lane that writes a run's results onto the
 * node (live server run, reload restore, completed-run sync) applies it.
 * `undefined` for any other node type — their list writes are unchanged.
 */
export function lastBatchFields(
  nodeType: string | undefined,
  listResults: readonly string[] | undefined,
): Record<string, unknown> | undefined {
  if (!Object.prototype.hasOwnProperty.call(FAN_OUT_EACH_HANDLES, nodeType ?? "")) return undefined
  return Array.isArray(listResults) && listResults.length > 1
    ? { __listResults: [...listResults], __listTotal: listResults.length, __listCompleted: listResults.length }
    : { __listResults: undefined }
}

/**
 * Everything a server run writes onto a per-handle fan-out node: its last
 * batch (above) and, for Camera Switch, its `{ edl, transcript }` pair on
 * `generatedJson` — the shape the canvas run and the job restore write, which
 * the node, its transcript wire and the Apply EDL estimate read.
 */
export function perHandleRunFields(
  nodeType: string | undefined,
  output: { listResults?: readonly string[]; json?: unknown } | undefined,
): Record<string, unknown> | undefined {
  const batch = lastBatchFields(nodeType, output?.listResults)
  if (!batch) return undefined
  const pair = nodeType === "camera-switch" && output?.json && typeof output.json === "object" ? { generatedJson: output.json } : {}
  return { ...batch, ...pair }
}
