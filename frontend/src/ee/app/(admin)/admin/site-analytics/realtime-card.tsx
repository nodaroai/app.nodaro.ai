import { Loader2 } from "lucide-react"
import { clockText, countText } from "./format"
import { SectionProblem, SectionShell } from "./parts"
import type { RealtimeSnapshot, SectionResult } from "./types"
import { useIdle } from "./use-idle"
import { REALTIME_IDLE_MS, useRealtime } from "./use-site-analytics"

/**
 * The line under the title: when the snapshot was taken and how often the
 * server asks again — its own words, never a copy of its rule. A refresh that
 * failed says so, so the last snapshot is never taken for a live one.
 */
function cadence(data: SectionResult<RealtimeSnapshot> | undefined, idle: boolean, failed: Error | null): string | undefined {
  if (idle) return `Paused after ${REALTIME_IDLE_MS / 60_000} minutes without activity — move the mouse to resume`
  if (failed && data) return `Could not refresh (${failed.message})${data.status === "ok" ? ` — showing ${clockText(data.fetchedAt)}` : ""}`
  if (data?.status === "error" && data.retryMinutes) return `Google will be asked again in ${data.retryMinutes} minute${data.retryMinutes === 1 ? "" : "s"}`
  if (data?.status !== "ok") return undefined
  const every = data.data.refreshMinutes
  return `Updated ${clockText(data.fetchedAt)} · ${every > 1 ? `Google's allowance is running low, so every ${every} minutes` : "every minute while this page is open"}`
}

/** Who is on the site right now — GA's last 30 minutes, asked again every minute while the page is open and in use. */
export function RealtimeCard({ configured, email }: { configured: boolean; email: string | null }) {
  const idle = useIdle(REALTIME_IDLE_MS)
  const { data, error, isLoading } = useRealtime(configured && !idle)

  return (
    <SectionShell title="Now on site · last 30 minutes" subtitle={configured ? cadence(data, idle, error) : undefined}>
      {!configured ? (
        <SectionProblem result={{ status: "not_configured" }} product="Analytics" email={email} />
      ) : isLoading && !data ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
      ) : !data ? (
        <p className="text-sm text-muted-foreground">{error?.message ?? "Failed to load real-time data."}</p>
      ) : data.status === "ok" ? (
        <RealtimeBody snapshot={data.data} />
      ) : (
        <SectionProblem result={data} product="Analytics" email={email} />
      )}
    </SectionShell>
  )
}

function RealtimeBody({ snapshot }: { snapshot: RealtimeSnapshot }) {
  // GA also lists a page whose views outlived its visitors; nobody is on it.
  const pages = snapshot.pages.filter((page) => page.activeUsers > 0)
  return (
    <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-start">
      <div>
        <p className="text-4xl font-bold leading-none">{countText(snapshot.activeUsers)}</p>
        <p className="text-sm text-muted-foreground mt-1">active users</p>
        <p className="text-xs text-muted-foreground mt-3">
          {countText(snapshot.views)} views · {countText(snapshot.events)} events
        </p>
      </div>
      <MinuteBars perMinute={snapshot.perMinute} />
      <div>
        <p className="text-xs text-muted-foreground mb-1">Pages people are on</p>
        {pages.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody right now.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {pages.map((page) => (
              <li key={page.title} className="flex justify-between gap-3">
                <span className="truncate">{page.title || "(not set)"}</span>
                <span className="font-mono shrink-0">{countText(page.activeUsers)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

const W = 300
const H = 64

/** Active users per minute, oldest on the left, this minute on the right — GA's own layout — stretched to the column's width. */
function MinuteBars({ perMinute }: { perMinute: readonly number[] }) {
  const oldestFirst = [...perMinute].reverse()
  const peak = Math.max(1, ...oldestFirst)
  const slot = W / Math.max(1, oldestFirst.length)
  // Laid out like the drawing — left to right — whatever the page direction.
  return (
    <div dir="ltr">
      <p className="text-xs text-muted-foreground mb-1">Active users per minute</p>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-16" role="img" aria-label="Active users per minute, last 30 minutes">
        {oldestFirst.map((users, i) => {
          const height = (users / peak) * (H - 2)
          return <rect key={i} data-minutes-ago={oldestFirst.length - 1 - i} x={i * slot + 1} y={H - height} width={Math.max(1, slot - 2)} height={height} fill="currentColor" className="text-primary" />
        })}
      </svg>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>30 min ago</span>
        <span>now</span>
      </div>
    </div>
  )
}
