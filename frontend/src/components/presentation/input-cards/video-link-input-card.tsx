import { useCallback, useEffect, useId, useMemo } from "react"
import { X } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useT } from "@/lib/i18n"
import { downloadYouTubeAudio } from "@/lib/api"
import { DeclarationChangedError, confirmLink } from "@/lib/content-rights"
import { VIDEO_LINK_INGEST_DEBOUNCE_MS } from "@/lib/video-link-ingest-timing"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import { NODE_DEF_MAP, type WorkflowEdge, type WorkflowNode } from "@/types/nodes"
import { classifyDownloadFailure, deriveVideoLinkView } from "@/lib/video-link"
import { classifyVideoLinkInput, videoLinkInputNeed, videoLinkInputNeedsTick, videoLinkInputValues } from "@/lib/video-link-input"
import { videoLinkLengthLimit } from "@/lib/video-link-length-limits"
import { tickVideoLinkRights, untickVideoLinkRights, useVideoLinkRightsTicked } from "@/lib/video-link-rights"
import { RightsDeclarationBox } from "@/components/content-rights/rights-declaration-box"
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
 * A published app's Video URL input: paste a link to where the video is, or
 * any other web link to one. A post link a node after it WATCHES is downloaded
 * here, by the runner, before Run, under the rules the Video URL node follows
 * on the canvas (a long video from a site whose length is read first asks for
 * a part); the run is sent the link plus the file made from it. A post link
 * read only for its sound (Transcribe, Suno Cover) or its page address is not
 * downloaded here at all: the server fetches what is needed when the run
 * starts (MCP, SDK and API runs get the same), so Run never waits on a video
 * nobody watches.
 *
 * Every import of the link is made under the content rights box, ticked by
 * the runner for THIS link in this session (`lib/video-link-rights.ts`; a
 * changed link is another box): a download here confirms as it goes, one
 * confirmation per download; a link whose sound the run fetches is confirmed
 * when Run is pressed, for that run alone. Nothing of the box is ever written
 * to the run's inputs.
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
  // The box: ticked for one link, in this session (a changed link is unticked by construction).
  const confirmed = useVideoLinkRightsTicked(nodeId, socialLink)
  // A link the run imports — its video here, or its sound on the server — needs the box
  // while the import is still to be made.
  const needsTick = !readOnly && videoLinkInputNeedsTick(values, need)

  // A fresh confirmation for one download of the link: a changed declaration unticks the box.
  const confirm = useCallback(
    async (link: string) => {
      try {
        return (await confirmLink(link)).id
      } catch (err) {
        if (err instanceof DeclarationChangedError) untickVideoLinkRights(nodeId)
        throw err
      }
    },
    [nodeId],
  )

  // A post link still without its file: the only thing the card downloads — and
  // only where a node after it watches the video, once the box is ticked.
  const needsFile = socialLink !== "" && need === "file" && deriveVideoLinkView({ ...values, youtubeUrl: socialLink }).kind !== "ready"
  const download = useVideoLinkDownload({
    link: needsFile && confirmed ? socialLink : "",
    disabled: readOnly,
    onCompleted: (file, link) => write({ downloadedVideoUrl: file.videoUrl, downloadedFromUrl: link }),
    confirm,
  })

  // The canvas preview writes to the node, and on the canvas a run whose only readers take the
  // sound skips the video and reads the node's own audio track — so there the card fetches it
  // (what the node's own link field does), under the box. The runner's page does not: the
  // server fetches the sound when the run starts, under the confirmation Run records then.
  const hasTrack = typeof values.downloadedAudioUrl === "string" && values.downloadedAudioUrl.trim() !== ""
  const audioLink = !isFullscreen && !readOnly && need === "audio" && socialLink !== "" && !hasTrack && confirmed ? socialLink : ""
  useEffect(() => {
    if (audioLink === "") return
    let current = true
    const timer = setTimeout(() => {
      write({ audioDownloadStatus: "downloading", audioDownloadError: "" })
      confirmLink(audioLink)
        .then((confirmation) => downloadYouTubeAudio(audioLink, { confirmationId: confirmation.id }))
        .then(
          (result) => {
            if (current) write({ downloadedAudioUrl: result.url, audioDownloadStatus: "completed" })
          },
          (err: unknown) => {
            // The failure is written BEFORE a changed declaration unticks the box: the untick ends this effect.
            if (current) write({ audioDownloadStatus: "failed", audioDownloadError: classifyDownloadFailure(err).raw || "Audio download failed" })
            if (err instanceof DeclarationChangedError) untickVideoLinkRights(nodeId)
          },
        )
    }, VIDEO_LINK_INGEST_DEBOUNCE_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [audioLink, write, nodeId])

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
      {needsTick && (
        <div className="mt-2">
          <RightsDeclarationBox
            checked={confirmed}
            disabled={download.state.status === "downloading" || download.state.status === "checking"}
            onCheckedChange={(checked) => {
              if (checked) tickVideoLinkRights(nodeId, socialLink)
              else untickVideoLinkRights(nodeId)
            }}
          />
        </div>
      )}
      <div className="mt-2">
        <VideoLinkRunnerStatus view={view} limit={limit} rawError={download.state.raw} locked={needsTick && !confirmed} onDownload={download.start} />
      </div>
    </>
  )
  return compact ? <div className="flex flex-col">{body}</div> : <GlassCard>{body}</GlassCard>
}
