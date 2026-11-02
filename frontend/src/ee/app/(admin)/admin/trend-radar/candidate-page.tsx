// Admin → Trend Radar → one candidate: its readings, top posts, where it is
// a template elsewhere, the search confirmation, the thresholds it is held
// to and its history; the three decisions. "Open as draft trend" creates the
// draft (the top post's clip is downloaded into it in the background) and
// goes to the trend editor.

import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Check, ExternalLink, Loader2, Minus, Plus, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { formatDay, formatPlays, formatSeconds, platformName } from "./format"
import { Card, ReadingsChart, StatusPill } from "./parts"
import { radarUnavailable, safeHref, useApproveCandidate, useRadarCandidate, useRejectCandidate, useWatchCandidate } from "./use-trend-radar"

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs">{children}</span>
}

export default function AdminTrendCandidatePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: c, isLoading, error } = useRadarCandidate(id)
  const approve = useApproveCandidate()
  const watch = useWatchCandidate()
  const reject = useRejectCandidate()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState("")
  const busy = approve.isPending || watch.isPending || reject.isPending

  if (isLoading && !c) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>
  }
  if (!c) {
    return (
      <div className="p-6 space-y-3">
        <Button variant="ghost" size="sm" asChild><Link to="/admin/trend-radar"><ArrowLeft className="h-4 w-4 me-1" />Trend Radar</Link></Button>
        <p className="text-sm text-muted-foreground">{radarUnavailable(error) ? "Trend Radar is not available on this server yet." : (error?.message ?? "Candidate not found.")}</p>
      </div>
    )
  }

  // Rejected and archived are closed; an approved row without a draft yet may be approved again (the same trend answers).
  const decided = c.status === "rejected" || c.status === "archived"
  const top = c.topPost

  const onApprove = () => {
    approve.mutate(c.id, {
      onSuccess: ({ trendId, clip }) => {
        toast.success(clip === "attaching" ? "Draft trend created; the top post's clip is being added." : "Draft trend created.")
        navigate(`/admin/trends/${trendId}`)
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not approve"),
    })
  }
  const onWatch = () => {
    watch.mutate(c.id, {
      onSuccess: () => toast.success("Kept watching."),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
    })
  }
  const onReject = () => {
    reject.mutate(
      { id: c.id, reason: reason.trim() },
      {
        onSuccess: () => {
          setRejecting(false)
          setReason("")
          toast.success("Rejected.")
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not reject"),
      },
    )
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/admin/trend-radar" className="hover:underline">Trend Radar</Link>
        <span>/</span>
        <span className="text-foreground">{c.name}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{c.name}</h1>
            <StatusPill status={c.status} label={c.label} />
            <Chip>{c.creators} creators</Chip>
            <Chip>≈{formatPlays(c.plays)} plays</Chip>
            <Chip>{formatSeconds(c.durationSec)}</Chip>
          </div>
          <p className="text-sm text-muted-foreground">
            {c.summary ?? `First seen on ${c.firstSeen.name} · ${formatDay(c.firstSeen.firstSeenAt)}${c.soundName ? ` · sound "${c.soundName}"` : ""}`}
          </p>
          {c.status === "rejected" && c.rejectReason && <p className="text-sm text-muted-foreground">Rejected: {c.rejectReason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {c.status === "approved" && c.trendId ? (
            <Button asChild><Link to={`/admin/trends/${c.trendId}`}>Open the draft trend</Link></Button>
          ) : (
            <>
              {c.status !== "rejected" && (
                <Button variant="ghost" onClick={() => setRejecting(true)} disabled={busy}>Reject…</Button>
              )}
              {c.status !== "watching" && (
                <Button variant="outline" onClick={onWatch} disabled={busy}>Keep watching</Button>
              )}
              <Button onClick={onApprove} disabled={busy || decided}>
                {approve.isPending ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Plus className="h-4 w-4 me-2" />}
                Open as draft trend
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-start">
        <div className="flex-[999_1_560px] min-w-0 space-y-4">
          <Card title="Daily readings" aside="Creators (bars) and total plays (line)">
            <ReadingsChart readings={c.readings} />
            {c.passedAt && <p className="text-xs text-muted-foreground mt-2">Passed the creator threshold on {formatDay(c.passedAt)}.</p>}
          </Card>

          {top?.embedUrl && (
            <Card title="Top post">
              <div className="flex flex-wrap gap-4">
                <iframe
                  src={top.embedUrl}
                  title={`Top post by ${top.author}`}
                  className="w-[300px] max-w-full aspect-[9/16] rounded-md border bg-black"
                  sandbox="allow-scripts allow-same-origin allow-popups"
                  allow="encrypted-media; picture-in-picture"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                />
                <div className="text-sm space-y-1 min-w-0">
                  <div className="font-medium">@{top.author}</div>
                  <div className="text-muted-foreground">{platformName(top.platform)} · {formatDay(top.postedAt)} · {formatPlays(top.plays ?? top.likes)} {top.plays === null ? "likes" : "plays"}</div>
                  {top.soundName && <div className="text-muted-foreground">sound: {top.soundName}</div>}
                  {safeHref(top.url) && <a href={safeHref(top.url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary-ink hover:underline">Open<ExternalLink className="h-3.5 w-3.5" /></a>}
                </div>
              </div>
            </Card>
          )}

          <Card title="Top posts">
            {c.posts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No posts read yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-start font-medium px-2 py-2">Site</th>
                      <th className="text-start font-medium px-2 py-2">Account</th>
                      <th className="text-start font-medium px-2 py-2">Posted</th>
                      <th className="text-start font-medium px-2 py-2">Plays</th>
                      <th className="text-start font-medium px-2 py-2">Sound</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {c.posts.map((p) => (
                      <tr key={p.url} className="border-b last:border-b-0">
                        <td className="px-2 py-2">{platformName(p.platform)}</td>
                        <td className="px-2 py-2">@{p.author}</td>
                        <td className="px-2 py-2 tabular-nums">{formatDay(p.postedAt)}</td>
                        <td className="px-2 py-2 tabular-nums">{p.plays === null ? `${formatPlays(p.likes)} likes` : formatPlays(p.plays)}</td>
                        <td className="px-2 py-2 text-muted-foreground">{p.soundName ?? "original"}</td>
                        <td className="px-2 py-2 text-end">{safeHref(p.url) && <a href={safeHref(p.url)} target="_blank" rel="noopener noreferrer" className="text-primary-ink hover:underline whitespace-nowrap">Open ↗</a>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Templates elsewhere">
              {c.templatesElsewhere.length === 0 ? (
                <p className="text-sm text-muted-foreground">Not seen as a template anywhere yet.</p>
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {c.templatesElsewhere.map((t) => (
                    <div key={`${t.site}-${t.url}`} className="contents">
                      <dt className="text-muted-foreground">{t.site}</dt>
                      <dd className="font-medium">
                        {safeHref(t.url) ? <a href={safeHref(t.url)} target="_blank" rel="noopener noreferrer" className="hover:underline">since {formatDay(t.since)}</a> : <span>since {formatDay(t.since)}</span>}
                        {t.note && <span className="text-muted-foreground font-normal"> · {t.note}</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </Card>
            <Card title="Search confirmation">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Search suggests</dt>
                <dd className={cn("font-medium", c.search?.suggest === true && "text-emerald-700 dark:text-emerald-300")}>
                  {c.search ? (c.search.suggest === null ? "not checked" : c.search.suggest ? `"${c.name} ai" ✓` : "not yet") : "not checked"}
                </dd>
                <dt className="text-muted-foreground">Interest, 7 days</dt>
                <dd className="font-medium tabular-nums">{c.search?.interest7d ? `${c.search.interest7d.from} → ${c.search.interest7d.to}` : "—"}</dd>
                <dt className="text-muted-foreground">Checked</dt>
                <dd className="font-medium">{c.search ? formatDay(c.search.checkedAt) : "—"}</dd>
              </dl>
            </Card>
          </div>
        </div>

        <aside className="flex-[1_1_300px] max-w-[360px] min-w-0 space-y-4">
          <Card title="Thresholds">
            <ul className="divide-y text-sm">
              {c.checklist.map((check) => (
                <li key={check.key} className="flex items-start gap-2.5 py-2">
                  <span className={cn("mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full", check.auto === true ? "bg-emerald-600 text-white" : check.auto === false ? "bg-muted text-muted-foreground" : "bg-muted text-muted-foreground")} aria-hidden="true">
                    {check.auto === true ? <Check className="h-3 w-3" /> : check.auto === false ? <X className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                  </span>
                  <div>
                    <div>{check.label}</div>
                    {check.hint && <div className="text-xs text-muted-foreground">{check.hint}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title='What "Open as draft trend" does'>
            <ol className="list-decimal ps-5 text-sm space-y-1 text-muted-foreground">
              <li>Creates a draft trend named "{c.name}"</li>
              <li>Downloads the top post's clip into it as the source, in the background</li>
              <li>Opens the trend editor, where the clip is cut and the slots set</li>
              <li>Marks the candidate approved here</li>
            </ol>
          </Card>

          <Card title="History">
            {c.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {[...c.history].reverse().slice(0, 20).map((h, i) => (
                  <div key={`${h.at}-${i}`} className="contents">
                    <dt className="text-muted-foreground whitespace-nowrap">{formatDay(h.at)}</dt>
                    <dd><span className="font-medium">{h.event.replace(/_/g, " ")}</span>{h.detail && <span className="text-muted-foreground"> · {h.detail}</span>}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        </aside>
      </div>

      <Dialog open={rejecting} onOpenChange={(open) => !busy && setRejecting(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject "{c.name}"</DialogTitle>
            <DialogDescription>The reason stays on the candidate; the daily run stops reading it.</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it is not a trend for us" maxLength={500} rows={3} aria-label="Reason" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={onReject} disabled={busy || reason.trim().length === 0}>
              {reject.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
