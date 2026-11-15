/**
 * How a deployment's own lists withhold what it offers: `surface.nodes` and
 * `surface.models` in its runtime configuration, each an `allow` / `deny`
 * pair. This is the platform's rule before any admin setting (Admin →
 * Availability can replace the lists, and switches models off); a client
 * applies it the same way before the platform's per-viewer answer
 * (`GET /v1/surface/availability`) has arrived, or after it could not be read,
 * so a restricted deployment is judged by its own lists from the first paint.
 * The worlds' half is `worldOffered` (worlds.ts).
 *
 * Structural vocabulary only (ids and node-type names), no content.
 */

/** One kind's lists (`surface.nodes`, `surface.models`). */
export interface SurfaceAllowDeny {
  readonly allow: readonly string[]
  readonly deny: readonly string[]
}

/** Whether a kind's lists say anything: either one names an id. */
export function listsSet(lists: SurfaceAllowDeny | undefined): boolean {
  return lists !== undefined && (lists.allow.length > 0 || lists.deny.length > 0)
}

/**
 * Whether `lists` withhold `id`. A non-empty `allow` is a whitelist: it
 * withholds every id outside it that it governs (`gated`: a whitelist only
 * inverts over the ids an operator can see and set). `deny` withholds every
 * id it names, governed or not, and wins over `allow`.
 */
export function listsWithhold(lists: SurfaceAllowDeny, id: string, gated: (id: string) => boolean): boolean {
  if (lists.allow.length > 0 && gated(id) && !lists.allow.includes(id)) return true
  return lists.deny.includes(id)
}

/**
 * Node types an `allow` list never withholds by leaving them out, so only
 * `deny` withholds them: the canvas's utility nodes (they cost nothing and run
 * nothing, and a whitelist that forgot the sticky note must not take away the
 * canvas's notes) and Site Capture (an install switch governs it). The
 * platform's own registry is held to this list.
 */
export const ALLOW_LIST_EXEMPT_NODE_TYPES: readonly string[] = Object.freeze([
  "collect",
  "component",
  "deduplicate",
  "extract-field",
  "filter-list",
  "group",
  "json-process",
  "merge-lists",
  "preview",
  "router",
  "selector",
  "site-capture",
  "sort-list",
  "sticky-note",
  "teleport-receive",
  "teleport-send",
])

const EXEMPT: ReadonlySet<string> = new Set(ALLOW_LIST_EXEMPT_NODE_TYPES)

/** Whether a node whitelist governs `type`: every node type but {@link ALLOW_LIST_EXEMPT_NODE_TYPES}. */
export function isAllowListGatedNodeType(type: string): boolean {
  return !EXEMPT.has(type)
}

/**
 * Capabilities a `deny` of another node withholds too: a one-off voice clone
 * inside a speech node is voice cloning behind another door, so a deployment
 * that denies the Voice Clone node withholds it.
 */
const DENY_OF_NODE_WITHHOLDS: ReadonlyMap<string, string> = new Map([["voice-clone-one-off", "voice-clone"]])

/**
 * Whether a deployment's node lists withhold `type`: {@link listsWithhold}
 * over the node types a whitelist governs, and a capability that follows a
 * denied node. `gated` is the caller's universe; by default
 * {@link isAllowListGatedNodeType}, which governs a type it has never heard of
 * (a client then withholds it rather than offering it).
 */
export function nodeListsWithhold(nodes: SurfaceAllowDeny, type: string, gated: (type: string) => boolean = isAllowListGatedNodeType): boolean {
  if (listsWithhold(nodes, type, gated)) return true
  const follows = DENY_OF_NODE_WITHHOLDS.get(type)
  return follows !== undefined && nodes.deny.includes(follows)
}
