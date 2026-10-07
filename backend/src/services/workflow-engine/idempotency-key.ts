import { createHash } from "node:crypto"

/**
 * A key longer than this, or carrying anything but printable ASCII, is hashed:
 * a request header must be a ByteString (a non-Latin-1 node id makes `fetch`
 * throw), and the routes that read the key bound it at 200 characters — past
 * that they drop it, silently losing the replay protection it exists for.
 */
const MAX_PLAIN_KEY_LENGTH = 180
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/

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
  const plain = `wf-${executionId}-${path}`
  if (plain.length <= MAX_PLAIN_KEY_LENGTH && PRINTABLE_ASCII.test(plain)) return plain
  return `wf-${executionId}-${createHash("sha256").update(path).digest("hex").slice(0, 40)}`
}

/** The scope segment a sub-workflow node adds for the nodes inside it. */
export function idempotencyScopeSegment(nodeId: string, iterationIndex?: number): string {
  return iterationIndex === undefined ? nodeId : `${nodeId}-${iterationIndex}`
}
