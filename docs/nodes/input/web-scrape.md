# Web Scrape

> Fetch data from web pages, Google Search, Instagram, TikTok, or RSS feeds and emit structured JSON.

## Overview

The Web Scrape node retrieves data from external sources using configurable actors (scrapers). Choose from Google Search for keyword results, a content crawler for page or site Markdown, RSS for feed items, or Instagram/TikTok for post metadata. Output is a structured JSON array that you can pipe into Extract Field, JSON Process, or a List node for fan-out.

## When to Use

- Pull search results into a content generation pipeline
- Scrape a web page and feed its text to Generate Text for summarization
- Fetch recent Instagram or TikTok posts for analysis or remixing
- Combine with Schedule Trigger to run recurring data ingestion workflows

## Configuration

### Source (actor)

| Actor | Label | Description |
|-------|-------|-------------|
| `google-search` | Google Search | Returns up to 10 search-result items |
| `content-crawler` | Website Content (Markdown) | Crawls one page or an entire site; emits Markdown |
| `rss` | RSS Feed | Directly fetches and parses an RSS/Atom feed (no Apify) |
| `instagram` | Instagram | Retrieves posts from a profile or URL |
| `tiktok` | TikTok | Retrieves posts from a profile or URL |

### Google Search fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Query | text | — | Search query. Use `{}` to inject an upstream text value |
| Max results | number | 5 | How many results to return (1–10) |
| Country code | text | — | 2-letter ISO country code to localise results (e.g., `us`) |

### Website Content (Markdown) fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Start URL | text | — | URL of the page or site root. Use `{}` to inject upstream |
| Crawl mode | select | `page` | `Single page` (1 CR) — one URL; `Site crawl, up to 20 pages` (5 CR) |

### RSS fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Feed URL | text | — | URL of the RSS or Atom feed |
| Results limit | number | 10 | Maximum items to return (1–50). Emits `{ title, url, description, pubDate, guid }` per item |

### Instagram / TikTok fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Profile or post URL | text | — | Full URL of the profile or post. Use `{}` to inject upstream |
| Results limit | number | 10 | Maximum posts to return (1–20) |

## Inputs & Outputs

**Inputs:** Optional upstream connection (used when injecting a value into a field via `{}`).

**Outputs:** `json` — a structured JSON array of result items. Connect to Extract Field or JSON Process to reshape the data.

## Pricing

| SKU | Credits |
|-----|---------|
| Google Search | 3 CR |
| Content Crawler — single page | 1 CR |
| Content Crawler — site crawl | 5 CR |
| Instagram | 1 CR |
| TikTok | 1 CR |
| RSS | 1 CR |

## Common Use Cases

- Search Google for a keyword, extract the top titles, and feed each into a Generate Text node for article drafts
- Crawl a product page and pipe its Markdown to an LLM for structured data extraction
- Pull the latest Instagram posts from a brand account and batch-generate captions for remixes
- Use RSS + Schedule Trigger to build a fully automated daily newsletter pipeline

## Tips

- All actor fields support FieldMapping injection via `{}` so you can drive the query or URL from an upstream Text node.
- For site crawls, the crawler follows internal links up to 20 pages; use `Single page` when you only need one URL's content.
- RSS items contain `title`, `url`, `description`, `pubDate`, and `guid`. Use Extract Field with `title` to pull just the headlines.
- Chain an Extract Field node after Web Scrape to pull a specific property (e.g., `caption` from TikTok, `title` from Google results) before feeding a List node.
