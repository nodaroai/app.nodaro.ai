import { createHash } from "node:crypto"

/**
 * A key longer than this, or carrying anything but printable ASCII, is hashed:
 * a request header must be a ByteString (a non-Latin-1 node id makes `fetch`
 * throw), and the routes that read the key bound it at 200 characters — past
 * that they drop it, silently losing the replay protection it exists for.
 */
const MAX_PLAIN_KEY_LENGTH = 180
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/

/** What every key one execution sends starts with: the one place it is spelled. */
const executionKeyPrefix = (executionId: string): string => `wf-${executionId}-`

/**
 * The `Idempotency-Key` a graph run sends for one node's write — the ONE rule
 * for every sync-HTTP route that keys on the header (`IDEMPOTENT_SYNC_HTTP_NODES`).
 *
 * `wf-<executionId>-<scope…>-<nodeId>[-<iteration>]`: the execution, the path
 * of sub-workflow nodes the node sits under (each with the fan-out iteration
 * that entered it), the node, and its own fan-out iteration. Two iterations of
 * one node, or two sub-workflow nodes running the same child workflow, never
 * share a key; a re-pick of the same iteration always does. Without the scope,
 * every iteration of a fan-out INTO a sub-workflow wrote once and reported the
 * rest as replayed (review finding H2, 2026-10-06).
 *
 * When the plain key would not fit a header, everything after the execution id
 * is hashed — still deterministic, so still a replay key.
 */
export function syncHttpIdempotencyKey(
  executionId: string,
  nodeId: string,
  iterationIndex?: number,
  scope: readonly string[] = [],
): string {
  const path = [...scope, nodeId].join("-") + (iterationIndex === undefined ? "" : `-${iterationIndex}`)
  const prefix = executionKeyPrefix(executionId)
  const plain = `${prefix}${path}`
  if (plain.length <= MAX_PLAIN_KEY_LENGTH && PRINTABLE_ASCII.test(plain)) return plain
  return `${prefix}${createHash("sha256").update(path).digest("hex").slice(0, 40)}`
}

/**
 * Whether a job's `idempotency_key` is one THIS execution sent for a request — any key
 * `syncHttpIdempotencyKey` builds for it, plain or hashed. A key a route writes for its own
 * reasons (UGC Clip's content key) is not, and neither is another execution's.
 */
export function isExecutionRequestKey(key: unknown, executionId: string): boolean {
  return typeof key === "string" && executionId.length > 0 && key.startsWith(executionKeyPrefix(executionId))
}

/** The scope segment a sub-workflow node adds for the nodes inside it. */
export function idempotencyScopeSegment(nodeId: string, iterationIndex?: number): string {
  return iterationIndex === undefined ? nodeId : `${nodeId}-${iterationIndex}`
}
