/**
 * The gate every Run path passes through before it starts: a Video URL node
 * that feeds the run and still holds only a LINK is downloaded first.
 *
 * It exists because of where runs execute. Execute-All, Run-from-here and
 * Run-selected all run on the SERVER, from the saved workflow — and there a
 * Video URL node is a source node that is read, never executed. Whatever sits
 * in its data is what the downstream node receives; a YouTube / TikTok /
 * Instagram page address is not a video file, and every video node fails on it
 * (mid-run, after credits were reserved). So the file has to exist BEFORE the
 * save-and-run, and this is the one place that guarantees it for all four
 * handlers.
 */
import { toast } from "sonner"
import { videoLinkNeedsDownload, videoLinkRunNeeds } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { tx } from "@/lib/i18n"
import { localizeNodeLabel } from "@/lib/i18n/labels"
import { useLocaleStore } from "@/lib/locale-store"
import { FOCUS_NODES_EVENT, type FocusNodesDetail } from "@/lib/canvas-focus-event"
import { DOWNLOAD_ERROR_KEYS, formatTimecode } from "@/lib/video-link"
import { ensureVideoLinksDownloaded } from "@/lib/video-link-ingest"
import { videoLinkLengthLimit } from "@/lib/video-link-length-limits"
import { NODE_DEF_MAP, type WorkflowEdge, type WorkflowNode } from "@/types/nodes"

/**
 * The Video URL nodes whose FILE this run needs:
 *
 *  - upstream of a node that is about to run, at any depth — a link that feeds
 *    nothing in the run is left alone, so a long video parked on the canvas
 *    never blocks an unrelated Run with "choose a part";
 *  - read by at least one consumer IN the run that actually looks at the video.
 *    Transcribe and Suno Cover take the node's separately-fetched audio track,
 *    and Dubbing hands the page link to its provider — a "podcast → Transcribe"
 *    run must not be made to download (or pick a part of) an hour of video;
 *  - with no file for their current link.
 *
 * Skipped nodes are not part of the run and pull nothing in.
 */
export function videoLinkNodesFeeding(
  scopeIds: readonly string[],
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): string[] {
  // One reading of the graph, shared with the app runner's card and the server's
  // pre-run fetch (`videoLinkRunNeeds`): which links feed the run, and what each
  // needs. The editor downloads the FILE; a link read only for its sound or its
  // page address was fetched (or needs nothing) when it was pasted.
  const needs = videoLinkRunNeeds(scopeIds, nodes, edges)
  return nodes
    .filter(
      (n) =>
        n.type === "youtube-video" &&
        videoLinkNeedsDownload(n.data as Record<string, unknown>) &&
        needs.get(n.id) === "file",
    )
    .map((n) => n.id)
}

/**
 * Resolves true when the run may proceed. When a download is needed it holds
 * the Run button (`setIsRunning`) for its length and hands it back before
 * returning, so the caller's own optimistic flip stays the single owner of the
 * running state. On false the reason has already been shown — except a Cancel,
 * which needs no explaining.
 *
 * The wait can always be left: a download has no upper bound the editor
 * controls, and a Run button held with no way out is worse than the wait.
 * Cancel abandons the WAIT only; the download carries on and the node shows it.
 */
export async function ensureVideoLinksBeforeRun(
  scopeIds: readonly string[],
  setIsRunning: (running: boolean) => void,
): Promise<boolean> {
  const { nodes, edges } = useWorkflowStore.getState()
  const needed = videoLinkNodesFeeding(scopeIds, nodes, edges)
  if (needed.length === 0) return true

  setIsRunning(true)
  const waiting = new AbortController()
  const toastId = toast.loading(tx("run.videoLinkDownloading"), {
    action: { label: tx("common.cancel"), onClick: () => waiting.abort() },
  })
  try {
    const result = await ensureVideoLinksDownloaded(needed, { signal: waiting.signal })
    if (result.ok) return true
    if (result.reason === "cancelled") return false
    if (result.reason === "choose") {
      showChoosePartMessage(result.nodeId, result.label)
      return false
    }
    const headline =
      result.reason === "failed"
        ? tx("run.videoLinkFailed", { label: result.label })
        : tx("run.videoLinkChanged", { label: result.label })
    toast.error(headline, result.code ? { description: tx(DOWNLOAD_ERROR_KEYS[result.code]) } : {})
    return false
  } catch {
    toast.error(tx("run.failedToStartExecution"))
    return false
  } finally {
    toast.dismiss(toastId)
    setIsRunning(false)
  }
}

/** How long the "choose a part" message stays up: it carries a button to press. */
export const CHOOSE_PART_TOAST_MS = 20_000

/**
 * The text of the message shown when a run stops for a long video: how long
 * it is, where to choose the part (the node's From / To), and how long a part
 * the nodes after it can read — never a bare "choose which part".
 */
export function choosePartMessage(
  nodeId: string,
  label: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): { title: string; description?: string } {
  const node = nodes.find((n) => n.id === nodeId)
  const length = (node?.data as { videoDurationSec?: unknown } | undefined)?.videoDurationSec
  const durationSec = typeof length === "number" && length > 0 ? length : null
  const limit = videoLinkLengthLimit(nodeId, nodes, edges)
  const consumer = limit
    ? localizeNodeLabel(NODE_DEF_MAP.get(limit.consumerType)?.label ?? limit.consumerType, useLocaleStore.getState().locale)
    : ""
  const description = limit
    ? tx("run.videoLinkCheapestPart", { consumer, cheapest: formatTimecode(limit.cheapestSec) })
    : undefined
  if (durationSec === null) return { title: tx("run.videoLinkChoose", { label }), description }
  const duration = formatTimecode(durationSec)
  if (limit && durationSec > limit.maxSec) {
    return {
      title: tx("run.videoLinkChooseTooLong", { label, duration, consumer, max: formatTimecode(limit.maxSec) }),
      description,
    }
  }
  return { title: tx("run.videoLinkChooseLong", { label, duration }), description }
}

/** The message, with a button that selects the node, frames it and opens its
 *  settings — where the part chooser is (the canvas focus signal). */
function showChoosePartMessage(nodeId: string, label: string): void {
  const { nodes, edges } = useWorkflowStore.getState()
  const { title, description } = choosePartMessage(nodeId, label, nodes, edges)
  toast.error(title, {
    ...(description ? { description } : {}),
    duration: CHOOSE_PART_TOAST_MS,
    action: {
      label: tx("common.show"),
      onClick: () => {
        const detail: FocusNodesDetail = { nodeIds: [nodeId] }
        window.dispatchEvent(new CustomEvent(FOCUS_NODES_EVENT, { detail }))
      },
    },
  })
}
