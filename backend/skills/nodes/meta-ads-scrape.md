---
node_type: meta-ads-scrape
generated_at: 2026-09-27T12:51:22.331Z
generated_from: c607aa02c
---

# Meta Ads

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `meta-ads-scrape`
**Category:** input
**Credit cost:** `20` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** `json`, `text`, `image`, `video`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `mode?: import("@nodaro/shared").MetaAdsNodeMode`
- `query?: string`
- `pageUrls?: string`
- `advertisers?: import("@nodaro/shared").MetaAdsAdvertiser[]`
- `count?: number`
- `period?: import("@nodaro/shared").MetaAdsScrapePeriod`
- `activeStatus?: import("@nodaro/shared").MetaAdsScrapeStatus`
- `countryCode?: string`
- `platforms?: string[]`
- `formats?: string[]`
- `featuredIndex?: number`
- `viewFormat?: string`
- `ingestAllVideos?: boolean`
- `analyze?: boolean`
- `analysisModel?: string`
- `analysisFocus?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedJson?: unknown`
- `lastRunOutcome?: "success" | "empty" | "failed"`
- `lastRunAt?: number`
- `lastRunCount?: number`
- `lastRunStartedAt?: number`
- `lastRunFingerprint?: string`
- `lastGoodAt?: number`
- `lastGoodCount?: number`

**Default data:**
```json
{
  "label": "Meta Ads",
  "mode": "search",
  "query": "",
  "count": 20,
  "period": "30d",
  "activeStatus": "active",
  "countryCode": "ALL"
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Pull PUBLIC Facebook + Instagram ads from Meta's Ad Library — competitor ad
research, seeding a creative pipeline with real ad copy / CTAs / visuals, or a
recurring ad-intelligence digest. A source node (no upstream required); emits a
JSON array of ads on `json`, plus the FEATURED ad's copy / image / video on the
`text` / `image` / `video` handles.

Three ways to target ads via `mode`:
- `search` — keyword full-text search across the Ad Library (`query`). Matches
  words INSIDE the ads, NOT the advertiser.
- `advertiser` — advertisers picked by name. In the editor the user picks a
  Page; when built programmatically, drive it from the `in` input instead: put
  one advertiser name per line / comma-separated on the upstream text and the
  run resolves each to a Facebook Page (verified match first). `advertisers` (the
  picked-Page array) is an editor convenience; a generated workflow should use
  `mode: "advertiser"` + an upstream text node.
- `pages` — explicit Facebook Page URLs (`pageUrls`, one per line, up to 5).

Optional per-ad AI analysis: set `analyze: true` (optionally `analysisModel`, an
image-capable model, and `analysisFocus`) to attach an `analysis` object to every
ad — asset type, format, visual hooks, audiences, graphic identity, copywriting
hooks, USPs, CTA, summary.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **`{}` / `in` input.** In `search` mode the upstream text is the keyword; in
  `pages` mode it is the Page URLs (one per line); in `advertiser` mode it is the
  advertiser name(s) to resolve. `advertisers` picks are ignored when the input
  drives the run.
- **Pricing = 1 credit per REQUESTED ad**, tiered on `count × sources` (a search
  is 1 source; each Page URL / resolved advertiser is a source, max 5). AI
  analysis adds per-ad by the model's tier and is settled only for ads actually
  analysed. So `count` and the number of sources set the cost — a generated
  workflow should keep both modest.
- **Media links expire.** Ad image/video URLs are Meta-signed and die within
  days; the node copies images + posters (and the featured video, or all videos
  with `ingestAllVideos`) into the user's library at scrape time. Consume or
  generate from them in the SAME run rather than storing the raw URLs.
- **Format filter returns FEWER.** `formats` (`vertical` / `square` /
  `horizontal`, classified from real pixels) filters the ADS, so a run may return
  fewer than `count`.
- **Long runs.** Copying every video and analysing every ad runs past the ~100 s
  HTTP edge timeout. The workflow runner and the editor handle this on their own.
  A direct API caller should send `respondAsync: true`: the route then answers
  `{ jobId, status: "pending" }` at once and finishes server-side, and the ads are
  read from the completed job's `output_data` (poll `GET /v1/jobs/:id`). Without
  the flag the request is held open and the result comes back in the body — fine
  for a small search, cut off at the edge for a long run even though the job
  completes and is charged.
- **Providers / keys.** Needs `APIFY_API_TOKEN`, or a connected nodaro.ai account
  (the run — scrape, advertiser resolution and analysis — is relayed and billed
  there); AI analysis additionally needs an LLM key (KIE / Anthropic / Gemini) on
  a local run. Without either, the node fails honestly with a message.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "meta-ads-scrape-1",
  "type": "meta-ads-scrape",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Meta Ads",
    "mode": "search",
    "query": "",
    "count": 20,
    "period": "30d",
    "activeStatus": "active",
    "countryCode": "ALL"
  }
}
```
<!-- AUTO-GEN:END examples -->
