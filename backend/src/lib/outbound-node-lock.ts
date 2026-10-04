/**
 * The outbound-node vocabulary: which node types send to, or fetch from, a
 * destination named in their OWN node data, and which data keys name such a
 * destination.
 *
 * Two surfaces share it, and sharing is the point — one list, so a new
 * outbound node is covered on both at once:
 *   - the Workflow Copilot (`ee/copilot/tools/deny-lists.ts`): the MODEL may
 *     not author or re-point one of these nodes;
 *   - the run-request override lock (`lib/input-override-lock.ts`): a RUNNER's
 *     `inputOverrides` may not re-point one either (issue #1555).
 *
 * The type set is DERIVED from the orchestrator's executors by
 * `ee/copilot/__tests__/deny-lists.test.ts` — a node whose executor reads a
 * destination from node data and is missing here fails that test.
 *
 * Core, not `ee/`: published apps and share-for-run exist in every edition, so
 * the lock that protects them must too.
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
  "meta-ads-scrape",
  "instagram-scrape",
  "rss-feed",
  "telegram-channel-feed",
  "youtube-video",
  // Social Search reads a platform, an account or keyword and a subreddit
  // from node data and fetches from that platform.
  "social-search",
  // Telegram Reply writes as the owner's connected account (`accountId`) or
  // bot (`connectionId`). Every destination is the owner, but WHOSE account
  // writes is the owner's to choose on the canvas. Not a publisher the
  // copilot may lift: it acts as a person, not as a page.
  "telegram-account-send",
])

/**
 * The publishers, as a named subset.
 *
 * These are the ONLY denied types the copilot lets a user lift, and only for
 * their own thread: they post under an account the user already connected, so
 * the harm ceiling is unwanted content on their own timeline. `webhook-output`
 * and the outbound fetchers stay denied for everyone, always — those name an
 * arbitrary host in node data, which is exfiltration, not embarrassment.
 *
 * A subset rather than a shrunken `DENIED_NODE_TYPES`, because that set is
 * DERIVED from the orchestrator's executor by a test: removing a member would
 * mean a genuinely outbound node had stopped being covered.
 */
export const SOCIAL_PUBLISHER_TYPES: ReadonlySet<string> = new Set([
  "x-post",
  "telegram-post",
  "linkedin-post",
  "facebook-post",
  "instagram-post",
  "tiktok-post",
  "youtube-upload",
  "publish-social",
])

/** Named destination fields that do not end in "url". */
export const NAMED_DESTINATION_FIELDS: ReadonlySet<string> = new Set([
  "target",
  // Instagram Scrape reads a LIST of profiles / hashtags from `data.targets`
  // (`splitInstagramTargets`) — plural, so neither the `*Url` pattern nor
  // `target` catches it. The derivation test asserts every destination key
  // an executor reads is locked, so the next plural ships covered.
  "targets",
  // Meta Ads in "advertiser" mode reads `data.advertisers` — a LIST of picked
  // pages. The list is the destination: blank it and the executor resolves
  // whatever names the upstream text carries. Exists on that node type only.
  "advertisers",
  "query",
  // Social Search's Reddit keyword search reads the subreddit to search in.
  "subreddit",
  "channel",
  "chatId",
  "connectionId",
  // A connected Telegram account (plugin_account_secrets row) a node listens
  // or writes through — the same move as swapping the connection.
  "accountId",
  // A stored HTTP credential the node sends with. Not a destination by itself,
  // but it decides WHOSE key travels with the request, so swapping it is the
  // same move as swapping the URL.
  "credentialId",
  "platform",
  "webhook",
  "endpoint",
  "host",
  // Not a destination — a DISCLOSURE control, and locked for the same reason.
  // Publishing nodes default to `private`, and once a caller can author one
  // the difference between a draft the user reviews and a post the world sees
  // is this single word. Who can see the result stays the user's decision, on
  // the canvas.
  "privacy",
])

/**
 * Keys that choose WHICH destination field an outbound executor reads —
 * `actor` picks the Web Scrape branch, `mode` picks page-vs-search on Meta
 * Ads and profile-vs-hashtag on Instagram. Each branch falls back to the
 * upstream text when its own field is empty, so flipping the selector aims
 * the fetch at whatever a text input carries. Not destinations themselves, and
 * `mode` is an ordinary key on many other node types — so these are locked
 * ONLY for a run request on an outbound node (`findLockedOverrides`), never
 * by `isLockedField`, which the copilot applies to every node. The copilot
 * needs no selector lock today: `allowPublishing` lifts only the publishers,
 * and no publisher has a selector — an `allowFetchers` would have to add it.
 * Telegram Reply's `sendAs` (account or bot) and `destination` (under the
 * post or Saved Messages) choose which of the owner's chats it writes to.
 */
export const OUTBOUND_SELECTOR_FIELDS: ReadonlySet<string> = new Set(["actor", "mode", "sendAs", "destination"])

/**
 * A field nobody but the person editing the canvas may set. Media reaches a
 * node through an edge, a saved entity or the user's upload — never through a
 * value a model or a run request INVENTED. Pattern-matched rather than listed:
 * the engine reads ~38 distinct `*Url` keys, and a hand-kept list was already
 * missing most of them.
 */
export function isLockedField(key: string): boolean {
  return /urls?$/i.test(key) || NAMED_DESTINATION_FIELDS.has(key)
}

/** True for a plain object (not null, not an array). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export interface LockedPathOptions {
  /** Keys locked in ADDITION to `isLockedField` — the run lock passes `OUTBOUND_SELECTOR_FIELDS`. */
  readonly extraKeys?: ReadonlySet<string>
}

/**
 * Deeper than this and the walk stops descending and reports the path itself:
 * a shape that deep is not a node's data, and refusing it is the fail-closed
 * answer (a stack overflow would surface as a 500, not as `locked_field`).
 */
export const MAX_LOCK_WALK_DEPTH = 32

/**
 * Every locked field a field map TOUCHES, as dotted paths — walked recursively,
 * so a destination nested inside a config object (`probedVideo.url`), inside a
 * list of objects (`extraRefs[1].url`), or inside a list of lists counts.
 *
 * PRESENCE is what is reported, whatever the value: the merge is a spread, so
 * `url: ""` / `null` / `[]` WRITES that empty value over the author's, and
 * every outbound fetcher then falls back to the upstream text — which a run
 * request can also supply. A blanked destination is a re-pointed destination.
 * A locked key is reported as ONE leaf whatever it holds (`imageUrls: [...]`
 * is `imageUrls`, not one path per element).
 */
export function lockedFieldPaths(
  fields: Record<string, unknown>,
  path = "",
  opts: LockedPathOptions = {},
  depth = 0,
): string[] {
  const found: string[] = []
  for (const [key, value] of Object.entries(fields)) {
    const here = path ? `${path}.${key}` : key
    if (isLockedField(key) || opts.extraKeys?.has(key)) {
      found.push(here)
      continue
    }
    if (depth >= MAX_LOCK_WALK_DEPTH) {
      found.push(here)
      continue
    }
    if (isPlainObject(value)) {
      found.push(...lockedFieldPaths(value, here, opts, depth + 1))
      continue
    }
    if (Array.isArray(value)) found.push(...lockedPathsInList(value, here, opts, depth + 1))
  }
  return found
}

/** Objects inside a list — at any depth of nesting — are walked like the node's own map. */
function lockedPathsInList(
  items: ReadonlyArray<unknown>,
  path: string,
  opts: LockedPathOptions,
  depth: number,
): string[] {
  const found: string[] = []
  items.forEach((item, i) => {
    const here = `${path}[${i}]`
    if (depth >= MAX_LOCK_WALK_DEPTH) {
      if (isPlainObject(item) || Array.isArray(item)) found.push(here)
      return
    }
    if (isPlainObject(item)) found.push(...lockedFieldPaths(item, here, opts, depth + 1))
    else if (Array.isArray(item)) found.push(...lockedPathsInList(item, here, opts, depth + 1))
  })
  return found
}
