/**
 * The Video URL node as a published-app input: what the runner's card holds and
 * whether Run may start on it. Pure — the card, the Run gate and the tests read
 * the same functions.
 *
 * The link rule is `videoLinkInputProblem` (`@nodaro/shared`), the very one the
 * server's run-request lock applies, plus the server's literal-host rule for a
 * direct link (no localhost, no private or reserved address), so a link the
 * card accepts is a link the server accepts. On top of it, a post link must carry a video in its address
 * (`extractVideoLinkId`): `youtube.com/` alone names a host, not a video.
 */
import {
  isLocalOrPrivateHostname,
  isSocialVideoUrl,
  videoLinkDownloadedFile,
  videoLinkInputProblem,
  videoLinkRunNeeds,
  type VideoLinkGraphEdge,
  type VideoLinkGraphNode,
  type VideoLinkNeed,
} from "@nodaro/shared"
import { extractVideoLinkId } from "@/lib/video-link"

export type VideoLinkInputView =
  | { readonly kind: "empty" }
  | { readonly kind: "invalid" }
  /** Any other web link: used as it is, nothing to download (the canvas node's own rule). */
  | { readonly kind: "direct"; readonly link: string }
  /** A post on a supported platform: downloaded before the run. */
  | { readonly kind: "social"; readonly link: string }

/**
 * A direct link whose host is this machine or a private address: the server
 * refuses it (`safeUrlSchema`, the same `isLocalOrPrivateHostname` rule), so the
 * card says so instead of calling it ready. Literal hosts only — a name that
 * resolves to a private address is caught where the server connects.
 */
function isLocalOrPrivateLink(link: string): boolean {
  try {
    return isLocalOrPrivateHostname(new URL(link).hostname)
  } catch {
    return true
  }
}

export function classifyVideoLinkInput(raw: unknown): VideoLinkInputView {
  const problem = videoLinkInputProblem(raw)
  if (problem === "empty") return { kind: "empty" }
  if (problem !== null) return { kind: "invalid" }
  const link = (raw as string).trim()
  if (!isSocialVideoUrl(link)) return isLocalOrPrivateLink(link) ? { kind: "invalid" } : { kind: "direct", link }
  return extractVideoLinkId(link) === null ? { kind: "invalid" } : { kind: "social", link }
}

/** The fields of a Video URL app input, as the runner holds them. */
export interface VideoLinkInputValues {
  readonly youtubeUrl?: unknown
  readonly downloadedVideoUrl?: unknown
  readonly downloadedFromUrl?: unknown
  readonly [key: string]: unknown
}

/**
 * The input's values: the runner's own once they have set a link, else the
 * creator's sample. NEVER a merge of the two — the creator's downloaded file
 * (an old node has no `downloadedFromUrl` binding, so it is trusted) would
 * otherwise stand under the link the runner just typed.
 */
export function videoLinkInputValues(
  data: Readonly<Record<string, unknown>>,
  inputVals: Readonly<Record<string, unknown>> | undefined,
): VideoLinkInputValues {
  return inputVals && inputVals.youtubeUrl !== undefined ? inputVals : data
}

/**
 * What a Video URL input must have fetched for the app's graph: the video
 * (`file`), only its sound (`audio`), or nothing (`none`) — one reading of the
 * graph shared with the editor's pre-run gate and the server's pre-run fetch.
 * A link that feeds nothing the graph shows (or no graph at all) is `file`:
 * the card's long-standing behaviour, and the safe one.
 */
export function videoLinkInputNeed(
  nodeId: string,
  graph: { readonly nodes: readonly VideoLinkGraphNode[]; readonly edges: readonly VideoLinkGraphEdge[] } | undefined,
): VideoLinkNeed {
  if (!graph) return "file"
  return videoLinkRunNeeds(null, graph.nodes, graph.edges).get(nodeId) ?? "file"
}

/**
 * Can Run start on this input: a usable link, and for a post link whose video
 * the app needs (`file`, the default) the file fetched from it. A post link read
 * only for its sound or its page address needs no file here — the run fetches
 * the sound itself.
 */
export function isVideoLinkInputReady(values: VideoLinkInputValues, need: VideoLinkNeed = "file"): boolean {
  const view = classifyVideoLinkInput(values.youtubeUrl)
  if (view.kind === "direct") return true
  if (view.kind !== "social") return false
  return need !== "file" || videoLinkDownloadedFile(values) !== undefined
}
