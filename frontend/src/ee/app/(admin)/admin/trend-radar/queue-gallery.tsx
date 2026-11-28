// The queue as a gallery: one vertical tile per candidate, its top post's
// still with the two numbers that decide it: how many people posted it (a
// clip many people recast is a trend; one big video few copy is not), then
// its views. Everything else is in the viewer a tile opens, where the post
// plays and the candidate is decided.

import type { TrendCandidateCard } from "@nodaro/sdk/trend-radar"
import { Play } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatPlays } from "./format"
import { StatusPill } from "./parts"
import { PlatformChip, PostStill } from "./post-media"
import { cardCreators, cardPlatforms, cardPlays, cardPost, formatCreators, type QueueFilters } from "./queue-view"

function Tile({ c, platform, onOpen }: { c: TrendCandidateCard; platform: QueueFilters["platform"]; onOpen: (id: string) => void }) {
  const post = cardPost(c, platform)
  const decided = c.status === "rejected" || c.status === "archived"
  const people = formatCreators(cardCreators(c, platform))
  const views = formatPlays(cardPlays(c, platform))
  return (
    <button
      type="button"
      onClick={() => onOpen(c.id)}
      className={cn(
        "group text-start rounded-lg border bg-card overflow-hidden transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        decided && "opacity-60",
      )}
      aria-label={`${c.name}: ${people} people, ${views} views`}
    >
      <div className="relative aspect-[9/16] bg-muted overflow-hidden">
        <PostStill key={post?.url ?? "none"} post={post} alt="" className="transition-transform duration-300 group-hover:scale-[1.03]" />
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-1 p-2">
          <StatusPill status={c.status} label={c.label} />
          <span className="flex flex-col items-end gap-1">
            {cardPlatforms(c).map((p) => (
              <PlatformChip key={p} platform={p} />
            ))}
          </span>
        </div>
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <span className="rounded-full bg-black/60 p-3 text-white">
            <Play className="h-6 w-6 fill-current" aria-hidden="true" />
          </span>
        </span>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-2.5 pt-10 text-white">
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold leading-none tabular-nums">{people}</span>
            <span className="text-xs opacity-90">people posted it</span>
          </div>
          <div className="mt-1 text-sm tabular-nums opacity-90">{views} views</div>
        </div>
      </div>
      <div className="p-2.5">
        <div className="text-sm font-semibold leading-snug line-clamp-2">{c.name}</div>
      </div>
    </button>
  )
}

export function QueueGallery({ cards, platform, onOpen }: { cards: readonly TrendCandidateCard[]; platform: QueueFilters["platform"]; onOpen: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
      {cards.map((c) => (
        <Tile key={c.id} c={c} platform={platform} onOpen={onOpen} />
      ))}
    </div>
  )
}
