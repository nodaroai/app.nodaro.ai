# Site Capture

> Capture a web page the way a phone shows it: section stills in page order, a full-page image, the section map and the page's exact figures.

## Overview

The Site Capture node loads one web page in a phone browser (412 CSS px wide), scrolls it so content that appears as you scroll is painted, and shoots each of its main sections — the hero, features, pricing, reviews — as a phone-card shaped still (about 1082 × 1286 px). It also returns the whole page as one image, a map of the page's sections, and the exact figures the page writes (prices, counts, ratings). It is the same capture as `POST /v1/site-capture` and the MCP tool `capture_site`.

## When to Use

- Put a real product page on screen in a video: a UGC-style talking head with the site's sections as overlay cards
- Feed each section to Image to Text, or animate each still, with an **Each** wire
- Hand every still to Slideshow or Image Collage with a **Bundle** wire
- Read a page's exact prices and numbers (the capture's `facts`) into a script, instead of reading them off pixels

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Page | text | — | The page to capture, as typed in a browser (`https://` is optional). Leave it empty to take the first web address in the text wired into the input. Mappable |
| Stills | number | 8 | How many section stills to aim for, 3 to 8. A page with fewer sections gives fewer |

## Inputs & Outputs

**Inputs:**

| Handle | Accepts | Description |
|--------|---------|-------------|
| `in` (Page URL) | Text, a list, JSON | Used when **Page** is empty: the first web address in the text. On an **Each** wire from a list of addresses, one capture runs per address |

**Outputs:**

| Handle | Type | Description |
|--------|------|-------------|
| `image` (Stills) | image | The section stills, in page order. A plain wire hands on the first still; an **Each** wire runs the next node once per still; a **Bundle** wire hands on all of them. The full-page image is never one of them |
| `json` | data | The whole capture (below), as text for a Text or Prompt consumer and as JSON for Extract Field |

The capture on `json`:

```json
{
  "pageUrl": "https://example.com/",
  "finalUrl": "https://www.example.com/",
  "title": "Example — the product",
  "lang": "en",
  "dir": "ltr",
  "device": { "width": 412, "height": 915, "dpr": 2.625 },
  "fullPage": { "url": "https://…/full.jpg", "width": 412, "height": 6420, "truncated": false },
  "stills": [{ "index": 0, "sectionOrder": 0, "label": "Ship faster", "category": "hero", "url": "https://…/0.png", "width": 1082, "height": 1286 }],
  "sections": [{ "order": 0, "label": "Ship faster", "category": "hero", "kind": "key", "rect": { "x": 0, "y": 0, "width": 412, "height": 900 }, "text": "…", "stillIndex": 0 }],
  "facts": ["$12 per month", "4.8/5", "10,000 teams"],
  "usableStills": 1,
  "warnings": [],
  "source": "local"
}
```

A section's `category` is `hero`, `feature`, `pricing`, `proof`, `faq`, `cta` or `other`. `warnings` explains a thin capture: `sections_below_minimum` (fewer than 3 stills), `still_blank_skipped:<section>` (a still that rendered blank was dropped), `still_hidden_skipped:<section>` (a section whose heading never showed was skipped), `stills_time_budget`, `consent_overlay_left`, `full_page_truncated` (a page taller than 20,000 px).

## Credit Cost

**11 credits**<!-- credits: site-capture --> per capture, flat, whatever the number of stills. A capture that fails — the page walls the visit (a bot challenge, or an answer of 403 or 429), shows nothing, cannot be reached, or the capture times out — is refunded. A page whose robots.txt disallows the visit, or that cannot be resolved, is refused before any charge.

## Tips

- A capture takes up to a few minutes (usually under one). The node shows the elapsed time while it runs; a run can be stopped.
- Some sites refuse automated visits. When a page walls the capture, upload your own screenshots instead.
- The stills are stored in your library, hidden from the media picker until you save one.

## Availability

Site Capture is available where capture is enabled on the install (`SITE_CAPTURE_ENABLED`, on by default; see [Deployment](../../deployment.md)). Where it is off, the node is not offered and its route answers 404. On a self-hosted install it needs an Apify token, or a connection to Nodaro Cloud, which then runs the capture.

## Related Nodes

- [Web Scrape](./web-scrape.md) — a page's text as Markdown, search results, feeds
- [Image to Text](../ai-image/image-to-text.md) — describe each still
- [Slideshow](../processing-video/slideshow.md) — the stills as a video
- [Extract Field](../utility/extract-field.md) — pull `facts` or a section's text out of the capture
