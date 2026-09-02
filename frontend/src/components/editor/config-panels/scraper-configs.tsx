"use client"

import { useState } from "react"
import { Copy, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { SCRAPER_ACTOR_LABELS, type ScraperActorId } from "@nodaro/shared"
import { useT, tx } from "@/lib/i18n"
import type { WebScrapeNodeData } from "@/types/nodes"
import {
  WEB_SCRAPE_PEEK,
  webScrapeItemLink,
  relativeTime,
  webScrapeItems,
  webScrapePeekLine,
} from "@/components/nodes/web-scrape-run-state"
import { MappableField } from "./mappable-field"
import { formatCreditUnits } from "@/lib/credit-units"
import type { ConfigProps } from "./types"

// Ordered so google-search sits first as the default, followed by the others.
const ACTOR_OPTIONS: ReadonlyArray<ScraperActorId> = [
  "google-search",
  "content-crawler",
  "rss",
  "instagram",
  "tiktok",
]

// Cleared on actor switch so old values don't resurface when switching back.
const ACTOR_FIELD_KEYS = ["query", "maxResults", "countryCode", "url", "mode", "target", "resultsLimit"] as const

/**
 * The panel gains a Results tab (#765) — the card's count row is the entry
 * point; a modal would block the graph and expand-in-place breaks a canvas
 * arranged by hand. Opens on RESULTS once a run has finished, on CONFIG
 * before that — no new plumbing: the default derives from run state.
 */
export function WebScrapeConfig(props: ConfigProps<WebScrapeNodeData>) {
  const t = useT()
  const hasRun = props.data.lastRunOutcome !== undefined || props.data.generatedJson !== undefined
  return (
    // key: the panel stays mounted across open/close, so defaultValue alone
    // would freeze on whatever run state existed at FIRST mount — the key
    // remounts the tabs when run state flips, honoring "opens on Results
    // once a run has finished".
    <Tabs key={hasRun ? "has-run" : "no-run"} defaultValue={hasRun ? "results" : "config"} className="flex flex-col gap-3">
      <TabsList className="grid w-full grid-cols-2 h-8">
        <TabsTrigger value="config" className="text-xs">{t("cfgext.reduceTabConfig")}</TabsTrigger>
        <TabsTrigger value="results" className="text-xs">{t("cfgext.scrapeResultsTab")}</TabsTrigger>
      </TabsList>
      <TabsContent value="config">
        <WebScrapeConfigTab {...props} />
      </TabsContent>
      <TabsContent value="results">
        <WebScrapeResultsTab data={props.data} />
      </TabsContent>
    </Tabs>
  )
}

// Exported for tests — rendered only inside WebScrapeConfig's Results tab.
export function WebScrapeResultsTab({ data }: { readonly data: WebScrapeNodeData }) {
  const t = useT()
  const [view, setView] = useState<"list" | "json">("list")
  const actor: ScraperActorId = data.actor ?? "google-search"
  const peek = WEB_SCRAPE_PEEK[actor]
  const items = webScrapeItems(data.generatedJson)
  const json = data.generatedJson === undefined ? "" : JSON.stringify(data.generatedJson, null, 2)
  const sizeKb = json ? (new Blob([json]).size / 1024).toFixed(1) : "0"

  if (data.generatedJson === undefined) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        {t("cfgext.scrapeNoResults")}
      </p>
    )
  }

  const copyJson = () => {
    void navigator.clipboard.writeText(json).then(
      () => toast.success(tx("cfgext.scrapeJsonCopied")),
      () => toast.error(tx("cfgext.scrapeCopyFailed")),
    )
  }
  const downloadJson = () => {
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "web-scrape-results.json"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <Button variant={view === "list" ? "secondary" : "ghost"} size="sm" className="h-6 px-2 text-xs" onClick={() => setView("list")}>{t("cfgext.scrapeViewList")}</Button>
          <Button variant={view === "json" ? "secondary" : "ghost"} size="sm" className="h-6 px-2 text-xs" onClick={() => setView("json")}>{t("cfgext.scrapeViewJson")}</Button>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={copyJson} title={t("cfgext.scrapeCopyJson")}>
            <Copy className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={downloadJson} title={t("cfgext.scrapeDownloadJson")}>
            <Download className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div className="text-[10px] text-muted-foreground flex items-center justify-between">
        <span>
          {peek.countNoun === "pages"
            ? t("cfgext.scrapeCountPages", { count: items.length })
            : t("cfgext.scrapeCountResults", { count: items.length })}
          {data.lastGoodAt ? ` · ${relativeTime(data.lastGoodAt)}` : ""}
        </span>
        <span>{sizeKb} KB</span>
      </div>
      {view === "list" ? (
        <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto pe-1">
          {items.map((item, i) => {
            const sub =
              actor === "google-search" ? item.url
              : actor === "rss" ? item.pubDate
              : undefined
            // The item's own address (#779) — only http(s) ever links; a hostile
            // feed's javascript:/data: value renders as text.
            const href = webScrapeItemLink(actor, item)
            const title = webScrapePeekLine(actor, item)
            return (
              <div key={i} className="flex flex-col border-b border-border/40 pb-1.5 min-w-0">
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span className="w-[16px] shrink-0 text-[10px] text-muted-foreground/70 text-end">{peek.glyph(item, i)}</span>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="truncate text-xs hover:underline" title={href}>{title}</a>
                  ) : (
                    <span className="truncate text-xs">{title}</span>
                  )}
                </div>
                {typeof sub === "string" && sub && (
                  href && sub.trim() === href ? (
                    // Same destination as the title link — out of the tab order so
                    // keyboard users are not handed the same link twice per row.
                    <a href={href} target="_blank" rel="noopener noreferrer" tabIndex={-1} className="ps-[22px] truncate text-[10px] text-muted-foreground/70 hover:underline hover:text-muted-foreground">{sub}</a>
                  ) : (
                    <span className="ps-[22px] truncate text-[10px] text-muted-foreground/70">{sub}</span>
                  )
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <pre className="text-[10px] bg-muted/40 rounded-md p-2 max-h-[50vh] overflow-auto whitespace-pre-wrap break-all">{json}</pre>
      )}
    </div>
  )
}

function WebScrapeConfigTab({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<WebScrapeNodeData>) {
  const t = useT()
  const actor: ScraperActorId = data.actor ?? "google-search"

  // SCRAPER_ACTOR_LABELS lives in @nodaro/shared (wire contract, shared with
  // the node card), so the two non-brand entries are localized here at the
  // render site rather than by editing the shared table.
  const actorLabel = (id: ScraperActorId): string =>
    id === "content-crawler" ? t("cfgext.scrapeActorContentCrawler")
    : id === "rss" ? t("cfgext.scrapeActorRss")
    : SCRAPER_ACTOR_LABELS[id]

  const handleActorChange = (v: string) => {
    const next = v as ScraperActorId
    if (next === actor) return
    const patch: Record<string, unknown> = { actor: next }
    for (const key of ACTOR_FIELD_KEYS) patch[key] = undefined
    onUpdate(patch)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Actor */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="scraper-actor">{t("inputcfg.source")}</Label>
        <Select
          value={actor}
          onValueChange={handleActorChange}
        >
          <SelectTrigger id="scraper-actor" className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTOR_OPTIONS.map((id) => (
              <SelectItem key={id} value={id}>
                {actorLabel(id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Google Search */}
      {actor === "google-search" && (
        <>
          <MappableField field="query" label={t("cfgext.scrapeQuery")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Input
              id="scraper-query"
              value={data.query ?? ""}
              onChange={(e) => onUpdate({ query: e.target.value })}
              placeholder={t("cfgext.scrapeQueryPh")}
              className="text-sm"
            />
          </MappableField>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scraper-max-results">{t("cfgext.scrapeMaxResults")}</Label>
            <Input
              id="scraper-max-results"
              type="number"
              min={1}
              max={10}
              value={data.maxResults ?? 5}
              onChange={(e) =>
                onUpdate({ maxResults: parseInt(e.target.value, 10) || 5 })
              }
              className="text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scraper-country">{t("cfgext.scrapeCountryCode")}</Label>
            <Input
              id="scraper-country"
              value={data.countryCode ?? ""}
              onChange={(e) =>
                onUpdate({ countryCode: e.target.value.toLowerCase().slice(0, 2) })
              }
              placeholder="us"
              maxLength={2}
              className="text-sm uppercase"
            />
          </div>
        </>
      )}

      {/* Content Crawler */}
      {actor === "content-crawler" && (
        <>
          <MappableField field="url" label={t("cfgext.scrapeStartUrl")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Input
              id="scraper-url"
              value={data.url ?? ""}
              onChange={(e) => onUpdate({ url: e.target.value })}
              placeholder={t("cfgext.scrapeUrlPh")}
              className="text-sm"
            />
          </MappableField>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scraper-mode">{t("cfgext.scrapeCrawlMode")}</Label>
            <Select
              value={data.mode ?? "page"}
              onValueChange={(v) => onUpdate({ mode: v as "page" | "site" })}
            >
              <SelectTrigger id="scraper-mode" className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="page">{t("cfgext.scrapeSinglePage", { units: formatCreditUnits(3) })}</SelectItem>
                <SelectItem value="site">{t("cfgext.scrapeSiteCrawl", { units: formatCreditUnits(10) })}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {/* RSS — direct fetch + XML parse, no Apify */}
      {actor === "rss" && (
        <>
          <MappableField field="url" label={t("inputcfg.feedUrl")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Input
              id="scraper-rss-url"
              value={data.url ?? ""}
              onChange={(e) => onUpdate({ url: e.target.value })}
              placeholder="https://feeds.feedburner.com/TechCrunch"
              className="text-sm"
            />
          </MappableField>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scraper-rss-limit">{t("cfgext.scrapeResultsLimit")}</Label>
            <Input
              id="scraper-rss-limit"
              type="number"
              min={1}
              max={50}
              value={data.resultsLimit ?? 10}
              onChange={(e) =>
                onUpdate({ resultsLimit: parseInt(e.target.value, 10) || 10 })
              }
              className="text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              {t("cfgext.scrapeRssHint", { fields: "{ title, url, description, pubDate, guid }" })}
            </p>
          </div>
        </>
      )}

      {/* Instagram / TikTok */}
      {(actor === "instagram" || actor === "tiktok") && (
        <>
          <MappableField field="target" label={t("cfgext.scrapeTarget")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Input
              id="scraper-target"
              value={data.target ?? ""}
              onChange={(e) => onUpdate({ target: e.target.value })}
              placeholder={
                actor === "instagram"
                  ? t("cfgext.scrapeInstagramPh")
                  : t("cfgext.scrapeTiktokPh")
              }
              className="text-sm"
            />
          </MappableField>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scraper-results-limit">{t("cfgext.scrapeResultsLimit")}</Label>
            <Input
              id="scraper-results-limit"
              type="number"
              min={1}
              max={20}
              value={data.resultsLimit ?? 10}
              onChange={(e) =>
                onUpdate({ resultsLimit: parseInt(e.target.value, 10) || 10 })
              }
              className="text-sm"
            />
          </div>
        </>
      )}
    </div>
  )
}
