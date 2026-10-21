# Meta Ads

> Pull public Facebook and Instagram ads from Meta's Ad Library by keyword or Facebook Page and emit structured JSON (copy, CTA, images, videos).

## Overview

The Meta Ads node searches Meta's public Ad Library — the same archive you can browse at facebook.com/ads/library — and returns the matching ads as a JSON array. Each ad carries the advertiser's Page, the ad copy, headline, call-to-action, landing link, image and video URLs, run dates and whether it is still active. Pipe the array into Extract Field, JSON Process or a List node to fan out, or straight into a Generate Text node for competitive analysis.

## When to Use

- Research how competitors advertise a product category (keyword search)
- Track a specific brand's latest creatives (Facebook Page URLs)
- Seed a creative pipeline with real ad copy and visuals, then remix them
- Combine with Schedule Trigger for a recurring ad-intelligence digest

## Configuration

### Search by

| Mode | Input | Description |
|------|-------|-------------|
| `search` (Keyword) | Keyword | Full-text search across the Ad Library — words **inside** the ads, not the advertiser (up to 100 characters). Use `{}` to inject an upstream text value |
| `advertiser` (Advertiser) | Advertiser picks | Type an advertiser's name, press **Find**, and pick the right Facebook Page from the matches (avatar, name, verified badge — the verified one is usually it), up to 5. The run pulls only those advertisers' ads. The lookup itself costs no credits (10 per minute). You can also drive it from the input: connect a Text / List node and each upstream line is resolved to a Page at run time (the verified match, else the first), reported back in `resolvedAdvertisers` |
| `pages` (Facebook pages) | Facebook Page URLs | One Page address per line, up to 5 (`https://www.facebook.com/nike`; `https://` is optional). An advertiser's Ad Library link works here too. Use `{}` to inject an upstream list |

Advertiser picks run exactly like Facebook Pages — each pick is one source for pricing (below), and the API only knows `search` and `pages`: the editor sends a pick as its Page URL. When advertiser mode is driven from the input instead of explicit picks, the names are resolved at run time, so the number of sources (and the exact credit total) is known only when the node runs — the on-card estimate assumes one source until then.

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Ads per source | number | 20 | How many ads to return per keyword / per Page (1–100) |
| Period | select | Last 30 days | `Last 24 hours`, `Last 7 days`, `Last 30 days` or `All time`, by the ad's start date |
| Ad status | select | Active | `Active`, `Inactive` or `All` |
| Country | select | All countries | `ALL`, or a 2-letter country code (e.g. `US`) to restrict where the ads were delivered |
| Platforms | toggles | none (no filter) | Keep only ads delivered on the selected platforms — Facebook, Instagram, Audience Network, Messenger, WhatsApp, Threads. No selection (or all six) means no filter |
| Creative format | toggles | none (no filter) | Keep only ads whose creative is `vertical` (phone — Stories, Reels, mobile feed; width/height below 0.95), `square` (within ±5 % of 1:1) or `horizontal` (web / feed — above 1.05), classified from the creative's actual pixels. Fewer ads than requested may come back |
| AI analysis | toggle + model + focus | off | Run an "expert competitor ad analyst" pass on every returned ad — asset type, format, visual hooks, audiences, graphic identity, copywriting hooks, USPs, CTA and a summary. Pick any image-capable analysis model (default: Gemini 3.6 Flash) and an optional focus line. Each analysis is charged for the tokens it used at the model's rate; an ad the run never analysed costs nothing — see the AI analysis add-on under Pricing |

After a run the node card features one ad — creative preview, advertiser, headline, copy, format, platforms, run dates and call-to-action — with a thumbnail strip and ‹ › to move between the returned ads; the **Results** tab lists them all (List / Grid / Raw JSON), filters them by format, and clicking a row features it on the card.

## Creatives in your library

Meta's image and video links are signed and expire within days, so after every run the node copies each returned ad's images and video posters into your library (they count towards your storage; they stay out of the media picker until you press **Save to library** on an ad). The featured ad's video is copied too, but only when the node's **video** output is wired — videos are the expensive bytes. Turn on **Copy all videos to your library** to copy every returned ad's video (they count towards your storage). When storage is full, or on an install without media storage, the ads keep their original Meta links instead, and the run still succeeds.

Each ad carries a `format` and a `creatives` array (`kind`, `url`, `sourceUrl`, `width`, `height`, `format`, `assetId`, `stored`) alongside the `images` / `videos` / `videoPreviews` urls, which point at your library once stored.

## Results

After a run, the node card peeks at the first few ads (advertiser — first words of the copy) and the settings panel's **Results** tab lists them all, with status, start date and media counts, plus a Raw JSON view, copy and download. Every row links to the ad's own Ad Library page and opens in a new tab.

A run that returns nothing, or fails, keeps the previous good results on the node; changing any input marks those results as stale until the next run.

Creatives that could not be copied into your library (storage full, or an install without media storage) keep their Meta CDN links, which expire after a while — download or generate from them in the same workflow rather than storing those links.

## Inputs & Outputs

**Inputs:** `in` (optional) — upstream text: a keyword in `search` mode, or Page URLs (one per line) in `pages` mode. Advertiser picks are explicit (the `in` text is ignored in `advertiser` mode).

**Outputs:**

| Handle | Carries |
|--------|---------|
| `json` | the whole array of ads (below) — fan out with a List node |
| `text` | the featured ad's headline + body copy |
| `image` | the featured ad's first image (or its video poster) |
| `video` | the featured ad's first video |

The featured ad is the one shown on the card (thumbnail strip, ‹ ›, or a Results row click). A workflow run features the first returned ad; "Run from here" reuses the ad featured on the saved node without scraping again.

The `json` handle emits an array of ads, each shaped as:

```json
{
  "adArchiveId": "866569929827744",
  "adLibraryUrl": "https://www.facebook.com/ads/library/?id=866569929827744",
  "pageName": "Nike",
  "pageId": "15087023444",
  "startDate": "2026-09-01T07:00:00.000Z",
  "endDate": null,
  "isActive": true,
  "platforms": ["FACEBOOK", "INSTAGRAM"],
  "text": "Just do it.",
  "title": "Air Max",
  "caption": "nike.com",
  "ctaText": "Shop now",
  "linkUrl": "https://nike.com/airmax",
  "images": ["https://…/creative.jpg"],
  "videos": ["https://…/creative.mp4"],
  "videoPreviews": ["https://…/poster.jpg"],
  "collationCount": 3,
  "analysis": {
    "assetType": "static",
    "format": "in-feed",
    "visualHooks": ["product close-up", "big bold number"],
    "audiences": ["runners", "value shoppers"],
    "graphicIdentity": "Black-on-white, large sans headline, logo top-left.",
    "copywritingHooks": ["urgency: 'last day'"],
    "usps": ["free returns"],
    "cta": "Shop now",
    "summary": "Sells running shoes to value-conscious runners with a last-day urgency hook."
  }
}
```

The `analysis` object is present only when AI analysis was on and that ad was analysed (see the AI analysis add-on under Pricing).

## Pricing

**1.1 credits<!-- credits-rate: meta-ads-scrape:10@0.1 --> per requested ad**, rounded up to the next tier of the requested total (`Ads per source × number of sources`; a keyword search is one source). These are the prices a run is charged on Nodaro Cloud; the node's Run button, and `GET /v1/models` / the MCP `list_models` tool, show the price your instance charges.

| Requested total | Credits |
|-----------------|---------|
| up to 10 | 11 CR<!-- credits: meta-ads-scrape:10 --> |
| up to 20 | 22 CR<!-- credits: meta-ads-scrape:20 --> |
| up to 50 | 55 CR<!-- credits: meta-ads-scrape:50 --> |
| up to 100 | 110 CR<!-- credits: meta-ads-scrape:100 --> |
| up to 200 | 220 CR<!-- credits: meta-ads-scrape:200 --> |
| up to 500 | 550 CR<!-- credits: meta-ads-scrape:500 --> |

Worked examples:

- Keyword search, 20 ads per source → total 20 → **22 CR**<!-- credits: meta-ads-scrape:20 -->
- 2 Facebook Pages, 30 ads per Page → total 60 → **110 CR**<!-- credits: meta-ads-scrape:100 -->
- 2 advertisers picked by name, 30 ads each → total 60 → **110 CR**<!-- credits: meta-ads-scrape:100 --> (a pick is a source, like a Page)
- 5 Facebook Pages, 100 ads per Page → total 500 → **550 CR**<!-- credits: meta-ads-scrape:500 -->

Credits are charged for the requested batch; a narrow period or a quiet keyword may return fewer ads than requested. A keyword search over a window is sorted most-recent-first and over-fetched (more for tighter windows) so the period filter still fills the count where the ads exist.

### AI analysis add-on

Turning on **AI analysis** adds one LLM call per analysed ad — its frame and copy, your focus, and the analysis it writes — charged for the tokens it actually used at the analysis model's rate on the lane that served it ([LLM model rates](../../pricing/llm-models.md)). A run's analyses are added up and charged once, on top of the scrape's own price, as one charge. A typical analysis on the default model, Gemini 3.6 Flash, is estimated at ~4 credits<!-- credits: meta-ads-analysis:gemini-3.6-flash -->; Gemini 4 Argon runs only on its provider's own API and is charged at that lane's rate.

- **Before the run** a hold is reserved: the scrape's price plus a typical analysis per requested ad. A balance below it is refused before anything runs (`402`, "Needs up to N credits").
- **After the run** it is charged the scrape's price plus what the analyses used. An ad the run never analysed (the batch came back short, or a long run hit its time budget) costs nothing; an analysis the provider billed is charged even when it failed.
- **A failed run** refunds the scrape's price; analyses the provider had already billed are still charged.

Example: 20 ads on Gemini 3.6 Flash, each analysis about 1,500 tokens in and 400 out (30,000 in and 8,000 out in all) → 22<!-- credits-rate: meta-ads-scrape:20 --> for the scrape + 18<!-- credits-llm-rate: gemini-3.6-flash:kie@30000/8000 --> for the analyses = **40 CR**<!-- credits: n/a -->.

The analysis rides inside each ad in the `json` output (an `analysis` object) and shows on each row in the **Results** tab.

## Long runs and the API

A run that copies every video into the library and analyses every ad routinely takes longer than the ~100-second limit on a single HTTP request. In the editor and in a workflow there is nothing to do: both ask for a job and wait for it, and the ads appear on the node when the run lands. Reopening a workflow after a run finished in the background shows its result too.

A direct API caller chooses how the answer comes back:

- **Job id first (use this for anything beyond a small search).** Send `"respondAsync": true` in the body. The route answers `{ "jobId": "…", "status": "pending" }` at once and finishes on the server; read the ads from the completed job's `output_data` (`GET /v1/jobs/:id`, or `client.jobs.get(jobId)` in the SDK). The `json` array, the featured `text` / `imageUrl` / `videoUrl`, `mediaStorage`, `resolvedAdvertisers` and any `analysis` all live there.
- **Held response (the default).** Without the flag the request stays open until the run is done and the same fields come back in the response body beside `jobId`. A run that outlasts the request limit is cut off on the way back even though the job completes and is charged — its result is still on the job.

## Common Use Cases

- Search a product keyword, extract each ad's `text`, and feed them to Generate Text for a positioning summary
- Track three competitor Pages weekly and post the new creatives to a review channel
- Pull a brand's active video ads and use `videoPreviews` as reference frames for new concepts

## Tips

- Keyword and Page URL fields support FieldMapping injection via `{}`, so a Text or List node can drive the search.
- Use `Ad status: Inactive` with a long period to study creatives an advertiser has already retired.
- Chain an Extract Field node with `images` or `text` before a List node to fan out one generation per ad.
