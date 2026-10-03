---
node_type: instagram-scrape
generated_at: 2026-09-27T12:51:22.355Z
generated_from: c607aa02c
---

# Instagram

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `instagram-scrape`
**Category:** input
**Credit cost:** `20` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** `json`, `text`, `image`, `video`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `mode?: import("@nodaro/shared").InstagramScrapeMode`
- `targets?: string`
- `count?: number`
- `period?: import("@nodaro/shared").InstagramScrapePeriod`
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
  "label": "Instagram",
  "mode": "profile",
  "targets": "",
  "count": 20,
  "period": "30d"
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Pull PUBLIC Instagram posts (feed images, carousels, reels) by `mode`:
- `profile` — recent posts from account(s); `targets` is one username per line
  (`@` optional), up to 5.
- `hashtag` — recent posts under hashtag(s); `targets` is one hashtag per line
  (`#` optional), up to 5.

A source node (no upstream required); emits a JSON array of posts on `json`,
plus the FEATURED post's caption / image / video on the `text` / `image` /
`video` handles. Drive `targets` from the `in` input (one per line) to run it
from a Text / List node.

Optional per-post AI analysis: set `analyze: true` (optionally `analysisModel`
and `analysisFocus`) to attach a content-analyst `analysis` object to every
post — asset type, format, visual hooks, audiences, content angles, value, CTA,
summary.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **Pricing = 1 credit per REQUESTED post**, tiered on `count × sources` (each
  profile / hashtag is a source, max 5). AI analysis adds per-post by the
  model's tier, settled only for posts analysed. Keep `count` and the number of
  sources modest.
- **The period is honoured server-side** (unlike Meta's keyword search), so a
  narrow window returns fewer posts where the account/hashtag is quiet.
- **Media links expire.** Post image/video URLs are Instagram-signed; the node
  copies images + covers (and the featured video, or all videos with
  `ingestAllVideos`) into the user's library at scrape time. Consume or generate
  from them in the SAME run.
- **Format filter returns FEWER.** `formats` (`vertical` / `square` /
  `horizontal`) filters the posts.
- **Providers / keys.** Needs `APIFY_API_TOKEN`, or a connected nodaro.ai
  account (the run is relayed and billed there); AI analysis additionally needs
  an LLM key on a local run.
- **Async result.** A real scrape runs past the ~100s HTTP edge timeout, so the
  route returns `{ jobId, status: "pending" }` and finishes server-side. The
  workflow runner and the editor poll automatically; a direct caller reads the
  posts from the completed job's `output_data` (poll `GET /v1/jobs/:id`), or uses
  the SDK's `runAndWait`.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "instagram-scrape-1",
  "type": "instagram-scrape",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Instagram",
    "mode": "profile",
    "targets": "",
    "count": 20,
    "period": "30d"
  }
}
```
<!-- AUTO-GEN:END examples -->
