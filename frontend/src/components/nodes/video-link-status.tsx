"use client"

/**
 * The download block of the Video URL node — shared by the card on the canvas
 * and the settings panel, so the two cannot disagree about what a node is
 * doing. It only RENDERS `deriveVideoLinkView(data)` and forwards clicks to the
 * module-level controller (`lib/video-link-ingest.ts`); it owns no download.
 */
import { useEffect, useId, useState, type ReactNode } from "react"
import { AlertCircle, CheckCircle2, Download, Loader2 } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { useT } from "@/lib/i18n"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { videoLinkLengthLimit } from "@/lib/video-link-length-limits"
import { NODE_DEF_MAP } from "@/types/nodes"
import {
  DOWNLOAD_ERROR_KEYS,
  deriveVideoLinkView,
  detectVideoLinkPlatform,
  formatTimecode,
  validateRange,
  type DownloadPhase,
} from "@/lib/video-link"
import { ingestVideoLink, resumeVideoLinkIngest, retryVideoLinkIngest } from "@/lib/video-link-ingest"
import type { YouTubeVideoData } from "@/types/nodes"

type Variant = "card" | "panel"

/** The card wears the input-node cyan; the panel wears the app's accent. */
const TONE: Record<Variant, { text: string; accent: string; accentText: string; bar: string; input: string }> = {
  card: {
    text: "text-[10px]",
    accent: "bg-[#38BDF8] hover:bg-[#38BDF8]/90",
    accentText: "text-[#38BDF8]",
    bar: "bg-[#38BDF8]",
    input: "focus:border-[#38BDF8]",
  },
  panel: {
    text: "text-xs",
    accent: "bg-[#ff0073] hover:bg-[#ff0073]/90",
    accentText: "text-[#ff0073]",
    bar: "bg-[#ff0073]",
    input: "focus:border-[#ff0073]",
  },
}

/** Keep pointer and key events inside the card — the canvas would drag the node
 *  or fire a shortcut on them. Harmless in the panel. */
const CONTAINED = {
  onMouseDown: (e: { stopPropagation(): void }) => e.stopPropagation(),
  onKeyDown: (e: { stopPropagation(): void }) => e.stopPropagation(),
}

/** `downloadedSection` as stored — by whoever wrote the workflow, so checked. */
function readSection(value: unknown): { startSec: number; endSec: number } | null {
  if (typeof value !== "object" || value === null) return null
  const { startSec, endSec } = value as { startSec?: unknown; endSec?: unknown }
  return typeof startSec === "number" && typeof endSec === "number" ? { startSec, endSec } : null
}

function PrimaryButton({ variant, onClick, children }: { variant: Variant; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`nodrag w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-white text-xs font-medium transition-colors ${TONE[variant].accent}`}
      onMouseDown={CONTAINED.onMouseDown}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {children}
    </button>
  )
}

function SecondaryButton({ onClick, children }: { onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="nodrag w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-muted-foreground/25 hover:bg-muted/40 text-xs font-medium transition-colors"
      onMouseDown={CONTAINED.onMouseDown}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {children}
    </button>
  )
}

/** The length limit of the nodes this Video URL feeds, as the chooser shows it. */
interface ChooserLimit {
  readonly maxSec: number
  readonly cheapestSec: number
  /** The limiting node type's name, in the interface language. */
  readonly consumer: string
}

/** The strictest length limit among the nodes this one feeds, or null. */
function useChooserLimit(nodeId: string): ChooserLimit | null {
  const localizeNodeLabel = useLocalizeNodeLabel()
  const limit = useWorkflowStore(
    useShallow((s) => {
      const found = videoLinkLengthLimit(nodeId, s.nodes ?? [], s.edges ?? [])
      return found ? { maxSec: found.maxSec, cheapestSec: found.cheapestSec, consumerType: found.consumerType } : null
    }),
  )
  if (!limit) return null
  const consumer = localizeNodeLabel(NODE_DEF_MAP.get(limit.consumerType)?.label ?? limit.consumerType)
  return { maxSec: limit.maxSec, cheapestSec: limit.cheapestSec, consumer }
}

function RangeChooser({
  nodeId,
  variant,
  durationSec,
  force,
  onCancel,
  onStarted,
}: {
  nodeId: string
  variant: Variant
  durationSec: number | null
  /** A file is already stored — replace it. */
  force: boolean
  onCancel?: () => void
  onStarted(): void
}) {
  const t = useT()
  const tone = TONE[variant]
  const fieldId = useId()
  const limit = useChooserLimit(nodeId)
  const [fromText, setFromText] = useState("0:00")
  // Start on the part that costs the least downstream (a minute when nothing
  // limits it), never past the video's end.
  const [toText, setToText] = useState(() => {
    const preferred = limit?.cheapestSec ?? 60
    return formatTimecode(durationSec === null ? preferred : Math.min(durationSec, preferred))
  })
  const [problem, setProblem] = useState<"format" | "order" | "beyond" | "tooLong" | null>(null)
  // The whole video is offered only when the nodes after it can read all of it.
  const wholeFits = limit === null || (durationSec !== null && durationSec <= limit.maxSec)

  const downloadPart = () => {
    const range = validateRange(fromText, toText, durationSec, limit?.maxSec)
    if (!range.ok) {
      setProblem(range.reason)
      return
    }
    setProblem(null)
    void ingestVideoLink(nodeId, { mode: "section", section: { startSec: range.startSec, endSec: range.endSec }, force })
    onStarted()
  }

  const downloadWhole = () => {
    void ingestVideoLink(nodeId, { mode: "whole", force })
    onStarted()
  }

  const field = (id: string, label: string, value: string, onChange: (v: string) => void) => (
    <label htmlFor={id} className={`flex items-center gap-1.5 ${tone.text} text-muted-foreground`}>
      <span className="shrink-0">{label}</span>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          e.stopPropagation()
          setProblem(null)
          onChange(e.target.value)
        }}
        {...CONTAINED}
        className={`nodrag w-full min-w-0 bg-transparent border-b border-muted-foreground/25 py-0.5 text-xs text-foreground font-mono outline-none transition-colors ${tone.input}`}
      />
    </label>
  )

  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/30 p-2.5">
      <p className={`${tone.text} text-muted-foreground`}>
        {durationSec === null
          ? t("videolink.unknownLength")
          : t("videolink.longVideo", { duration: formatTimecode(durationSec) })}
      </p>
      {limit && (
        <p className={`${tone.text} text-foreground`}>
          {t("videolink.limit", {
            consumer: limit.consumer,
            max: formatTimecode(limit.maxSec),
            cheapest: formatTimecode(limit.cheapestSec),
          })}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        {field(`${fieldId}-from`, t("videolink.from"), fromText, setFromText)}
        {field(`${fieldId}-to`, t("videolink.to"), toText, setToText)}
      </div>
      {problem && (
        <p role="alert" className={`${tone.text} text-red-500`}>
          {problem === "format"
            ? t("videolink.rangeFormat")
            : problem === "order"
              ? t("videolink.rangeOrder")
              : problem === "tooLong" && limit
                ? t("videolink.rangeTooLong", { consumer: limit.consumer, max: formatTimecode(limit.maxSec) })
                : t("videolink.rangeBeyond", { duration: formatTimecode(durationSec ?? 0) })}
        </p>
      )}
      <PrimaryButton variant={variant} onClick={downloadPart}>
        <Download className="w-3.5 h-3.5" />
        {t("videolink.downloadPart")}
      </PrimaryButton>
      {wholeFits && <SecondaryButton onClick={downloadWhole}>{t("videolink.downloadWhole")}</SecondaryButton>}
      {onCancel && <SecondaryButton onClick={onCancel}>{t("videolink.cancel")}</SecondaryButton>}
      <p className="text-[10px] text-muted-foreground/70">{t("videolink.partNote")}</p>
    </div>
  )
}

export function VideoLinkStatus({
  nodeId,
  data,
  variant,
}: {
  readonly nodeId: string
  readonly data: YouTubeVideoData
  readonly variant: Variant
}) {
  const t = useT()
  const tone = TONE[variant]
  const view = deriveVideoLinkView(data)
  // "Download a different part" reopens the chooser over a node that is ready.
  const [choosingAgain, setChoosingAgain] = useState(false)

  // A canvas that takes no writes can never settle a download state — nothing
  // the controller does would land. Show what IS (a file, a failure), never a
  // spinner that cannot end or a button that cannot work.
  const readOnly = useWorkflowStore((s) => s.isReadOnly) === true

  // A saved "downloading"/"checking" with nothing following it in this tab is a
  // download that lost its reader (a reload) — re-attach to it, or settle the
  // node. Idempotent, and it never starts a download. The link and the id are
  // deps on purpose: either can change under a node that STAYS in flight (an
  // edit from outside the editor), and that is exactly when it must re-check.
  const inFlight = view.kind === "downloading" || view.kind === "checking"
  useEffect(() => {
    if (inFlight && !readOnly) resumeVideoLinkIngest(nodeId)
  }, [inFlight, readOnly, nodeId, data.youtubeUrl, data.downloadId])

  // A new link starts from the top, never inside the previous link's chooser.
  useEffect(() => {
    setChoosingAgain(false)
  }, [data.youtubeUrl])

  if (view.kind === "empty" || view.kind === "passthrough") return null

  if (readOnly && view.kind !== "ready" && view.kind !== "failed") {
    return <p className={`${tone.text} text-orange-400`}>{t("node.notDownloaded")}</p>
  }

  if (view.kind === "checking") {
    return (
      <div className={`flex items-center gap-2 ${tone.text} text-muted-foreground`}>
        <Loader2 className={`w-3.5 h-3.5 animate-spin ${tone.accentText}`} />
        <span>{t("videolink.checking")}</span>
      </div>
    )
  }

  if (view.kind === "downloading") {
    const phaseLabel: Record<DownloadPhase, string> = {
      downloading: t("inputcfg.downloadingVideo"),
      processing: t("credits.processing"),
      uploading: t("inputcfg.uploading"),
    }
    return (
      <div className="flex flex-col gap-1.5 rounded-md bg-muted/30 p-2">
        <div className={`flex items-center gap-2 ${tone.text} text-muted-foreground`}>
          <Loader2 className={`w-3.5 h-3.5 animate-spin ${tone.accentText}`} />
          <span>{phaseLabel[view.phase]}</span>
          <span className={`ms-auto font-mono ${tone.accentText}`}>{view.percent}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.percent}
          className="w-full h-1.5 rounded-full bg-muted-foreground/20 overflow-hidden"
        >
          <div className={`h-full rounded-full transition-all duration-300 ease-out ${tone.bar}`} style={{ width: `${view.percent}%` }} />
        </div>
      </div>
    )
  }

  if (view.kind === "failed") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className={`flex items-start gap-1.5 p-2 rounded-md bg-red-500/10 text-red-500 ${tone.text}`}>
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <p title={typeof data.downloadError === "string" && data.downloadError ? data.downloadError : undefined}>
            {t(DOWNLOAD_ERROR_KEYS[view.code])}
          </p>
        </div>
        {!readOnly && (
          <PrimaryButton variant={variant} onClick={() => void retryVideoLinkIngest(nodeId)}>
            <Download className="w-3.5 h-3.5" />
            {t("inputcfg.retryDownload")}
          </PrimaryButton>
        )}
        {!readOnly && view.canRetrySilent && (
          <SecondaryButton onClick={() => void retryVideoLinkIngest(nodeId, { allowSilent: true })}>
            {t("videolink.downloadSilent")}
          </SecondaryButton>
        )}
      </div>
    )
  }

  if (view.kind === "choose" || (view.kind === "ready" && choosingAgain)) {
    const durationSec =
      view.kind === "choose"
        ? view.durationSec
        : typeof data.videoDurationSec === "number" ? data.videoDurationSec : null
    return (
      <RangeChooser
        nodeId={nodeId}
        variant={variant}
        durationSec={durationSec}
        force={view.kind === "ready"}
        onCancel={view.kind === "ready" ? () => setChoosingAgain(false) : undefined}
        onStarted={() => setChoosingAgain(false)}
      />
    )
  }

  if (view.kind === "ready") {
    const section = readSection(data.downloadedSection)
    const link = typeof data.youtubeUrl === "string" ? data.youtubeUrl.trim() : ""
    const canCut = !readOnly && detectVideoLinkPlatform(link) === "youtube"
    return (
      <div className="flex flex-col gap-1.5">
        <div className={`flex items-center gap-2 p-2 rounded-md bg-green-500/10 text-green-500 ${tone.text}`}>
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>
            {section
              ? t("videolink.partReady", { from: formatTimecode(section.startSec), to: formatTimecode(section.endSec) })
              : t("inputcfg.downloadedAndReady")}
          </span>
        </div>
        {canCut && variant === "panel" && (
          <SecondaryButton onClick={() => setChoosingAgain(true)}>{t("videolink.choosePart")}</SecondaryButton>
        )}
      </div>
    )
  }

  // idle — a link nobody has fetched: a node saved before downloads existed, or
  // one an agent wrote. Run fetches it too; this is the button for "now".
  return (
    <div className="flex flex-col gap-1.5">
      <p className={`${tone.text} text-orange-400`}>{t("node.notDownloaded")}</p>
      <PrimaryButton variant={variant} onClick={() => void ingestVideoLink(nodeId, { mode: "auto" })}>
        <Download className="w-3.5 h-3.5" />
        {t("inputcfg.downloadVideo")}
      </PrimaryButton>
    </div>
  )
}
