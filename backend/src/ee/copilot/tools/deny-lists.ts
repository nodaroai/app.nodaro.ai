/**
 * What the model may NOT author through `edit_workflow`.
 *
 * Security boundary, not a UX preference: a prompt injected through node data,
 * an entity description or a provider error string could otherwise add (or
 * re-point) a node that ships the user's data out of the platform and then
 * propose a run. The model builds media pipelines; egress, publishing and
 * fetching from a named destination are the user's to configure by hand.
 *
 * TWO layers, because the first one alone was not enough (review of PR 2):
 *   1. `DENIED_NODE_TYPES` — a node whose executor sends to, or fetches from,
 *      a destination named in its own data. Guarded by
 *      `__tests__/deny-lists.test.ts`, which DERIVES the set from the
 *      orchestrator's executor so a new outbound node cannot ship uncovered.
 *   2. `isLockedField` — a destination-shaped field on ANY node, matched by
 *      pattern (every `*Url`/`*Urls` key plus the named destinations), checked
 *      RECURSIVELY. A nested `data.probedVideo.url` is a destination too.
 */

/** Node types whose executor reads a destination (URL / account / channel) from node data. */
export const DENIED_NODE_TYPES: ReadonlySet<string> = new Set([
  // Inline executor: POSTs every upstream output to `data.url`.
  "webhook-output",
  // Social publishers: post under the user's connected accounts.
  "x-post",
  "telegram-post",
  "linkedin-post",
  "facebook-post",
  "instagram-post",
  "tiktok-post",
  "youtube-upload",
  "publish-social",
  // Outbound FETCHERS: the request goes to a host the node data names, so the
  // query string is an exfiltration channel even though nothing is "posted".
  "web-scrape",
  "rss-feed",
  "telegram-channel-feed",
  "youtube-video",
])

/** Named destination fields that do not end in "url". */
const NAMED_DESTINATION_FIELDS: ReadonlySet<string> = new Set([
  "target",
  "query",
  "channel",
  "chatId",
  "connectionId",
  "platform",
  "webhook",
  "endpoint",
  "host",
])

/**
 * A field the model may not introduce or change. Media reaches a node through
 * an edge, a saved entity or the user's upload — never through a value the
 * model typed. Pattern-matched rather than listed: the engine reads ~38
 * distinct `*Url` keys, and a hand-kept list was already missing most of them.
 */
export function isLockedField(key: string): boolean {
  return /urls?$/i.test(key) || NAMED_DESTINATION_FIELDS.has(key)
}

export function isDeniedNodeType(type: unknown): boolean {
  return typeof type === "string" && DENIED_NODE_TYPES.has(type)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Every locked-field leaf inside a value, as `[path, jsonValue]`.
 *
 * Used for the array case, where position is not identity: `extraRefs` is a
 * list the user reorders and deletes from, so comparing `after[i]` against
 * `before[i]` reports every element after a removal as changed. What the lock
 * actually cares about is whether a destination is NEW to this node, so the
 * comparison is by VALUE across the whole array.
 */
function lockedLeaves(value: unknown, path: string, out: Array<[string, string]>): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => lockedLeaves(item, `${path}[${i}]`, out))
    return
  }
  if (!isPlainObject(value)) return
  for (const [key, inner] of Object.entries(value)) {
    const here = path ? `${path}.${key}` : key
    if (isPlainObject(inner) || Array.isArray(inner)) {
      lockedLeaves(inner, here, out)
      continue
    }
    if (!isLockedField(key)) continue
    if (inner === undefined || inner === null || inner === "") continue
    out.push([here, JSON.stringify(inner)])
  }
}

/**
 * Locked fields whose value the model introduced or changed versus `before` —
 * walked recursively, so a destination nested inside a config object counts.
 * Preserving a value that already exists on the node is allowed (it is the
 * user's own).
 */
export function changedLockedUrlFields(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  path = "",
): string[] {
  const changed: string[] = []
  for (const [key, next] of Object.entries(after)) {
    const here = path ? `${path}.${key}` : key
    const prev = isPlainObject(before) ? before[key] : undefined

    if (isPlainObject(next)) {
      changed.push(...changedLockedUrlFields(isPlainObject(prev) ? prev : undefined, next, here))
      continue
    }

    // An ORDINARY key holding a list — `extraRefs` is the one that matters, and
    // it was invisible to this lock until now: the walk only descended into
    // plain objects, so a list of `{url}` objects under a key that is not
    // itself locked was waved straight through, and the run engine hands those
    // urls to providers. A LOCKED key holding an array stays a leaf below
    // (`imageUrls` is whole-array preserve-or-reject, unchanged).
    if (!isLockedField(key) && Array.isArray(next)) {
      if (prev !== undefined && JSON.stringify(prev) === JSON.stringify(next)) continue
      const known = new Set<string>()
      const before_: Array<[string, string]> = []
      lockedLeaves(prev, "", before_)
      for (const [, value] of before_) known.add(value)
      const after_: Array<[string, string]> = []
      lockedLeaves(next, here, after_)
      for (const [leafPath, value] of after_) if (!known.has(value)) changed.push(leafPath)
      continue
    }

    if (!isLockedField(key)) continue
    if (next === undefined || next === null || next === "") continue
    if (Array.isArray(next) && next.length === 0) continue
    if (prev !== undefined && JSON.stringify(prev) === JSON.stringify(next)) continue
    changed.push(here)
  }
  return changed
}
