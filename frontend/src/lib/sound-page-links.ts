/**
 * A link to where a video is (a page link), used as the SOUND of Transcribe or
 * Suno Cover, comes in through a Video URL node: that node asks for the
 * content rights declaration and fetches the sound under it, and both engines
 * read that track (`downloadedAudioUrl`; `payload-builder.ts` and
 * `execute-node.ts`), never the page link again. Given to one of these nodes
 * any other way it would be an import with no box to confirm it, so the editor
 * never fetches it for them: a run whose node would hand one on stops before
 * anything starts, naming the node. (Suno Upload Extend takes an audio file:
 * the canvas wires no Video URL node into it, and a link written into it
 * through the API is the server's to answer.)
 *
 * What a run of such a node uses as its sound, in the order both engines read
 * it: the track of a Video URL node wired in, then a field mapping of its link
 * field, then anything else wired into its `audio` input, then its own link
 * fields. Only what the editor can read before the run is judged here: its own
 * fields, and a Text node mapped into its link field. A value made during the
 * run is the server's to answer.
 */
import { isSocialVideoUrl } from "@nodaro/shared/video"

export interface SoundSourceNode {
  readonly id: string
  readonly type?: string
  readonly data?: unknown
}

export interface SoundSourceEdge {
  readonly source: string
  readonly target: string
  readonly targetHandle?: string | null
}

/** The node types that take a link as their sound, and their own link fields in the order a run reads them. */
const OWN_SOUND_FIELDS: ReadonlyMap<string, readonly string[]> = new Map([
  ["transcribe", ["audioUrl"]],
  ["suno-cover", ["uploadUrl", "audioUrl"]],
])

/** The field a mapping can fill with a link, per type. */
const MAPPED_LINK_FIELD: ReadonlyMap<string, string> = new Map([["suno-cover", "uploadUrl"]])

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function dataOf(node: SoundSourceNode): Record<string, unknown> {
  return (node.data as Record<string, unknown> | undefined) ?? {}
}

/** A run on this canvas reaches the node: not frozen, not a sub-workflow's node (its own editor answers for it). */
function runsHere(node: SoundSourceNode): boolean {
  return !node.id.startsWith("__sub_") && dataOf(node).skipped !== true
}

/** The sound the node's run takes from what the editor can read now: a link, or "" when it is a track or a file, made during the run, or none. */
function knownSoundLink(node: SoundSourceNode, nodes: readonly SoundSourceNode[], edges: readonly SoundSourceEdge[]): string {
  const into = edges.filter((e) => e.target === node.id)
  // A Video URL node wired in: its track is the sound (fetched before the run, under its own box).
  if (into.some((e) => nodes.find((n) => n.id === e.source)?.type === "youtube-video")) return ""
  const data = dataOf(node)
  const mappedField = MAPPED_LINK_FIELD.get(node.type ?? "")
  const mapping = mappedField ? (data.fieldMappings as Record<string, { sourceNodeId?: unknown }> | undefined)?.[mappedField] : undefined
  if (mapping && typeof mapping.sourceNodeId === "string") {
    const source = nodes.find((n) => n.id === mapping.sourceNodeId)
    return source?.type === "text-prompt" ? text(dataOf(source).text) : ""
  }
  // Wired into its sound input (a handle left unnamed counts as one): a file.
  if (into.some((e) => e.targetHandle === "audio" || e.targetHandle == null)) return ""
  for (const field of OWN_SOUND_FIELDS.get(node.type ?? "") ?? []) {
    const link = text(data[field])
    if (link) return link
  }
  return ""
}

/**
 * The audio track a Video URL node wired into this node fetched under its own
 * box (`downloadedAudioUrl`): the sound Transcribe and Suno Cover take from
 * it, as the server reads it (`payload-builder.ts` `videoLinkTrackInto`).
 * Undefined when none.
 */
export function videoLinkTrackInto(nodeId: string, nodes: readonly SoundSourceNode[], edges: readonly SoundSourceEdge[]): string | undefined {
  for (const edge of edges) {
    if (edge.target !== nodeId) continue
    const source = nodes.find((n) => n.id === edge.source)
    if (source?.type !== "youtube-video") continue
    const track = text(dataOf(source).downloadedAudioUrl)
    if (track) return track
  }
  return undefined
}

/** Whether this sound would be a page link given to the node directly (never a file, never a Video URL node's track). */
export function isSoundPageLink(link: string): boolean {
  return link !== "" && isSocialVideoUrl(link)
}

/**
 * The first node about to run (`scopeIds`; `null` = every node) whose sound,
 * as the editor can read it before the run, is a page link given to it
 * directly, or null.
 */
export function findSoundPageLink(
  nodes: readonly SoundSourceNode[],
  edges: readonly SoundSourceEdge[],
  scopeIds: readonly string[] | null,
): { readonly nodeId: string; readonly label: string } | null {
  const scope = scopeIds === null ? null : new Set(scopeIds)
  for (const node of nodes) {
    if (!OWN_SOUND_FIELDS.has(node.type ?? "") || (scope && !scope.has(node.id)) || !runsHere(node)) continue
    if (!isSoundPageLink(knownSoundLink(node, nodes, edges))) continue
    return { nodeId: node.id, label: text(dataOf(node).label) || node.type || "" }
  }
  return null
}
