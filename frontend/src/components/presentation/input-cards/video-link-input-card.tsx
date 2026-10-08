import { useCallback, useEffect, useId, useMemo } from "react"
import { X } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useT } from "@/lib/i18n"
import { downloadYouTubeAudio } from "@/lib/api"
import { VIDEO_LINK_INGEST_DEBOUNCE_MS } from "@/lib/video-link-ingest-timing"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import { NODE_DEF_MAP, type WorkflowEdge, type WorkflowNode } from "@/types/nodes"
import { deriveVideoLinkView } from "@/lib/video-link"
import { classifyVideoLinkInput, videoLinkInputNeed, videoLinkInputValues } from "@/lib/video-link-input"
import { videoLinkLengthLimit } from "@/lib/video-link-length-limits"
import { GlassCard } from "../output-cards/shared"
import { useVideoLinkDownload } from "./use-video-link-download"
import { VideoLinkRunnerStatus, type ChooserLimit } from "./video-link-runner-status"

interface VideoLinkInputCardProps {
  readonly nodeId: string
  readonly label: string
  readonly data: Record<string, unknown>
  readonly isFullscreen: boolean
  readonly inputValues: Record<string, Record<string, unknown>>
  readonly onUpdateInput: (nodeId: string, key: string, value: unknown) => void
  readonly readOnly?: boolean
  /** The app's graph, to read the length the nodes after the link can take. */
  readonly nodes?: ReadonlyArray<{ id: string; type?: string; data: Record<string, unknown> }>
  readonly edges?: ReadonlyArray<{ source: string; target: string }>
  /** "composer" drops the heading for the chat composer. */
  readonly variant?: "composer"
}

/** The fields the card writes. A link change clears the file that belonged to the old one. */
const FILE_FIELDS = ["downloadedVideoUrl", "downloadedFromUrl"] as const
/** On the canvas the node itself also carries the audio track Transcribe / Suno Cover read; the runner's page never sends it. */
const NODE_AUDIO_FIELDS = ["downloadedAudioUrl", "audioDownloadStatus"] as const

/**
 * A published app's Video URL input: paste a link to a video (YouTube, TikTok,
 * Instagram, Facebook, X) or any other web link to one. A post link a node
 * after it WATCHES is downloaded here, by the runner, before Run, under the
 * rules the Video URL node follows on the canvas (a long YouTube video asks for
 * a part); the run is sent the link plus the file made from it. A post link
 * read only for its sound (Transcribe, Suno Cover) or its page address is not
 * downloaded here at all: the server fetches what is needed when the run starts
 * (MCP, SDK and API runs get the same), so Run never waits on a video nobody
 * watches.
 */
export function VideoLinkInputCard({ nodeId, label, data, isFullscreen, inputValues, onUpdateInput, readOnly, nodes, edges, variant }: VideoLinkInputCardProps) {
  const t = useT()
  const localizeNodeLabel = useLocalizeNodeLabel()
  const inputId = useId()
  const values = videoLinkInputValues(data, isFullscreen ? inputValues[nodeId] : undefined)
  const rawLink = typeof values.youtubeUrl === "string" ? values.youtubeUrl : ""
  const input = classifyVideoLinkInput(rawLink)

  const write = useCallback(
    (patch: Record<string, unknown>) => {
      if (readOnly) return
      if (isFullscreen) for (const [key, value] of Object.entries(patch)) onUpdateInput(nodeId, key, value)
      else useWorkflowStore.getState().updateNodeData(nodeId, patch)
    },
    [readOnly, isFullscreen, onUpdateInput, nodeId],
  )

  // The app's graph: the props when the runner passes it, else the canvas store.
  const storeNodes = useWorkflowStore(useShallow((s) => (nodes ? undefined : s.nodes)))
  const storeEdges = useWorkflowStore(useShallow((s) => (edges ? undefined : s.edges)))
  const graphNodes = nodes ?? storeNodes
  const graphEdges = edges ?? storeEdges
  // What the nodes after the link read (decided 2026-10-08, the editor's own rule):
  // the video, only its sound, or just its page address. Only the first is fetched
  // here; for the others the run fetches the sound itself, so the card neither
  // downloads a video nobody will watch nor asks the runner to pick a part of it.
  const need = videoLinkInputNeed(nodeId, graphNodes && graphEdges ? { nodes: graphNodes, edges: graphEdges } : undefined)

  const socialLink = input.kind === "social" ? input.link : ""
  // A post link still without its file: the only thing the card downloads — and
  // only where a node after it watches the video.
  const needsFile = socialLink !== "" && need === "file" && deriveVideoLinkView({ ...values, youtubeUrl: socialLink }).kind !== "ready"
  const download = useVideoLinkDownload({
    link: needsFile ? socialLink : "",
    disabled: readOnly,
    onCompleted: (file, link) => write({ downloadedVideoUrl: file.videoUrl, downloadedFromUrl: link }),
  })

  // The canvas preview writes to the node, and on the canvas a run whose only readers take the
  // sound skips the video and reads the node's own audio track — so there the card fetches it
  // (what the node's own link field does). The runner's page does not: the server fetches the
  // sound when the run starts, and the run lock admits no audio field from a request.
  const hasTrack = typeof values.downloadedAudioUrl === "string" && values.downloadedAudioUrl.trim() !== ""
  const audioLink = !isFullscreen && !readOnly && need === "audio" && socialLink !== "" && !hasTrack ? socialLink : ""
  useEffect(() => {
    if (audioLink === "") return
    let current = true
    const timer = setTimeout(() => {
      write({ audioDownloadStatus: "downloading", audioDownloadError: "" })
      downloadYouTubeAudio(audioLink).then(
        (result) => {
          if (current) write({ downloadedAudioUrl: result.url, audioDownloadStatus: "completed" })
        },
        (err: unknown) => {
          if (current) write({ audioDownloadStatus: "failed", audioDownloadError: err instanceof Error ? err.message : "Audio download failed" })
        },
      )
    }, VIDEO_LINK_INGEST_DEBOUNCE_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [audioLink, write])

  const view = deriveVideoLinkView({
    youtubeUrl: socialLink || rawLink,
    downloadedVideoUrl: values.downloadedVideoUrl,
    downloadedFromUrl: values.downloadedFromUrl,
    downloadStatus: download.state.status,
    downloadPercent: download.state.percent,
    downloadPhase: download.state.phase,
    downloadErrorCode: download.state.code,
    downloadError: download.state.raw,
    needsRangeChoice: download.state.choose !== undefined,
    videoDurationSec: download.state.choose?.durationSec ?? null,
  })

  const limit = useMemo<ChooserLimit | null>(() => {
    const found = videoLinkLengthLimit(nodeId, (graphNodes ?? []) as unknown as WorkflowNode[], (graphEdges ?? []) as unknown as WorkflowEdge[])
    if (!found) return null
    return { maxSec: found.maxSec, cheapestSec: found.cheapestSec, consumer: localizeNodeLabel(NODE_DEF_MAP.get(found.consumerType)?.label ?? found.consumerType) }
  }, [nodeId, graphNodes, graphEdges, localizeNodeLabel])

  const onLinkChange = (next: string) => {
    const link = next.trim()
    const patch: Record<string, unknown> = { youtubeUrl: link }
    // The file belonged to the old link; it never stands under a new one.
    for (const key of FILE_FIELDS) patch[key] = undefined
    if (!isFullscreen) for (const key of NODE_AUDIO_FIELDS) patch[key] = undefined
    write(patch)
  }

  const invalid = input.kind === "invalid"
  const compact = variant === "composer"
  const body = (
    <>
      {!compact && (
        <label htmlFor={inputId} className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={rawLink}
          disabled={readOnly}
          aria-label={compact ? label : undefined}
          aria-invalid={invalid}
          aria-describedby={`${inputId}-note`}
          placeholder={t("present.videoLinkPlaceholder")}
          onChange={(e) => onLinkChange(e.target.value)}
          className={`w-full bg-muted/30 border rounded-lg ps-3 pe-8 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-60 ${invalid ? "border-red-500/60 focus:border-red-500" : "border-border focus:border-[#ff0073]/50"}`}
        />
        {rawLink !== "" && !readOnly && (
          <button
            type="button"
            onClick={() => onLinkChange("")}
            aria-label={t("common.remove")}
            className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <p id={`${inputId}-note`} role={invalid ? "alert" : undefined} className={`mt-2 text-xs ${invalid ? "text-red-500" : "text-muted-foreground"}`}>
        {invalid
          ? t("present.videoLinkInvalid")
          : input.kind === "direct"
            ? t("present.videoLinkDirect")
            : input.kind === "social" && need === "audio"
              ? t("present.videoLinkAudioOnly")
              : t("present.videoLinkHint")}
      </p>
      <div className="mt-2">
        <VideoLinkRunnerStatus view={view} limit={limit} rawError={download.state.raw} onDownload={download.start} />
      </div>
    </>
  )
  return compact ? <div className="flex flex-col">{body}</div> : <GlassCard>{body}</GlassCard>
}
