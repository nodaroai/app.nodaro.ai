import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAdminJobsInfinite, type AdminJob } from "@/ee/hooks/queries/use-admin-queries"
import { jobPlatform } from "@/lib/job-platform"
import { ago, buildGroups, jobThumb, typeLabel, type GItem } from "./jobs-gallery-grouping"

const STATUS_TAG: Record<string, string> = {
  failed: "bg-red-500 text-white",
  processing: "bg-amber-500 text-black",
  queued: "bg-sky-500 text-white",
  pending: "bg-sky-500 text-white",
  cancelled: "bg-muted text-muted-foreground",
}

function Tile({ item, onOpen }: { item: GItem; onOpen: () => void }) {
  const job = item.job
  const thumb = jobThumb(job)
  const st = job.status
  const type = typeLabel(job)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group text-left rounded-xl overflow-hidden border bg-card hover:border-foreground/25 transition-colors"
    >
      <div
        className="relative aspect-square bg-muted/40"
        style={thumb ? undefined : { backgroundImage: "repeating-linear-gradient(135deg, rgba(127,127,127,0.10) 0 6px, transparent 6px 12px)" }}
      >
        {thumb && (
          <img src={thumb} loading="lazy" alt="" className="absolute inset-0 h-full w-full object-cover" />
        )}
        {st === "completed" ? (
          <span className="absolute top-2 left-2 h-2 w-2 rounded-full bg-pink-500 ring-2 ring-pink-500/25" title="completed" />
        ) : (
          <span
            className={`absolute top-2 left-2 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold ${STATUS_TAG[st] ?? "bg-muted text-muted-foreground"}`}
          >
            {st}
          </span>
        )}
        {type && (
          <span className="absolute bottom-2 left-2 right-2 truncate rounded bg-background/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {type}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1 px-2.5 py-2">
        <span className="font-mono text-xs text-foreground/90">{job.id.slice(0, 8)}</span>
        <span className="truncate text-xs text-muted-foreground" title={job.user_email}>
          {job.user_email}
        </span>
        <span className="flex justify-between font-mono text-[10px] text-muted-foreground">
          <span>{job.credits ?? 0} cr</span>
          <span>{ago(job.created_at)}</span>
        </span>
      </div>
    </button>
  )
}

const segClass = (on: boolean) =>
  `rounded-md px-3 py-1.5 text-xs transition-colors ${on ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`
const chipClass = (on: boolean) =>
  `rounded-full border px-3 py-1 text-xs transition-colors ${
    on
      ? "border-pink-500/50 bg-pink-500/10 text-pink-600 dark:text-pink-400"
      : "border-border bg-background text-muted-foreground hover:text-foreground"
  }`
const cap = "font-mono text-[11px] uppercase tracking-wider text-muted-foreground"

export interface JobsGalleryProps {
  statusFilter?: string
  userIdFilter?: string
  excludeUserIds?: ReadonlyArray<string>
  onOpenJob: (job: AdminJob) => void
}

export function JobsGallery({ statusFilter, userIdFilter, excludeUserIds, onOpenJob }: JobsGalleryProps) {
  const { data, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage } = useAdminJobsInfinite(
    50,
    statusFilter,
    userIdFilter,
    excludeUserIds,
  )
  const [primary, setPrimary] = useState<"day" | "source">("day")
  const [platforms, setPlatforms] = useState<ReadonlySet<string>>(new Set())
  const [compact, setCompact] = useState(false)

  // Flatten pages, deduped by id: offset paging over a live created_at-desc
  // table repeats a row across page boundaries when new jobs land mid-scroll.
  const items = useMemo<GItem[]>(() => {
    const seen = new Set<string>()
    const out: GItem[] = []
    for (const page of data?.pages ?? []) {
      for (const job of page) {
        if (!seen.has(job.id)) {
          seen.add(job.id)
          out.push({ job, plat: jobPlatform(job) })
        }
      }
    }
    return out
  }, [data])

  const allPlatforms = useMemo(() => {
    const m = new Map<string, string>()
    for (const it of items) if (!m.has(it.plat.key)) m.set(it.plat.key, it.plat.label)
    return [...m.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [items])

  // Drop any selected platform that no longer exists in the loaded set — e.g.
  // after a status/user filter change removes every job for it — so a stale
  // selection can't strand the view on an empty "no outputs" state with no
  // visible chip left to un-click. (Load-more only ever ADDS platforms, so this
  // is a no-op there.)
  useEffect(() => {
    setPlatforms((prev) => {
      if (prev.size === 0) return prev
      const present = new Set(allPlatforms.map((p) => p.key))
      let changed = false
      const next = new Set<string>()
      for (const k of prev) {
        if (present.has(k)) next.add(k)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [allPlatforms])

  const rows = useMemo(
    () => (platforms.size ? items.filter((it) => platforms.has(it.plat.key)) : items),
    [items, platforms],
  )
  const groups = useMemo(() => buildGroups(rows, primary), [rows, primary])

  const togglePlatform = (key: string) =>
    setPlatforms((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

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
        {allPlatforms.length > 0 && (
          <>
            <span className={cap}>Source</span>
            <div className="flex flex-wrap gap-1.5">
              {allPlatforms.map((p) => (
                <button key={p.key} type="button" className={chipClass(platforms.has(p.key))} onClick={() => togglePlatform(p.key)}>
                  {p.label}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="ml-auto flex items-center gap-3">
          <button type="button" className={segClass(compact)} onClick={() => setCompact((c) => !c)}>
            {compact ? "Compact grid" : "Comfortable grid"}
          </button>
          <span className="font-mono text-xs text-muted-foreground">{rows.length} outputs shown</span>
        </div>
      </div>

      {isError && items.length === 0 ? (
        <div className="py-16 text-center font-mono text-sm text-destructive">
          Couldn&apos;t load jobs. Try again.
        </div>
      ) : isLoading && items.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : groups.length === 0 ? (
        <div className="py-16 text-center font-mono text-sm text-muted-foreground">No outputs match these filters</div>
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
