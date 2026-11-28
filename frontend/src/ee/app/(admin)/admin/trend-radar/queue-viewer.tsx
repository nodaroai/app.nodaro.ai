// The viewer: one candidate at a time, its posts playing in the platform's own
// player, and the three decisions beside them. After a decision it moves to
// the next candidate in the queue's order, so a day's queue is decided in one
// pass. Keys: ← → (or K J) move, A opens as a draft trend, W keeps watching,
// R rejects, O opens the full review; Esc closes.

import { useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import type { TrendCandidateCard, TrendCandidatePost } from "@nodaro/sdk/trend-radar"
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useApproveFlow } from "./approve-flow"
import { formatDay, formatDayChange, formatPlays, formatSeconds, platformName } from "./format"
import { ReadingsChart, StatusPill } from "./parts"
import { PlatformChip, PostPlayer, PostStill } from "./post-media"
import { cardPost, formatAge, formatCreators, trendAgeDays, type QueueFilters } from "./queue-view"
import { safeHref, usePrefetchRadarCandidate, useRadarCandidate, useRejectCandidate, useWatchCandidate } from "./use-trend-radar"

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-md border px-2.5 py-1.5 min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-semibold tabular-nums truncate", className)}>{value}</div>
    </div>
  )
}

/** The posts to offer, the chosen platform's first, then by views. */
function orderedPosts(posts: readonly TrendCandidatePost[], platform: QueueFilters["platform"]): TrendCandidatePost[] {
  const views = (p: TrendCandidatePost) => p.plays ?? p.likes ?? 0
  return [...posts].sort((a, b) => {
    if (platform !== "all" && (a.platform === platform) !== (b.platform === platform)) return a.platform === platform ? -1 : 1
    return views(b) - views(a)
  })
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
}

interface ViewerProps {
  cards: readonly TrendCandidateCard[]
  openId: string | null
  platform: QueueFilters["platform"]
  onOpenId: (id: string | null) => void
}

export function QueueViewer({ cards, openId, platform, onOpenId }: ViewerProps) {
  const navigate = useNavigate()
  const index = openId ? cards.findIndex((c) => c.id === openId) : -1
  // A card decided a moment ago may leave the list before the viewer moves on: keep showing it meanwhile.
  const lastCard = useRef<TrendCandidateCard | null>(null)
  const card = index >= 0 ? cards[index]! : openId && lastCard.current?.id === openId ? lastCard.current : null
  if (card) lastCard.current = card

  const { data: detail } = useRadarCandidate(openId ?? undefined)
  const approve = useApproveFlow(card ?? undefined)
  const watch = useWatchCandidate()
  const reject = useRejectCandidate()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState("")
  const [postUrl, setPostUrl] = useState<string | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setRejecting(false)
    setReason("")
    setPostUrl(null)
  }, [openId])

  const busy = approve.pending || watch.isPending || reject.isPending
  const posts = orderedPosts(detail?.id === card?.id && detail ? detail.posts : card?.topPost ? [card.topPost] : [], platform)
  const shown = posts.find((p) => p.url === postUrl) ?? (card ? cardPost(card, platform) : null) ?? posts[0] ?? null

  const neighbour = (step: number) => (index >= 0 ? (cards[index + step]?.id ?? null) : null)
  const prefetch = usePrefetchRadarCandidate()
  const nextId = neighbour(1)
  useEffect(() => prefetch(nextId), [nextId])
  const go = (step: number) => {
    const id = neighbour(step)
    if (id) onOpenId(id)
  }
  // After a decision: the next card, else the one before, else close.
  const advance = () => onOpenId(neighbour(1) ?? neighbour(-1))

  const onWatch = () => {
    if (!card || busy || card.status === "watching" || !approve.open) return
    watch.mutate(card.id, {
      onSuccess: () => {
        toast.success(`Keeping "${card.name}" in watch.`)
        advance()
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
    })
  }
  const onReject = () => {
    if (!card || busy || !reason.trim()) return
    reject.mutate(
      { id: card.id, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success(`Rejected "${card.name}".`)
          advance()
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not reject"),
      },
    )
  }
  const onApprove = () => {
    if (!card || busy || !approve.ready) return
    approve.run({
      onSuccess: ({ trendId, clip }) => {
        toast.success(clip === "attaching" ? `Draft trend created for "${card.name}"; its clip is being added.` : `Draft trend created for "${card.name}".`, {
          action: { label: "Open draft", onClick: () => navigate(`/admin/trends/${trendId}`) },
        })
        advance()
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not approve"),
    })
  }
  const startReject = () => {
    if (!card || card.status === "rejected" || !approve.open) return
    setRejecting(true)
    requestAnimationFrame(() => reasonRef.current?.focus())
  }

  // The keys read the latest handlers without re-binding on every render.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined)
  keys.current = (e: KeyboardEvent) => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    const action: Record<string, () => void> = {
      arrowright: () => go(1),
      j: () => go(1),
      arrowleft: () => go(-1),
      k: () => go(-1),
      a: onApprove,
      w: onWatch,
      r: startReject,
      o: () => card && navigate(`/admin/trend-radar/${card.id}`),
    }
    const run = action[k]
    if (!run) return
    e.preventDefault()
    run()
  }
  useEffect(() => {
    if (!openId) return
    const listener = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [openId])

  const age = card ? trendAgeDays(card, new Date()) : null

  return (
    <Dialog open={!!openId && !!card} onOpenChange={(open) => !open && onOpenId(null)}>
      <DialogContent className="sm:max-w-5xl max-h-[94vh] overflow-y-auto p-0 gap-0">
        {card && (
          <div className="grid md:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
            <div className="relative bg-black flex items-center justify-center md:rounded-s-lg overflow-hidden">
              <div className="aspect-[9/16] w-full max-h-[86vh]">
                {shown ? <PostPlayer key={shown.url} post={shown} title={`${card.name} — @${shown.author}`} /> : <PostStill post={null} alt="" />}
              </div>
              <button type="button" onClick={() => go(-1)} disabled={!neighbour(-1)} className="absolute start-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white disabled:opacity-30" aria-label="Previous candidate">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button type="button" onClick={() => go(1)} disabled={!neighbour(1)} className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white disabled:opacity-30" aria-label="Next candidate">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 min-w-0">
              <div className="pe-8 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="text-xl font-bold">{card.name}</DialogTitle>
                  <StatusPill status={card.status} label={card.label} />
                </div>
                <DialogDescription className="text-xs">
                  {index >= 0 ? `${index + 1} of ${cards.length}` : "Decided"} · first seen on {card.firstSeen.name}, {formatDay(card.firstSeen.firstSeenAt)}
                  {card.soundName ? ` · sound "${card.soundName}"` : ""}
                </DialogDescription>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                <Stat label="People posted it" value={formatCreators(card)} />
                <Stat label="Views" value={formatPlays(card.plays)} />
                <Stat label="Growth / day" value={formatDayChange(card.dayChangePct)} className={(card.dayChangePct ?? 0) > 0 ? "text-emerald-600 dark:text-emerald-400" : undefined} />
                <Stat label="Trend age" value={formatAge(age)} />
                <Stat label="Length" value={formatSeconds(card.durationSec)} />
              </div>

              {posts.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">Posts</div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {posts.map((p) => (
                      <button
                        key={p.url}
                        type="button"
                        onClick={() => setPostUrl(p.url)}
                        aria-pressed={p.url === shown?.url}
                        aria-label={`Play the ${platformName(p.platform)} post by @${p.author}`}
                        className={cn("relative w-16 shrink-0 aspect-[9/16] rounded overflow-hidden border-2 bg-muted", p.url === shown?.url ? "border-[#ff0073]" : "border-transparent")}
                      >
                        <PostStill key={p.url} post={p} alt="" />
                        <span className="absolute start-0.5 top-0.5"><PlatformChip platform={p.platform} className="px-1" /></span>
                        <span className="absolute inset-x-0 bottom-0 bg-black/60 text-[11px] text-white tabular-nums">{formatPlays(p.plays ?? p.likes)}</span>
                      </button>
                    ))}
                  </div>
                  {shown && (
                    <div className="text-xs text-muted-foreground">
                      @{shown.author} · {platformName(shown.platform)} · {formatDay(shown.postedAt)} · {formatPlays(shown.plays ?? shown.likes)} {shown.plays === null ? "likes" : "views"}
                      {safeHref(shown.url) && (
                        <a href={safeHref(shown.url)} target="_blank" rel="noopener noreferrer" className="ms-2 inline-flex items-center gap-1 text-primary-ink hover:underline">
                          Open<ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}

              {detail?.id === card.id && detail.readings.length > 0 && <ReadingsChart readings={detail.readings} />}

              <div className="space-y-3 border-t pt-4">
                {card.status === "approved" && card.trendId ? (
                  <Button asChild><Link to={`/admin/trends/${card.trendId}`}>Open the draft trend</Link></Button>
                ) : approve.open ? (
                  <>
                    {approve.needsRights && (
                      <label className="flex items-start gap-2.5 text-xs text-muted-foreground cursor-pointer">
                        <Checkbox
                          checked={approve.rightsConfirmed}
                          onCheckedChange={(v) => approve.setRightsConfirmed(v === true)}
                          disabled={!approve.declaration || busy}
                          aria-label="I confirm the declaration for the top post's clip"
                          className="mt-0.5"
                        />
                        <span>{approve.declaration ? approve.declaration.text : approve.declarationError ? "The declaration could not be loaded." : "Loading the declaration…"}</span>
                      </label>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={onApprove} disabled={busy || !approve.ready}>
                        {approve.pending ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Plus className="h-4 w-4 me-2" />}
                        Open as draft trend
                      </Button>
                      {card.status !== "watching" && <Button variant="outline" onClick={onWatch} disabled={busy}>Keep watching</Button>}
                      <Button variant="ghost" onClick={startReject} disabled={busy || rejecting}>Reject…</Button>
                      <Button variant="ghost" asChild><Link to={`/admin/trend-radar/${card.id}`}>Full review</Link></Button>
                    </div>
                  </>
                ) : (
                  <Button variant="outline" asChild><Link to={`/admin/trend-radar/${card.id}`}>Full review</Link></Button>
                )}

                {rejecting && (
                  <div className="space-y-2">
                    <Textarea ref={reasonRef} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it is not a trend for us" maxLength={500} rows={2} aria-label="Reason" />
                    <div className="flex gap-2">
                      <Button variant="destructive" size="sm" onClick={onReject} disabled={busy || !reason.trim()}>
                        {reject.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
                        Reject
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setRejecting(false)} disabled={busy}>Cancel</Button>
                    </div>
                  </div>
                )}

                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span><Kbd>←</Kbd> <Kbd>→</Kbd> move</span>
                  <span><Kbd>A</Kbd> draft</span>
                  <span><Kbd>W</Kbd> watch</span>
                  <span><Kbd>R</Kbd> reject</span>
                  <span><Kbd>O</Kbd> full review</span>
                  <span>Click outside the video for the keys to work.</span>
                </p>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
