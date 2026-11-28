// Admin → Trend Radar → Settings: how many trends the daily run checks, the
// rules that make a video a trend, messages and timing, and where new names
// come from. Each rule reads as a sentence with its number in it. Edited as
// one draft and saved whole, only when something changed and everything is
// valid; whoever saves becomes the account the daily searches run as. While
// the draft is clean it follows the server (another admin's save shows up);
// once touched it stays until Save or Discard.

import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import type { TrendRadarReadingCost, TrendRadarSettings, TrendRadarSourceInput, TrendRadarSourceKind } from "@nodaro/sdk/trend-radar"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { budgetProblem } from "./daily-reading"
import { DailyReadingCard } from "./daily-reading-card"
import { formatWhen } from "./format"
import { Section } from "./parts"
import { radarUnavailable, useRadarSettings, useRadarSummary, useSaveRadarSettings } from "./use-trend-radar"

/** A source row in the draft: the input the server takes plus a client key that survives removals. */
type DraftSource = TrendRadarSourceInput & { key: string }
type Draft = Omit<TrendRadarSettings, "sources"> & { sources: DraftSource[] }

const KINDS: ReadonlyArray<{ key: TrendRadarSourceKind; label: string; hint: string }> = [
  { key: "sitemap", label: "Template site", hint: "A public sitemap, read once a day; a new page is a candidate name." },
  { key: "social", label: "Social", hint: "Public posts searched by name (the run's own search)." },
  { key: "suggest", label: "Search suggest", hint: "Confirmation only, never a source." },
]

/** The search budget has a section of its own, in trends and credits. */
type ThresholdKey = Exclude<keyof TrendRadarSettings["thresholds"], "dailySearchBudget">
/** Each rule reads as a sentence with its number in it; `label` names the number on its own (errors, screen readers). */
const THRESHOLDS: ReadonlyArray<{ key: ThresholdKey; label: string; before: string; after: string; min: number; step?: number }> = [
  { key: "minCreators", label: "People needed", before: "A video becomes a trend once at least", after: "different people have posted their own version of it.", min: 1 },
  { key: "windowDays", label: "Days to look back", before: "Only count versions posted in the last", after: "days.", min: 1 },
  { key: "risingPct", label: "Rising above, percent", before: "Mark a trend as rising when its views grow more than", after: "% in a day.", min: 0, step: 0.5 },
  { key: "slowingPct", label: "Slowing below, percent", before: "Mark it as slowing when its views grow less than", after: "% a day, two days in a row.", min: 0, step: 0.5 },
  { key: "maxClipSec", label: "Longest video, seconds", before: "Skip videos longer than", after: "seconds.", min: 1 },
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
function problemOf(d: Draft, reading: TrendRadarReadingCost | undefined): string | null {
  for (const t of THRESHOLDS) {
    const v = d.thresholds[t.key]
    if (!Number.isFinite(v) || v < t.min) return `${t.label} needs a number of at least ${t.min}.`
  }
  const budget = budgetProblem(d.thresholds.dailySearchBudget, reading)
  if (budget) return budget
  if (!Number.isFinite(d.retentionDays) || d.retentionDays < 1 || d.retentionDays > 365) return "Counts are kept between 1 and 365 days."
  if (!RUN_AT.test(d.runAt)) return "The run time is HH:MM, like 06:00."
  for (const s of d.sources) {
    if (s.name.trim() === "") return "Every source needs a name."
    if (s.kind === "sitemap" && !/^https:\/\/\S+$/.test(s.url ?? "")) return `${s.name.trim()}: a sitemap address starts with https://.`
  }
  return null
}

const number = (raw: string) => (raw.trim() === "" ? Number.NaN : Number(raw))
const shown = (n: number) => (Number.isNaN(n) ? "" : n)
const inline = "inline-flex h-9 w-[84px] mx-1.5 align-middle text-center"
const row = "py-3 text-sm leading-9"

function NumberInSentence({ id, label, value, onChange, min, max, step }: { id: string; label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number }) {
  return <Input id={id} aria-label={label} type="number" min={min} max={max} step={step ?? 1} className={inline} value={shown(value)} onChange={(e) => onChange(number(e.target.value))} />
}

export default function AdminTrendRadarSettingsPage() {
  const settings = useRadarSettings()
  const save = useSaveRadarSettings()
  const summary = useRadarSummary()
  const reading = summary.data?.reading
  const counts = summary.data?.counts
  const [draft, setDraft] = useState<Draft | null>(null)
  const seeded = useRef<string | null>(null)
  const saved = settings.data ? toDraft(settings.data) : null
  const dirty = draft !== null && saved !== null && JSON.stringify(toPatch(draft)) !== JSON.stringify(toPatch(saved))
  const problem = draft ? problemOf(draft, reading) : null

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
    <div className="p-6 mx-auto w-full max-w-5xl space-y-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/admin/trend-radar" className="hover:underline">Trend Radar</Link>
        <span>/</span>
        <span className="text-foreground">Settings</span>
      </div>
      <div className="sticky top-0 z-10 -mx-6 px-6 py-3 bg-background/95 backdrop-blur border-b flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Radar settings</h1>
          <p className="text-sm text-muted-foreground">{dirty ? "You have changes that are not saved yet." : "Nothing changes until you press Save."}</p>
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

      <DailyReadingCard
        step={1}
        budget={draft.thresholds.dailySearchBudget}
        onBudget={(dailySearchBudget) => patch({ thresholds: { ...draft.thresholds, dailySearchBudget } })}
        reading={reading}
        open={counts ? counts.candidates + counts.watching + counts.slowing : null}
      />

      <Section step={2} title="When does a video count as a trend" description="The rules the radar uses to decide what to show you. Change a number and the sentence changes with it.">
        <div className="divide-y">
          {THRESHOLDS.map((t) => (
            <p key={t.key} className={row}>
              {t.before}
              <NumberInSentence id={`t-${t.key}`} label={t.label} value={draft.thresholds[t.key]} min={t.min} step={t.step} onChange={(n) => patch({ thresholds: { ...draft.thresholds, [t.key]: n } })} />
              {t.after}
            </p>
          ))}
        </div>
      </Section>

      <Section step={3} title="Messages and timing" description="When the radar runs, what it tells you in Slack, and how long it keeps its numbers.">
        <div className="divide-y">
          <p className={row}>
            Run the radar every day at
            <Input id="r-at" aria-label="Run time, Israel time" value={draft.runAt} onChange={(e) => patch({ runAt: e.target.value })} placeholder="06:00" className={cn(inline, !RUN_AT.test(draft.runAt) && "border-destructive")} />
            Israel time.
          </p>
          <div className={cn(row, "flex items-center justify-between gap-3")}>
            <label htmlFor="a-new">Post in Slack when a new trend is found</label>
            <Switch id="a-new" checked={draft.alerts.slackNewCandidate} onCheckedChange={(v) => patch({ alerts: { ...draft.alerts, slackNewCandidate: v } })} />
          </div>
          <div className={cn(row, "flex items-center justify-between gap-3")}>
            <label htmlFor="a-sum">Post a short summary in Slack after every run</label>
            <Switch id="a-sum" checked={draft.alerts.slackDailySummary} onCheckedChange={(v) => patch({ alerts: { ...draft.alerts, slackDailySummary: v } })} />
          </div>
          <p className={row}>
            Delete the daily counts (which posts, who posted, how many views) after
            <NumberInSentence id="r-days" label="Days to keep counts" value={draft.retentionDays} min={1} max={365} onChange={(n) => patch({ retentionDays: n })} />
            days.
          </p>
        </div>
      </Section>

      <Section step={4} title="Where the radar finds new names" description="Sites it reads every morning to spot new trend names. The people and views behind each name are then counted by searching the social platforms.">
        <div className="flex justify-end mb-2">
          <Button size="sm" variant="outline" onClick={addSource}>
            <Plus className="h-4 w-4 me-1" />Add source
          </Button>
        </div>
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
      </Section>
    </div>
  )
}
