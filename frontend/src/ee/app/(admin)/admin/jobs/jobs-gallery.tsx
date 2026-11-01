import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { AudioLines, Loader2, Music, Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLazyMount } from "@/components/audio-player/use-lazy-mount"
import { useAdminJobsInfinite, type AdminJob } from "@/ee/hooks/queries/use-admin-queries"
import { jobPlatform } from "@/lib/job-platform"
import { ago, buildGroups, tileMedia, type GItem } from "./jobs-gallery-grouping"
import { creditTileLabel } from "./admin-job-credits"
import { jobKindOf, rowJobType } from "./job-kinds"
import { claimPlayer, releasePlayer, type PlayerSlot } from "./tile-players"
import type { AdminJobFilters } from "./jobs-filters"
import { FiltersUnavailableNotice } from "./jobs-filter-bar"

const STATUS_TAG: Record<string, string> = {
  failed: "bg-red-500 text-white",
  processing: "bg-amber-500 text-black",
  queued: "bg-sky-500 text-white",
  pending: "bg-sky-500 text-white",
  cancelled: "bg-muted text-muted-foreground",
}

const STRIPES = { backgroundImage: "repeating-linear-gradient(135deg, rgba(127,127,127,0.10) 0 6px, transparent 6px 12px)" }

/** Stops an element and gives up the shared player slot when its tile unmounts
 *  (a filter change or regroup can remove a tile mid-play). */
function useStopOnUnmount(ref: RefObject<HTMLMediaElement | null>, slot: PlayerSlot) {
  useEffect(() => {
    const el = ref.current
    return () => {
      if (!el) return
      el.pause()
      releasePlayer(el, slot)
    }
  }, [ref, slot])
}

function TileVideo({ url, poster, videoRef }: { url: string; poster: string | null; videoRef: RefObject<HTMLVideoElement | null> }) {
  useStopOnUnmount(videoRef, "hover")
  return (
    <video
      ref={videoRef}
      muted
      playsInline
      preload="metadata"
      src={url + "#t=0.1"}
      poster={poster ?? undefined}
      className="absolute inset-0 h-full w-full object-cover"
    />
  )
}

/** The audio tile's play/pause control. It sits beside the open-job button,
 *  never inside it, so a click plays without opening the job. */
function TileAudioControl({ url, jobLabel }: { url: string; jobLabel: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  useStopOnUnmount(audioRef, "audio")

  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
      releasePlayer(el, "audio")
    } else {
      claimPlayer(el, "audio")
      el.play().catch(() => {})
    }
  }

  return (
    <>
      <audio
        ref={audioRef}
        src={url}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={(e) => {
          setPlaying(false)
          releasePlayer(e.currentTarget, "audio")
        }}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          toggle()
        }}
        aria-label={`${playing ? "Pause" : "Play"} audio of job ${jobLabel}`}
        className="pointer-events-auto absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm hover:bg-background"
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
    </>
  )
}

function Tile({ item, onOpen }: { item: GItem; onOpen: () => void }) {
  const job = item.job
  const media = tileMedia(job)
  const st = job.status
  const type = rowJobType(job) ?? ""
  const jobLabel = job.id.slice(0, 8)
  const { ref: lazyRef, mounted } = useLazyMount("200px")
  const videoRef = useRef<HTMLVideoElement>(null)

  const still =
    media.kind === "image" ? media.url
    : media.kind === "audio" ? media.cover
    : media.kind === "video" ? media.poster
    : null
  const showVideo = media.kind === "video" && mounted
  const AudioIcon = jobKindOf(type) === "music" ? Music : AudioLines

  // Hover plays a video muted; leaving stops and rewinds it. The "hover" slot
  // stops the previous preview even when this enter beats its leave, and
  // never touches a playing audio track (that is the "audio" slot).
  const onPointerEnter = () => {
    const el = videoRef.current
    if (!el) return
    claimPlayer(el, "hover")
    el.play().catch(() => {})
  }
  const onPointerLeave = () => {
    const el = videoRef.current
    if (!el) return
    el.pause()
    el.currentTime = 0
    releasePlayer(el, "hover")
  }

  return (
    <div
      data-testid={`job-tile-${job.id}`}
      className="relative"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open job ${jobLabel}`}
        className="group w-full text-left rounded-xl overflow-hidden border bg-card hover:border-foreground/25 transition-colors"
      >
        <div
          ref={lazyRef}
          className="relative aspect-square bg-muted/40"
          style={media.kind === "none" ? STRIPES : undefined}
        >
          {still && !showVideo && (
            <img src={still} loading="lazy" alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          {showVideo && <TileVideo url={media.url} poster={media.poster} videoRef={videoRef} />}
          {media.kind === "audio" && !media.cover && (
            <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              <AudioIcon className="h-10 w-10" />
            </span>
          )}
          {media.kind === "text" && (
            <p
              dir="auto"
              className="absolute inset-x-0 top-0 line-clamp-6 whitespace-pre-line break-words px-3 pt-8 text-xs text-foreground/80"
            >
              {media.text}
            </p>
          )}
          {st === "completed" ? (
            <span className="absolute top-2 left-2 h-2 w-2 rounded-full bg-pink-500 ring-2 ring-pink-500/25" title="completed" />
          ) : (
            <span
              className={`absolute top-2 left-2 rounded-full px-1.5 py-0.5 font-mono text-[11px] font-semibold ${STATUS_TAG[st] ?? "bg-muted text-muted-foreground"}`}
            >
              {st}
            </span>
          )}
          {type && (
            <span className="absolute bottom-2 left-2 right-2 truncate rounded bg-background/70 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {type}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1 px-2.5 py-2">
          <span className="font-mono text-xs text-foreground/90">{jobLabel}</span>
          <span className="truncate text-xs text-muted-foreground" title={job.user_email}>
            {job.user_email}
          </span>
          <span className="flex justify-between font-mono text-[11px] text-muted-foreground">
            <span>{creditTileLabel(job)}</span>
            <span>{ago(job.created_at)}</span>
          </span>
        </div>
      </button>
      {media.kind === "audio" && (
        <div className="pointer-events-none absolute inset-x-0 top-0 aspect-square">
          <TileAudioControl url={media.url} jobLabel={jobLabel} />
        </div>
      )}
    </div>
  )
}

const segClass = (on: boolean) =>
  `rounded-md px-3 py-1.5 text-xs transition-colors ${on ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`
const cap = "font-mono text-[11px] uppercase tracking-wider text-muted-foreground"

export interface JobsGalleryProps {
  filters: AdminJobFilters
  /** The admins' ids, sent while `filters.excludeAdmins` hides them. */
  excludeUserIds?: ReadonlyArray<string>
  /** False holds the request (the admins' ids it must exclude are not loaded yet). */
  enabled?: boolean
  onOpenJob: (job: AdminJob) => void
}

export function JobsGallery({ filters, excludeUserIds, enabled = true, onOpenJob }: JobsGalleryProps) {
  const query = useAdminJobsInfinite(50, filters, excludeUserIds, { enabled })
  const { data, isError, hasNextPage, fetchNextPage, isFetchingNextPage } = query
  const isLoading = query.isLoading || !enabled
  const [primary, setPrimary] = useState<"day" | "source">("day")
  const [compact, setCompact] = useState(false)

  // Flatten pages, deduped by id: offset paging over a live created_at-desc
  // table repeats a row across page boundaries when new jobs land mid-scroll.
  const items = useMemo<GItem[]>(() => {
    const seen = new Set<string>()
    const out: GItem[] = []
    for (const page of data?.pages ?? []) {
      for (const job of page.jobs) {
        if (!seen.has(job.id)) {
          seen.add(job.id)
          out.push({ job, plat: jobPlatform(job) })
        }
      }
    }
    return out
  }, [data])

  const groups = useMemo(() => buildGroups(items, primary), [items, primary])
  const userNotFound = data?.pages[0]?.userNotFound === true
  const filtersUnavailable = data?.pages.some((p) => p.filtersUnavailable) === true

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
        <span className={cap}>Group by</span>
        <div className="flex gap-1 rounded-lg border bg-background p-1">
          <button type="button" className={segClass(primary === "day")} onClick={() => setPrimary("day")}>
            Day → Source
          </button>
          <button type="button" className={segClass(primary === "source")} onClick={() => setPrimary("source")}>
            Source → Day
          </button>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button type="button" className={segClass(compact)} onClick={() => setCompact((c) => !c)}>
            {compact ? "Compact grid" : "Comfortable grid"}
          </button>
          <span className="font-mono text-xs text-muted-foreground">{items.length} outputs shown</span>
        </div>
      </div>

      {filtersUnavailable && <FiltersUnavailableNotice />}

      {isError && items.length === 0 ? (
        <div className="py-16 text-center font-mono text-sm text-destructive">
          Couldn&apos;t load jobs. Try again.
        </div>
      ) : isLoading && items.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : groups.length === 0 ? (
        <div className="py-16 text-center font-mono text-sm text-muted-foreground">
          {userNotFound ? "No user with that email" : "No outputs match these filters"}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="mb-10">
            <div className="sticky top-0 z-10 mb-4 flex items-baseline gap-3 border-b bg-background/95 pb-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <h2 className="text-lg font-semibold">{g.label}</h2>
              {g.sub && <span className="font-mono text-xs text-muted-foreground">{g.sub}</span>}
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {g.outputs} outputs · {g.subCount} {primary === "day" ? "sources" : "days"} · {g.credits} credits
              </span>
            </div>
            {g.sections.map((sec) => (
              <div key={sec.key} className="mb-6">
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="text-sm font-medium">{sec.label}</span>
                  <span className="rounded-full border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                    {sec.count} outputs
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">{sec.credits} credits</span>
                </div>
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 116 : 172}px, 1fr))` }}
                >
                  {sec.items.map((it) => (
                    <Tile key={it.job.id} item={it} onOpen={() => onOpenJob(it.job)} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))
      )}

      {hasNextPage && (
        <div className="mt-2 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading…
              </>
            ) : (
              "Load more"
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
