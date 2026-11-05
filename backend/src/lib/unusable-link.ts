/**
 * A link that two URL parsers would read differently (a backslash, or an
 * ASCII control character such as a tab or a line break). The routes that
 * fetch someone else's link, or hand it on to be fetched, refuse it before
 * anything reads it, so the site's policy and the rights check always judge
 * the link that is fetched. No real link to a video's page or a media file
 * contains one of these.
 */
import { hasUrlParserHazard } from "@nodaro/shared/video"

export const UNUSABLE_LINK_MESSAGE = "That link can't be used: it contains a character a link cannot have. Paste the link again."

/** The 400 error for such a link, or null for a link that reads one way. */
export function unusableLinkError(url: string | undefined): { code: "validation_error"; message: string } | null {
  return url !== undefined && hasUrlParserHazard(url) ? { code: "validation_error", message: UNUSABLE_LINK_MESSAGE } : null
}
