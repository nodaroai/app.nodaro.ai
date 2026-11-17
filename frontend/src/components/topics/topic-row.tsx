"use client"

import { useId } from "react"
import { AlertTriangle, Loader2, Pencil, Radar, Trash2 } from "lucide-react"
import { TOPIC_SCAN_PAGE_CREDIT_ID, type TrackedTopic } from "@nodaro/shared/social"
import { Button } from "@/components/ui/button"
import { CreditCost } from "@/components/ui/credit-cost"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useScanPagesPrice } from "@/components/competitors/scan-price"
import { SCHEDULE_LABEL } from "@/components/competitors/schedule-label"
import { SOCIAL_PLATFORM_META } from "@/components/research/social-platforms"
import { useT } from "@/lib/i18n"
import { formatDate } from "@/lib/i18n/format"

export interface TopicActions {
  /** A scan or an edit of this topic is on its way. */
  readonly isBusy: (topic: TrackedTopic) => boolean
  /** Why the plan does not let this topic scan now; null when it does. */
  readonly scanBlockedWhy: (topic: TrackedTopic) => string | null
  readonly onOpen: (topic: TrackedTopic) => void
  readonly onScan: (topic: TrackedTopic) => void
  readonly onEdit: (topic: TrackedTopic) => void
  readonly onRemove: (topic: TrackedTopic) => void
}

/** When the topic's posts are from, that it is scanning, or that it has none yet. */
export function topicScanLine(topic: TrackedTopic, t: ReturnType<typeof useT>): string {
  if (topic.scanning) return t("competitors.scanning")
  if (!topic.lastScanAt) return t("topics.neverScanned")
  return t("competitors.lastScan", { date: formatDate(Date.parse(topic.lastScanAt), { month: "short", day: "numeric" }) })
}

/**
 * A topic's scan now, with the price the scan is charged; disabled, with the
 * reason beside it, when the plan does not let this topic scan.
 */
export function TopicScanButton({
  topic,
  busy,
  blockedWhy,
  onScan,
  describedBy,
}: {
  readonly topic: TrackedTopic
  readonly busy: boolean
  readonly blockedWhy: string | null
  readonly onScan: () => void
  /** The id of what names the topic, for a screen reader. */
  readonly describedBy?: string
}) {
  const t = useT()
  const reasonId = useId()
  const credits = useScanPagesPrice(TOPIC_SCAN_PAGE_CREDIT_ID, topic.pages)
  const described = [describedBy, blockedWhy ? reasonId : undefined].filter(Boolean).join(" ") || undefined
  return (
    <span className="flex flex-col items-end gap-0.5">
      <Button size="sm" variant="outline" onClick={onScan} disabled={busy || topic.scanning || topic.pages === 0 || blockedWhy !== null} aria-describedby={described}>
        {topic.scanning ? <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" /> : <Radar className="me-1 h-3.5 w-3.5" />}
        {topic.scanning ? t("competitors.scanning") : t("competitors.scanNow")}
        {!topic.scanning && <CreditCost credits={credits} prefix=" · " className="ms-0.5 opacity-80" />}
      </Button>
      {blockedWhy && (
        <span id={reasonId} className="text-[11px] text-muted-foreground">
          {blockedWhy}
        </span>
      )}
    </span>
  )
}

/** The platforms a topic is searched on, as icons (one this page cannot draw is left out). */
function PlatformIcons({ topic }: { readonly topic: TrackedTopic }) {
  return (
    <span className="flex items-center gap-1">
      {topic.platforms.flatMap((p) => {
        const meta = p in SOCIAL_PLATFORM_META ? SOCIAL_PLATFORM_META[p] : undefined
        if (!meta) return []
        return [
          <span key={p} title={meta.name} className="flex h-5 w-5 items-center justify-center rounded bg-muted">
            {meta.icon("h-3 w-3")}
            <span className="sr-only">{meta.name}</span>
          </span>,
        ]
      })}
    </span>
  )
}

/** The problem the server named with the last scan, a press away. */
function LastScanProblem({ topic, nameId }: { readonly topic: TrackedTopic; readonly nameId: string }) {
  const t = useT()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="flex items-center gap-1 font-semibold text-amber-700 hover:underline dark:text-amber-400" aria-describedby={nameId}>
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
          {t("competitors.lastScanFailed")}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-[12.5px]">
        <p dir="auto">{topic.lastScanError}</p>
      </PopoverContent>
    </Popover>
  )
}

/** A topic's name, its term when it differs, and what is searched, how deep and how often. */
function TopicSummary({ topic, nameId, onOpen }: { readonly topic: TrackedTopic; readonly nameId: string; readonly onOpen: () => void }) {
  const t = useT()
  return (
    <div className="flex min-w-0 flex-1 basis-[240px] flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button type="button" onClick={onOpen} className="truncate text-start text-[15px] font-semibold hover:underline" dir="auto" aria-label={t("topics.openTopic", { name: topic.name })}>
          {topic.name}
        </button>
        <span id={nameId} hidden>
          {topic.name}
        </span>
        {topic.term !== topic.name && (
          <span dir="auto" className="truncate rounded-full bg-muted px-2 py-0.5 text-[12px] font-semibold text-foreground/80">
            {topic.term}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted-foreground">
        <PlatformIcons topic={topic} />
        <span>{t("topics.postsPerSearch", { n: topic.postCount })}</span>
        <span>{t(SCHEDULE_LABEL[topic.schedule])}</span>
        <span>{topicScanLine(topic, t)}</span>
        {topic.lastScanError && <LastScanProblem topic={topic} nameId={nameId} />}
      </div>
    </div>
  )
}

/** One followed topic: what it is and searches, its last scan, and its actions. */
export function TopicRow({ topic, actions }: { readonly topic: TrackedTopic; readonly actions: TopicActions }) {
  const t = useT()
  const nameId = `topic-name-${topic.id}`
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-3">
      <TopicSummary topic={topic} nameId={nameId} onOpen={() => actions.onOpen(topic)} />
      <div className="flex shrink-0 flex-wrap items-start gap-1.5">
        <TopicScanButton topic={topic} busy={actions.isBusy(topic)} blockedWhy={actions.scanBlockedWhy(topic)} onScan={() => actions.onScan(topic)} describedBy={nameId} />
        <Button size="sm" variant="ghost" onClick={() => actions.onEdit(topic)} aria-describedby={nameId}>
          <Pencil className="me-1 h-3.5 w-3.5" />
          {t("competitors.edit")}
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => actions.onRemove(topic)} aria-describedby={nameId}>
          <Trash2 className="me-1 h-3.5 w-3.5" />
          {t("competitors.remove")}
        </Button>
      </div>
    </li>
  )
}
