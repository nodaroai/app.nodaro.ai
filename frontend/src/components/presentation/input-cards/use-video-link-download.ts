import { useCallback, useEffect, useRef, useState } from "react"
import { VIDEO_LINK_INGEST_DEBOUNCE_MS } from "@/lib/video-link-ingest-timing"
import {
  downloadVideoLink,
  type LinkDownloadEvent,
  type VideoLinkDownloadRequest,
} from "@/lib/video-link-download"
import type { DownloadErrorCode } from "@/lib/video-link"

export interface LinkDownloadState {
  readonly status: "idle" | "checking" | "downloading" | "failed"
  readonly percent: number
  readonly phase: "downloading" | "processing" | "uploading"
  readonly code?: DownloadErrorCode
  readonly raw?: string
  /** A long YouTube video waiting for the person to pick a part (or all of it). */
  readonly choose?: { readonly durationSec: number | null }
}

const IDLE: LinkDownloadState = { status: "idle", percent: 0, phase: "downloading" }

export interface UseVideoLinkDownloadOptions {
  /** The post link that still needs a file, or "" when nothing needs fetching. */
  readonly link: string
  /** The file arrived for `link` — only ever called while `link` is still current. */
  readonly onCompleted: (file: { readonly videoUrl: string; readonly thumbnailUrl?: string }, link: string) => void
  /** A canvas or page that takes no writes: nothing starts. */
  readonly disabled?: boolean
}

/**
 * The runner card's download of one post link. A new link cancels the one in
 * flight and — once the typing stops — fetches itself from `auto`; a mount
 * never starts a download (the link is only ever typed in this session), and
 * an answer that lands after the link changed is dropped, because the file it
 * carries belongs to the old link.
 */
export function useVideoLinkDownload({ link, onCompleted, disabled }: UseVideoLinkDownloadOptions) {
  const [state, setState] = useState<LinkDownloadState>(IDLE)
  const controllerRef = useRef<AbortController | null>(null)
  const linkRef = useRef(link)
  const completedRef = useRef(onCompleted)
  linkRef.current = link
  completedRef.current = onCompleted

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  const start = useCallback(
    (request: VideoLinkDownloadRequest = { mode: "auto" }) => {
      const target = linkRef.current
      if (!target || disabled) return
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      setState({ ...IDLE, status: "downloading" })

      const onEvent = (event: LinkDownloadEvent) => {
        if (controller.signal.aborted) return
        setState((prev) =>
          event.kind === "checking"
            ? { ...prev, status: "checking" }
            : { ...prev, status: "downloading", percent: event.percent, phase: event.phase },
        )
      }
      void downloadVideoLink(target, request, { onEvent, signal: controller.signal }).then((outcome) => {
        // Superseded: another start, a new link, or an unmount took over.
        if (controller.signal.aborted || controllerRef.current !== controller || linkRef.current !== target) return
        controllerRef.current = null
        if (outcome.status === "completed") {
          setState(IDLE)
          completedRef.current({ videoUrl: outcome.videoUrl, thumbnailUrl: outcome.thumbnailUrl }, target)
        } else if (outcome.status === "needs-choice") {
          setState({ ...IDLE, choose: { durationSec: outcome.durationSec } })
        } else if (outcome.status === "failed") {
          setState({ ...IDLE, status: "failed", code: outcome.code, raw: outcome.raw })
        }
      })
    },
    [disabled],
  )

  // A new link starts from the top; the pause keeps a typed link from being a
  // download per keystroke.
  useEffect(() => {
    cancel()
    setState(IDLE)
    if (link === "" || disabled) return
    const timer = setTimeout(() => start({ mode: "auto" }), VIDEO_LINK_INGEST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [link, disabled, cancel, start])

  useEffect(() => cancel, [cancel])

  return { state, start, cancel }
}
