/**
 * Canonical UUID validation — the single source of truth for "is this a real
 * backend id?".
 *
 * Synthetic local placeholders (e.g. `exec-node_4` for an orchestrator result
 * with no job UUID, or `upload-url-<ts>` for a pasted external URL) must never
 * be sent to `/v1/jobs/:id/status` — they 404 and spam the network. Guard every
 * backend-id lookup with `isValidUuid`.
 */
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id)
}
