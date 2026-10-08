import { useId, useState, type ReactNode } from "react"
import { AlertCircle, CheckCircle2, Download, Loader2 } from "lucide-react"
import { useT } from "@/lib/i18n"
import {
  DOWNLOAD_ERROR_KEYS,
  formatTimecode,
  validateRange,
  type DownloadErrorCode,
  type DownloadPhase,
  type VideoLinkView,
} from "@/lib/video-link"
import type { VideoLinkDownloadRequest } from "@/lib/video-link-download"

/** The length limit of the node this link feeds, with the consumer's name in the interface language. */
export interface ChooserLimit {
  readonly maxSec: number
  readonly cheapestSec: number
  readonly consumer: string
}

function Button({ primary, onClick, children }: { primary?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        primary
          ? "w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#ff0073] hover:bg-[#ff0073]/90 text-white text-xs font-medium transition-colors"
          : "w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border hover:bg-muted/40 text-xs font-medium transition-colors"
      }
    >
      {children}
    </button>
  )
}

/** A long YouTube video: pick the part you need (From / To) or take all of it. */
function RangeChooser({
  durationSec,
  limit,
  onChoose,
}: {
  durationSec: number | null
  limit: ChooserLimit | null
  onChoose(request: VideoLinkDownloadRequest): void
}) {
  const t = useT()
  const id = useId()
  const [fromText, setFromText] = useState("0:00")
  const [toText, setToText] = useState(() => {
    const preferred = limit?.cheapestSec ?? 60
    return formatTimecode(durationSec === null ? preferred : Math.min(durationSec, preferred))
  })
  const [problem, setProblem] = useState<"format" | "order" | "beyond" | "tooLong" | null>(null)
  // The whole video is offered only when the node after it can read all of it.
  const wholeFits = limit === null || (durationSec !== null && durationSec <= limit.maxSec)

  const downloadPart = () => {
    const range = validateRange(fromText, toText, durationSec, limit?.maxSec)
    if (!range.ok) {
      setProblem(range.reason)
      return
    }
    setProblem(null)
    onChoose({ mode: "section", section: { startSec: range.startSec, endSec: range.endSec } })
  }

  const field = (suffix: string, label: string, value: string, set: (v: string) => void) => (
    <label htmlFor={`${id}-${suffix}`} className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="shrink-0">{label}</span>
      <input
        id={`${id}-${suffix}`}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          setProblem(null)
          set(e.target.value)
        }}
        className="w-full min-w-0 bg-transparent border-b border-border py-0.5 text-xs text-foreground font-mono outline-none focus:border-[#ff0073]"
      />
    </label>
  )

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">
        {durationSec === null ? t("videolink.unknownLength") : t("videolink.longVideo", { duration: formatTimecode(durationSec) })}
      </p>
      {limit && (
        <p className="text-xs text-foreground">
          {t("videolink.limit", { consumer: limit.consumer, max: formatTimecode(limit.maxSec), cheapest: formatTimecode(limit.cheapestSec) })}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        {field("from", t("videolink.from"), fromText, setFromText)}
        {field("to", t("videolink.to"), toText, setToText)}
      </div>
      {problem && (
        <p role="alert" className="text-xs text-red-500">
          {problem === "format"
            ? t("videolink.rangeFormat")
            : problem === "order"
              ? t("videolink.rangeOrder")
              : problem === "tooLong" && limit
                ? t("videolink.rangeTooLong", { consumer: limit.consumer, max: formatTimecode(limit.maxSec) })
                : t("videolink.rangeBeyond", { duration: formatTimecode(durationSec ?? 0) })}
        </p>
      )}
      <Button primary onClick={downloadPart}>
        <Download className="w-3.5 h-3.5" />
        {t("videolink.downloadPart")}
      </Button>
      {wholeFits && <Button onClick={() => onChoose({ mode: "whole" })}>{t("videolink.downloadWhole")}</Button>}
      <p className="text-[10px] text-muted-foreground/70">{t("videolink.partNote")}</p>
    </div>
  )
}

export interface VideoLinkRunnerStatusProps {
  readonly view: VideoLinkView
  readonly limit: ChooserLimit | null
  /** The server's own words for a failure — a tooltip under the friendly message. */
  readonly rawError?: string
  readonly onDownload: (request: VideoLinkDownloadRequest) => void
}

/** What the runner's Video URL card shows below the link: only a post link has a state. */
export function VideoLinkRunnerStatus({ view, limit, rawError, onDownload }: VideoLinkRunnerStatusProps) {
  const t = useT()

  switch (view.kind) {
    case "empty":
    case "passthrough":
      return null
    case "checking":
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#ff0073]" />
          <span>{t("videolink.checking")}</span>
        </div>
      )
    case "downloading": {
      const phaseLabel: Record<DownloadPhase, string> = {
        downloading: t("inputcfg.downloadingVideo"),
        processing: t("credits.processing"),
        uploading: t("inputcfg.uploading"),
      }
      return (
        <div className="flex flex-col gap-1.5 rounded-lg bg-muted/30 p-2.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#ff0073]" />
            <span>{phaseLabel[view.phase]}</span>
            <span className="ms-auto font-mono text-[#ff0073]">{view.percent}%</span>
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent} className="w-full h-1.5 rounded-full bg-muted-foreground/20 overflow-hidden">
            <div className="h-full rounded-full bg-[#ff0073] transition-all duration-300 ease-out" style={{ width: `${view.percent}%` }} />
          </div>
        </div>
      )
    }
    case "failed": {
      const code: DownloadErrorCode = view.code
      return (
        <div className="flex flex-col gap-1.5">
          <div role="alert" className="flex items-start gap-1.5 p-2.5 rounded-lg bg-red-500/10 text-red-500 text-xs">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
            <p title={rawError || undefined}>{t(DOWNLOAD_ERROR_KEYS[code])}</p>
          </div>
          <Button primary onClick={() => onDownload({ mode: "auto" })}>
            <Download className="w-3.5 h-3.5" />
            {t("inputcfg.retryDownload")}
          </Button>
          {view.canRetrySilent && <Button onClick={() => onDownload({ mode: "auto", allowSilent: true })}>{t("videolink.downloadSilent")}</Button>}
        </div>
      )
    }
    case "choose":
      return <RangeChooser durationSec={view.durationSec} limit={limit} onChoose={onDownload} />
    case "ready":
      return (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-green-500/10 text-green-500 text-xs">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{t("inputcfg.downloadedAndReady")}</span>
        </div>
      )
    case "idle":
      // A link nobody has fetched (a remount mid-download, say): Run waits for the file.
      return (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-orange-400">{t("node.notDownloaded")}</p>
          <Button primary onClick={() => onDownload({ mode: "auto" })}>
            <Download className="w-3.5 h-3.5" />
            {t("inputcfg.downloadVideo")}
          </Button>
        </div>
      )
  }
}
