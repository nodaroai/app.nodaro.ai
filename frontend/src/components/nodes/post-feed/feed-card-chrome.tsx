"use client"

import type { ReactNode } from "react"
import { POST_FEED_MAX_THUMBS } from "./post-feed-card"

/**
 * The frame around the shared post feed card: the header row (source label,
 * a badge, the status on the right), the dashed placeholder, the running
 * skeleton and the status dot. The node passes its own words; nothing here
 * knows which source it reads.
 */

export function FeedDot({ color, glow }: { readonly color: string; readonly glow?: boolean }) {
  return <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color, boxShadow: glow ? "var(--meta-ads-success-glow)" : undefined }} />
}

/** "TELEGRAM · @channel ……… ● 2 new posts". `badgeDir` is "ltr" for a handle, "auto" for a name. */
export function FeedHeaderRow({ label, badge, badgeDir = "auto", right }: {
  readonly label: string
  readonly badge?: string
  readonly badgeDir?: "ltr" | "auto"
  readonly right: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-[11px] font-extrabold uppercase tracking-[.14em] text-[var(--meta-ads-info)]">{label}</span>
        {badge && (
          <>
            <span className="text-[11px] text-[var(--meta-ads-faint)]">·</span>
            <span className="truncate rounded-full bg-[var(--meta-ads-info-tint)] px-2 py-[3px] text-[11px] font-bold text-[var(--meta-ads-info)]" dir={badgeDir}>
              {badge}
            </span>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-[12px] font-semibold text-[var(--meta-ads-muted)]">{right}</div>
    </div>
  )
}

export function FeedPlaceholder({ icon, children }: { readonly icon: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border-[1.5px] border-dashed border-[var(--meta-ads-empty-border)] bg-[var(--meta-ads-empty-bg)] px-6 py-8 text-center">
      <span className="text-[var(--meta-ads-info)] [&>svg]:h-7 [&>svg]:w-7">{icon}</span>
      <div className="max-w-[320px] text-[12.5px] leading-normal text-[var(--meta-ads-muted)]">{children}</div>
    </div>
  )
}

export function FeedRunningSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <div className="h-[220px] rounded-xl animate-pulse bg-[var(--meta-ads-chip)]" />
      <div className="flex gap-1.5">
        {Array.from({ length: POST_FEED_MAX_THUMBS }, (_, i) => (
          <span key={i} className="h-[44px] flex-1 rounded-lg bg-[var(--meta-ads-chip)] animate-pulse" />
        ))}
      </div>
    </div>
  )
}
