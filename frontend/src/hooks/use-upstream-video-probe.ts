/**
 * Read the DURATION of a wired upstream video by loading its metadata, and cache
 * it on the node.
 *
 * Why this exists: a duration-priced node has to know how long the video is to
 * quote a price, and for a WIRED video the frontend previously had no reliable way
 * to find out. `useUpstreamVideoDuration` inspects the source node's data for a
 * duration field, which only works when that particular producer happens to store
 * one — so the video-analysis badge fell back to the `:600s` ceiling and quoted
 * 200 credits for a 30-second clip (reported 2026-07-28). The reservation is
 * computed server-side from the real length, so the number on screen was ~6x the
 * number charged.
 *
 * This asks the video itself instead of the producer's data shape. `preload =
 * "metadata"` fetches only the container header, and the result is cached on the
 * node under the SAME url-bound shape as `probedYoutube` — so it is invalidated
 * automatically when the upstream changes, and never trusted for a different url.
 *
 * The upstream url comes from `extractNodeOutput`, the single source of truth the
 * DAG itself uses, rather than a hand-kept list of url field names — which is the
 * class of bug this hook is fixing.
 *
 * The same read also yields the video's DISPLAY size (`videoWidth` /
 * `videoHeight`) — Video Overlay sizes its stage and its geometry from it — and
 * a failure marker: a load error, a probe that is still pending after
 * UPSTREAM_VIDEO_PROBE_TIMEOUT_MS, or metadata with no finite positive length
 * (Infinity for streamed MP4s and MediaRecorder WebM) writes `error: true` (the
 * last keeping any display size it did read), so a caller can tell "failed"
 * from "not read yet" — no settled probe ever looks pending. Duration callers are unaffected: they read
 * `durationSec`, which is absent then, and fall back to their ceiling exactly as
 * before. The url guard keeps a failed url from being re-probed until it changes.
 */

import { useCallback, useEffect } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import type { ProbedVideoInfo } from "@/types/nodes"

/** How long the metadata read may take before it counts as failed. */
export const UPSTREAM_VIDEO_PROBE_TIMEOUT_MS = 15_000

export type ProbedVideo = ProbedVideoInfo

export function useUpstreamVideoProbe(
  id: string,
  handleId: string,
  probed: ProbedVideoInfo | undefined,
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): number | undefined {
  const url = useWorkflowStore(
    useCallback(
      (s) => {
        const edge = s.edges.find((e) => e.target === id && e.targetHandle === handleId)
        if (!edge) return undefined
        const src = s.nodes.find((n) => n.id === edge.source)
        if (!src) return undefined
        const out = extractNodeOutput(src, edge.sourceHandle ?? undefined)
        // extractNodeOutput also yields text/JSON payloads for data handles; only a
        // real http(s) url is loadable, and anything else must not be probed.
        return typeof out === "string" && /^https?:\/\//i.test(out) ? out : undefined
      },
      [id, handleId],
    ),
  )

  useEffect(() => {
    // Already known (or already failed) for THIS url, or nothing wired — no fetch.
    if (!url || probed?.url === url) return
    let cancelled = false
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const el = document.createElement("video")
    el.preload = "metadata"
    el.muted = true
    const cleanup = () => {
      el.removeAttribute("src")
      el.load() // abort the in-flight range request rather than leaving it hanging
    }
    const finish = (value: ProbedVideoInfo) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      cleanup()
      if (!cancelled) updateNodeData(id, { probedVideo: value })
    }
    const onLoaded = () => {
      const d = el.duration
      // No finite length is a settled failure, not "still reading": without the
      // marker the url guard would freeze the node in its pending state.
      finish({
        url,
        ...(Number.isFinite(d) && d > 0 ? { durationSec: d } : { error: true as const }),
        ...(el.videoWidth > 0 && el.videoHeight > 0 ? { width: el.videoWidth, height: el.videoHeight } : {}),
      })
    }
    const onFail = () => finish({ url, error: true })
    el.addEventListener("loadedmetadata", onLoaded, { once: true })
    el.addEventListener("error", onFail, { once: true })
    timer = setTimeout(onFail, UPSTREAM_VIDEO_PROBE_TIMEOUT_MS)
    el.src = url
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
      el.removeEventListener("loadedmetadata", onLoaded)
      el.removeEventListener("error", onFail)
      if (!settled) cleanup()
    }
  }, [id, url, probed?.url, updateNodeData])

  return probed && probed.url === url ? probed.durationSec : undefined
}
