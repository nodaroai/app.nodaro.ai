// The queue as a table: the same cards and filters as the gallery, one row
// each. "Play" opens the viewer; "Review" the candidate's own page.

import { Link } from "react-router-dom"
import type { TrendCandidateCard } from "@nodaro/sdk/trend-radar"
import { Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatDay, formatDayChange, formatPlays, formatSeconds } from "./format"
import { StatusPill } from "./parts"
import { PlatformChip } from "./post-media"
import { cardCreators, cardPlatforms, cardPlays, formatAge, formatCreators, trendAgeDays, type QueueFilters } from "./queue-view"

// People first: how many posted it decides a trend more than its views.
const HEADS = ["Trend", "People", "Views", "Platforms", "First seen", "Age", "Growth / day", "Status", ""] as const

export function QueueTable({ cards, platform, onOpen }: { cards: readonly TrendCandidateCard[]; platform: QueueFilters["platform"]; onOpen: (id: string) => void }) {
  const now = new Date()
  const maxCreators = Math.max(1, ...cards.map((c) => cardCreators(c, platform).creators))
  return (
    <div className="rounded-lg border bg-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            {HEADS.map((h, i) => (
              <th key={i} className="text-start font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => {
            const decided = c.status === "rejected" || c.status === "archived"
            return (
              <tr key={c.id} className={cn("border-b last:border-b-0", decided && "text-muted-foreground")}>
                <td className="px-3 py-3 min-w-[220px]">
                  <Link to={`/admin/trend-radar/${c.id}`} className="font-semibold hover:underline">{c.name}</Link>
                  <div className="text-xs text-muted-foreground">
                    {c.soundName ? `sound: "${c.soundName}"` : "sound: original"} · {formatSeconds(c.durationSec)}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums font-semibold w-8">{formatCreators(cardCreators(c, platform))}</span>
                    <span className="h-1.5 w-[72px] rounded bg-muted overflow-hidden" aria-hidden="true">
                      <span className="block h-full bg-foreground" style={{ width: `${Math.round((100 * cardCreators(c, platform).creators) / maxCreators)}%` }} />
                    </span>
                  </div>
                </td>
                <td className="px-3 py-3 tabular-nums">{formatPlays(cardPlays(c, platform))}</td>
                <td className="px-3 py-3">
                  <span className="flex flex-wrap gap-1">
                    {cardPlatforms(c).map((p) => (
                      <PlatformChip key={p} platform={p} />
                    ))}
                  </span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{c.firstSeen.name} · {formatDay(c.firstSeen.firstSeenAt)}</td>
                <td className="px-3 py-3 tabular-nums">{formatAge(trendAgeDays(c, now))}</td>
                <td className={cn("px-3 py-3 tabular-nums", (c.dayChangePct ?? 0) > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>{formatDayChange(c.dayChangePct)}</td>
                <td className="px-3 py-3"><StatusPill status={c.status} label={c.label} /></td>
                <td className="px-3 py-3 whitespace-nowrap text-end space-x-2">
                  <Button size="sm" variant="ghost" onClick={() => onOpen(c.id)} aria-label={`Play ${c.name}`}>
                    <Play className="h-4 w-4" />
                  </Button>
                  {c.status === "approved" && c.trendId ? (
                    <Button size="sm" variant="outline" asChild><Link to={`/admin/trends/${c.trendId}`}>Open draft</Link></Button>
                  ) : (
                    <Button size="sm" variant={c.status === "candidate" ? "default" : "outline"} asChild><Link to={`/admin/trend-radar/${c.id}`}>Review</Link></Button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
