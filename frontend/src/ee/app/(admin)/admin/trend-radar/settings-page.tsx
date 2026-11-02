// Admin → Trend Radar → Sources & thresholds: where the daily run reads, and
// the numbers that turn a name into a candidate. Edited as one draft and
// saved whole, only when something changed and everything is valid; whoever
// saves becomes the account the daily searches run as. While the draft is
// clean it follows the server (another admin's save shows up); once touched
// it stays until Save or Discard.

import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import type { TrendRadarSettings, TrendRadarSourceInput, TrendRadarSourceKind } from "@nodaro/sdk/trend-radar"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { formatWhen } from "./format"
import { Card } from "./parts"
import { radarUnavailable, useRadarSettings, useSaveRadarSettings } from "./use-trend-radar"

/** A source row in the draft: the input the server takes plus a client key that survives removals. */
type DraftSource = TrendRadarSourceInput & { key: string }
type Draft = Omit<TrendRadarSettings, "sources"> & { sources: DraftSource[] }

const KINDS: ReadonlyArray<{ key: TrendRadarSourceKind; label: string; hint: string }> = [
  { key: "sitemap", label: "Template site", hint: "A public sitemap, read once a day; a new page is a candidate name." },
  { key: "social", label: "Social", hint: "Public posts searched by name (the run's own search)." },
  { key: "suggest", label: "Search suggest", hint: "Confirmation only, never a source." },
]

type ThresholdKey = keyof TrendRadarSettings["thresholds"]
const THRESHOLDS: ReadonlyArray<{ key: ThresholdKey; label: string; hint: string; min: number; step?: number }> = [
  { key: "minCreators", label: "Candidate: distinct creators", hint: "Same clip, recast, within the window", min: 1 },
  { key: "windowDays", label: "Window, days", hint: "How far back a copy counts", min: 1 },
  { key: "risingPct", label: "Rising: day change", hint: "Plays growth per day, percent", min: 0, step: 0.5 },
  { key: "slowingPct", label: "Slowing: day change", hint: "Below this, percent, two days running", min: 0, step: 0.5 },
  { key: "maxClipSec", label: "Max clip length, seconds", hint: "Longer copies are ignored", min: 1 },
  { key: "dailySearchBudget", label: "Search budget per day", hint: "Social searches the run may spend", min: 0 },
]

const RUN_AT = /^([01]\d|2[0-3]):[0-5]\d$/

function toDraft(s: TrendRadarSettings): Draft {
  return { ...s, sources: s.sources.map(({ id, name, kind, url, enabled }) => ({ key: id, id, name, kind, url, enabled })) }
}

/** What the server is sent: the draft without its client keys. */
function toPatch(d: Draft) {
  return {
    sources: d.sources.map(({ key: _key, ...s }) => s),
    thresholds: d.thresholds,
    alerts: d.alerts,
    retentionDays: d.retentionDays,
    runAt: d.runAt,
  }
}

/** Why the draft cannot be saved, or null. */
function problemOf(d: Draft): string | null {
  for (const t of THRESHOLDS) {
    const v = d.thresholds[t.key]
    if (!Number.isFinite(v) || v < t.min) return `${t.label} needs a number of at least ${t.min}.`
  }
  if (!Number.isFinite(d.retentionDays) || d.retentionDays < 1 || d.retentionDays > 365) return "Readings are kept between 1 and 365 days."
  if (!RUN_AT.test(d.runAt)) return "The run time is HH:MM."
  for (const s of d.sources) {
    if (s.name.trim() === "") return "Every source needs a name."
    if (s.kind === "sitemap" && !/^https:\/\/\S+$/.test(s.url ?? "")) return `${s.name.trim()}: a sitemap address starts with https://.`
  }
  return null
}

const number = (raw: string) => (raw.trim() === "" ? Number.NaN : Number(raw))
const shown = (n: number) => (Number.isNaN(n) ? "" : n)

export default function AdminTrendRadarSettingsPage() {
  const settings = useRadarSettings()
  const save = useSaveRadarSettings()
  const [draft, setDraft] = useState<Draft | null>(null)
  const seeded = useRef<string | null>(null)
  const saved = settings.data ? toDraft(settings.data) : null
  const dirty = draft !== null && saved !== null && JSON.stringify(toPatch(draft)) !== JSON.stringify(toPatch(saved))
  const problem = draft ? problemOf(draft) : null

  // Seed the draft, and follow the server while nothing was touched here.
  useEffect(() => {
    if (!settings.data) return
    const fresh = JSON.stringify(settings.data)
    if (seeded.current === fresh) return
    if (draft === null || !dirty) {
      seeded.current = fresh
      setDraft(toDraft(settings.data))
    }
  }, [settings.data, draft, dirty])

  const patch = (change: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...change } : d))
  const patchSource = (key: string, change: Partial<TrendRadarSourceInput>) =>
    setDraft((d) => (d ? { ...d, sources: d.sources.map((s) => (s.key === key ? { ...s, ...change } : s)) } : d))
  const addSource = () => setDraft((d) => (d ? { ...d, sources: [...d.sources, { key: crypto.randomUUID(), name: "", kind: "sitemap", url: "", enabled: true }] } : d))
  const removeSource = (key: string) => setDraft((d) => (d ? { ...d, sources: d.sources.filter((s) => s.key !== key) } : d))

  const onSave = () => {
    if (!draft || problem) return
    save.mutate(toPatch(draft), {
      onSuccess: (next) => {
        seeded.current = JSON.stringify(next)
        setDraft(toDraft(next))
        toast.success("Saved. The daily searches now run as you.")
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
    })
  }

  if (radarUnavailable(settings.error)) {
    return <div className="p-6"><p className="text-sm text-muted-foreground">Trend Radar is not available on this server yet.</p></div>
  }
  if (!draft) {
    return (
      <div className="p-6">
        {settings.error ? <p className="text-sm text-destructive">{settings.error.message}</p> : <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto my-16" aria-label="Loading" />}
      </div>
    )
  }

  const byId = new Map(settings.data?.sources.map((s) => [s.id, s]) ?? [])

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/admin/trend-radar" className="hover:underline">Trend Radar</Link>
        <span>/</span>
        <span className="text-foreground">Sources &amp; thresholds</span>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Sources &amp; thresholds</h1>
          <p className="text-sm text-muted-foreground">Where the daily run reads, and the numbers that turn a name into a candidate. Saved as settings, not code.</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => saved && setDraft(saved)} disabled={!dirty || save.isPending}>Discard</Button>
            <Button onClick={onSave} disabled={!dirty || problem !== null || save.isPending}>
              {save.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              Save
            </Button>
          </div>
          {dirty && problem && <p className="text-xs text-destructive" role="alert">{problem}</p>}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-start">
        <Card
          title="Sources"
          className="flex-[999_1_560px]"
          aside={
            <Button size="sm" variant="outline" onClick={addSource}>
              <Plus className="h-4 w-4 me-1" />Add source
            </Button>
          }
        >
          {draft.sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sources yet. Add a template site's sitemap to start.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="text-start font-medium px-2 py-2">Name</th>
                    <th className="text-start font-medium px-2 py-2">Kind</th>
                    <th className="text-start font-medium px-2 py-2">Address</th>
                    <th className="text-start font-medium px-2 py-2">Last read</th>
                    <th className="text-start font-medium px-2 py-2">On</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {draft.sources.map((s, i) => {
                    const live = s.id ? byId.get(s.id) : undefined
                    const who = s.name.trim() || `source ${i + 1}`
                    return (
                      <tr key={s.key} className="border-b last:border-b-0 align-top">
                        <td className="px-2 py-2 min-w-[140px]"><Input value={s.name} onChange={(e) => patchSource(s.key, { name: e.target.value })} placeholder="Site" aria-label={`Name of ${who}`} /></td>
                        <td className="px-2 py-2 min-w-[150px]">
                          <Select value={s.kind} onValueChange={(v) => patchSource(s.key, { kind: v as TrendRadarSourceKind, url: v === "sitemap" ? (s.url ?? "") : null })}>
                            <SelectTrigger aria-label={`Kind of ${who}`}><SelectValue /></SelectTrigger>
                            <SelectContent>{KINDS.map((k) => <SelectItem key={k.key} value={k.key}>{k.label}</SelectItem>)}</SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-2 min-w-[240px]">
                          {s.kind === "sitemap" ? (
                            <Input value={s.url ?? ""} onChange={(e) => patchSource(s.key, { url: e.target.value })} placeholder="https://…/sitemap.xml" aria-label={`Sitemap address of ${who}`} inputMode="url" />
                          ) : (
                            <span className="text-xs text-muted-foreground">{KINDS.find((k) => k.key === s.kind)?.hint}</span>
                          )}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-xs text-muted-foreground">
                          {live ? (
                            <>
                              <div>{formatWhen(live.lastReadAt)}</div>
                              {live.lastError ? <div className="text-amber-700 dark:text-amber-300">{live.lastError}</div> : live.pages !== null ? <div>{live.pages} pages · +{live.newToday ?? 0} new</div> : null}
                            </>
                          ) : "new"}
                        </td>
                        <td className="px-2 py-2"><Switch checked={s.enabled} onCheckedChange={(v) => patchSource(s.key, { enabled: v })} aria-label={`${who} enabled`} /></td>
                        <td className="px-2 py-2 text-end">
                          <Button variant="ghost" size="icon" aria-label={`Remove ${who}`} onClick={() => removeSource(s.key)}><Trash2 className="h-4 w-4" /></Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-3">A page that cannot be read is skipped and read again the next day. A source pointed at a new address starts over.</p>
        </Card>

        <div className="flex-[1_1_320px] max-w-[420px] min-w-0 space-y-4">
          <Card title="Thresholds" aside="The same rules as the review checklist">
            <div className="divide-y">
              {THRESHOLDS.map((t) => (
                <div key={t.key} className="grid grid-cols-[minmax(0,1fr)_110px] gap-3 items-center py-2.5">
                  <Label htmlFor={`t-${t.key}`} className="space-y-0.5">
                    <span className="block font-semibold">{t.label}</span>
                    <span className="block text-xs text-muted-foreground font-normal">{t.hint}</span>
                  </Label>
                  <Input
                    id={`t-${t.key}`}
                    type="number"
                    min={t.min}
                    step={t.step ?? 1}
                    value={shown(draft.thresholds[t.key])}
                    onChange={(e) => patch({ thresholds: { ...draft.thresholds, [t.key]: number(e.target.value) } })}
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Alerts & retention" aside="Daily run, one environment only">
            <div className="divide-y">
              <div className="flex items-center justify-between gap-3 py-2.5">
                <Label htmlFor="a-new" className="space-y-0.5">
                  <span className="block font-semibold">Slack: new candidate</span>
                  <span className="block text-xs text-muted-foreground font-normal">One message when a name first passes the creator threshold</span>
                </Label>
                <Switch id="a-new" checked={draft.alerts.slackNewCandidate} onCheckedChange={(v) => patch({ alerts: { ...draft.alerts, slackNewCandidate: v } })} />
              </div>
              <div className="flex items-center justify-between gap-3 py-2.5">
                <Label htmlFor="a-sum" className="space-y-0.5">
                  <span className="block font-semibold">Slack: daily summary</span>
                  <span className="block text-xs text-muted-foreground font-normal">Counts only, after every run</span>
                </Label>
                <Switch id="a-sum" checked={draft.alerts.slackDailySummary} onCheckedChange={(v) => patch({ alerts: { ...draft.alerts, slackDailySummary: v } })} />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3 items-center py-2.5">
                <Label htmlFor="r-days" className="space-y-0.5">
                  <span className="block font-semibold">Delete readings after, days</span>
                  <span className="block text-xs text-muted-foreground font-normal">Post ids, names and counts</span>
                </Label>
                <Input id="r-days" type="number" min={1} max={365} value={shown(draft.retentionDays)} onChange={(e) => patch({ retentionDays: number(e.target.value) })} />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3 items-center py-2.5">
                <Label htmlFor="r-at" className="space-y-0.5">
                  <span className="block font-semibold">Run at (Israel time)</span>
                  <span className="block text-xs text-muted-foreground font-normal">Once a day, HH:MM</span>
                </Label>
                <Input id="r-at" value={draft.runAt} onChange={(e) => patch({ runAt: e.target.value })} placeholder="06:00" className={cn(!RUN_AT.test(draft.runAt) && "border-destructive")} />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
