"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SCRAPER_ACTOR_LABELS, type ScraperActorId } from "@nodaro-shared/scraper-actors"
import type { WebScrapeNodeData } from "@/types/nodes"
import { MappableField } from "./mappable-field"
import type { ConfigProps } from "./types"

// Ordered so google-search sits first as the default, followed by the others.
const ACTOR_OPTIONS: ReadonlyArray<ScraperActorId> = [
  "google-search",
  "content-crawler",
  "instagram",
  "tiktok",
]

export function WebScrapeConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<WebScrapeNodeData>) {
  const actor: ScraperActorId = data.actor ?? "google-search"

  return (
    <div className="flex flex-col gap-3">
      {/* Actor */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="scraper-actor">Source</Label>
        <Select
          value={actor}
          onValueChange={(v) => onUpdate({ actor: v as ScraperActorId })}
        >
          <SelectTrigger id="scraper-actor" className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTOR_OPTIONS.map((id) => (
              <SelectItem key={id} value={id}>
                {SCRAPER_ACTOR_LABELS[id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Google Search */}
      {actor === "google-search" && (
        <>
          <MappableField field="query" label="Query" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Input
              id="scraper-query"
              value={data.query ?? ""}
              onChange={(e) => onUpdate({ query: e.target.value })}
              placeholder="e.g. ai news today (use {} to inject input)"
              className="text-sm"
            />
          </MappableField>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scraper-max-results">Max results</Label>
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
            <Label htmlFor="scraper-country">Country code</Label>
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
          <MappableField field="url" label="Start URL" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Input
              id="scraper-url"
              value={data.url ?? ""}
              onChange={(e) => onUpdate({ url: e.target.value })}
              placeholder="https://example.com (use {} to inject input)"
              className="text-sm"
            />
          </MappableField>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scraper-mode">Crawl mode</Label>
            <Select
              value={data.mode ?? "page"}
              onValueChange={(v) => onUpdate({ mode: v as "page" | "site" })}
            >
              <SelectTrigger id="scraper-mode" className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="page">Single page (3 CR)</SelectItem>
                <SelectItem value="site">Site crawl, up to 20 pages (10 CR)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {/* Instagram / TikTok */}
      {(actor === "instagram" || actor === "tiktok") && (
        <>
          <MappableField field="target" label="Profile or post URL" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
            <Input
              id="scraper-target"
              value={data.target ?? ""}
              onChange={(e) => onUpdate({ target: e.target.value })}
              placeholder={
                actor === "instagram"
                  ? "https://instagram.com/nasa (use {} to inject input)"
                  : "https://tiktok.com/@username (use {} to inject input)"
              }
              className="text-sm"
            />
          </MappableField>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scraper-results-limit">Results limit</Label>
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
