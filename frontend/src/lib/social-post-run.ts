/**
 * A social post node's result on the node: the post's link, which the "View
 * post" link on the card and in the settings panel reads (`platformPostUrl`),
 * and the platform's id for it.
 *
 * ONE mapping for every lane that lands a publish: the single-node Run (the
 * publish answer), a workflow run's node states, live and on both reopen lanes
 * (`output.json`, which the orchestrator fills from the publish job), and the
 * job restores (the job's `output_data`). A lane that skipped it showed
 * "Published" with no link: a workflow run did, until this.
 */
import { SOCIAL_POST_NODE_TYPES } from "@nodaro/shared/social"

/** What a publish reports about the post: from the answer, the node state's `json` or the job's output. */
export interface PublishedPost {
  readonly platformPostId?: unknown
  readonly platformPostUrl?: unknown
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

/**
 * The post's link when it is a web address. It becomes the href of "View
 * post", and a self-hosted network (WordPress, Mastodon, Lemmy) writes it from
 * its own answer, so any other scheme (`javascript:`, `data:`) is never a link.
 */
function webLink(value: unknown): string | undefined {
  const text = nonEmptyText(value)
  if (text === undefined) return undefined
  try {
    const { protocol } = new URL(text)
    return protocol === "https:" || protocol === "http:" ? text : undefined
  } catch {
    return undefined
  }
}

/** Whether `nodeType` publishes through POST /v1/social/publish. */
export function isSocialPostNodeType(nodeType: string | undefined): nodeType is string {
  return nodeType !== undefined && SOCIAL_POST_NODE_TYPES.has(nodeType)
}

/**
 * The post's link and id for a social post node, both written (a run whose
 * post has no link clears an earlier run's); nothing for any other node, or
 * when `post` is not an object (a node state whose `json` holds no post).
 */
export function socialPostRunFields(nodeType: string | undefined, post: unknown): Record<string, unknown> {
  if (!isSocialPostNodeType(nodeType) || !post || typeof post !== "object") return {}
  const { platformPostId, platformPostUrl } = post as PublishedPost
  return {
    platformPostId: nonEmptyText(platformPostId),
    platformPostUrl: webLink(platformPostUrl),
  }
}
