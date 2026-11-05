/**
 * The content rights box, as this page holds it: which Video URL node is ticked,
 * for which link. SESSION state on purpose — never node data, never an input
 * value, never saved: a workflow or an app run saved ticked must not let the
 * next person's Run confirm for them, and a confirmation is one download's
 * (`lib/content-rights.ts`), so nothing is kept past the moment it is used.
 *
 * Two readers: the editor's Video URL node (`video-link-ingest.ts`, which
 * confirms and fetches under the tick) and the app page's Video URL input
 * (`video-link-input-card.tsx`, whose downloads confirm as they go). A link
 * the RUN fetches (one read only for its sound) is confirmed at submit time,
 * once per run, by `withVideoLinkRightsConfirmations` — so the id a run
 * carries is minutes old and spent by that run alone.
 */
import { useSyncExternalStore } from "react"
import { isSocialVideoUrl, videoLinkRunNeeds, type VideoLinkGraphEdge, type VideoLinkGraphNode } from "@nodaro/shared/video"
import { DeclarationChangedError, confirmLink } from "@/lib/content-rights"
import { onDeclarationChanged } from "@/lib/declaration-changes"

const ticked = new Map<string, string>()
const listeners = new Set<() => void>()
/** Bumped on every change: what a memo over "are the inputs filled" depends on. */
let version = 0

function notify(): void {
  version += 1
  for (const listener of listeners) listener()
}

/** Tick the box for `link` on this node. Only a post link can be ticked; anything else unticks. */
export function tickVideoLinkRights(nodeId: string, link: string): void {
  const url = link.trim()
  const was = ticked.get(nodeId)
  if (url !== "" && isSocialVideoUrl(url)) ticked.set(nodeId, url)
  else ticked.delete(nodeId)
  if (ticked.get(nodeId) !== was) notify()
}

export function untickVideoLinkRights(nodeId: string): void {
  if (!ticked.delete(nodeId)) return
  notify()
}

/** Whether the box is ticked for exactly this link on this node. */
export function isVideoLinkRightsTicked(nodeId: string, link: string): boolean {
  const url = link.trim()
  return url !== "" && ticked.get(nodeId) === url
}

export function subscribeVideoLinkRights(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The box's state for a node and link, re-rendered when it changes. */
export function useVideoLinkRightsTicked(nodeId: string, link: string): boolean {
  return useSyncExternalStore(
    subscribeVideoLinkRights,
    () => isVideoLinkRightsTicked(nodeId, link),
    () => false,
  )
}

const currentVersion = (): number => version

/**
 * A number that changes whenever any box does — for a memo that reads the
 * boxes through `isVideoLinkRightsTicked` (the app page's "every input is
 * filled") and would otherwise never recompute on a tick.
 */
export function useVideoLinkRightsVersion(): number {
  return useSyncExternalStore(subscribeVideoLinkRights, currentVersion, currentVersion)
}

/** Every box unticked: another workflow, another account, a changed declaration, a test. */
export function clearVideoLinkRights(): void {
  if (ticked.size === 0) return
  ticked.clear()
  notify()
}

// Every box was ticked under the text a changed declaration replaced.
onDeclarationChanged(clearVideoLinkRights)

type Overrides = Record<string, Record<string, unknown>>

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * The run request's overrides with a confirmation for every Video URL node
 * whose SOUND the run will fetch: a post link read only by Transcribe / Suno
 * Cover, with no track stored for it, and its box ticked. Confirmed now, for
 * this run, as the node's `rightsConfirmationId`. A node the run does not
 * fetch for (its video was downloaded on the page, its track is stored, its
 * readers take the page address) gets nothing; an unticked one gets nothing
 * either — readiness holds Run for it. A confirmation the server refuses
 * throws, and the run does not start.
 */
export async function withVideoLinkRightsConfirmations(
  nodes: readonly VideoLinkGraphNode[],
  edges: readonly VideoLinkGraphEdge[],
  overrides: Overrides | undefined,
): Promise<Overrides | undefined> {
  const needs = videoLinkRunNeeds(null, nodes, edges)
  let out = overrides
  for (const node of nodes) {
    if (node.type !== "youtube-video" || needs.get(node.id) !== "audio") continue
    const data = (node.data ?? {}) as Record<string, unknown>
    const own = overrides?.[node.id]
    const link = own && "youtubeUrl" in own ? text(own.youtubeUrl) : text(data.youtubeUrl)
    if (!link || !isSocialVideoUrl(link)) continue
    // The saved track stands for the saved link: nothing to fetch, nothing to confirm.
    if (link === text(data.youtubeUrl) && text(data.downloadedAudioUrl) !== "") continue
    if (!isVideoLinkRightsTicked(node.id, link)) continue
    let confirmation
    try {
      confirmation = await confirmLink(link)
    } catch (err) {
      // The text changed since the box was ticked: the person must see it and tick again.
      if (err instanceof DeclarationChangedError) untickVideoLinkRights(node.id)
      throw err
    }
    out = { ...out, [node.id]: { ...out?.[node.id], rightsConfirmationId: confirmation.id } }
  }
  return out
}
