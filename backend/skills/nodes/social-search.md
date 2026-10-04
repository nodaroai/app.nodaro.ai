---
node_type: social-search
generated_at: 2026-10-02T00:13:07.919Z
generated_from: 9efb4473c
---

# Social Search

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `social-search`
**Category:** input
**Credit cost:** `20-60` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** `json`, `text`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `platform?: import("@nodaro/shared").SocialPlatform`
- `mode?: import("@nodaro/shared").SocialSearchMode`
- `query?: string`
- `count?: import("@nodaro/shared").SocialSearchCount`
- `period?: import("@nodaro/shared").SocialSearchPeriod`
- `sort?: import("@nodaro/shared").SocialSearchSort`
- `region?: string`
- `country?: string`
- `activeOnly?: boolean`
- `subreddit?: string`
- `videoKind?: import("@nodaro/shared").SocialSearchVideoKind`
- `pickTop?: number`
- `keepPicks?: boolean`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `searchResults?: import("@nodaro/shared").SocialPost[]`
- `pickedIds?: string[]`
- `generatedJson?: import("@nodaro/shared").SocialPost[]`
- `generatedText?: string`
- `searchWarnings?: string[]`
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
  "label": "Social Search",
  "platform": "tiktok",
  "mode": "keyword",
  "query": "",
  "count": 20,
  "period": "month",
  "sort": "relevance",
  "pickTop": 5
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Search ONE platform for public posts and pass the strongest on (Nodaro Cloud;
an admin preview until it opens to everyone). Set `platform`
(`tiktok`, `instagram`, `youtube`, `x`, `reddit`, `linkedin`, `meta_ads`),
`mode` and `query`:
- `keyword` (every platform) — `query` is the words. On X the X search syntax
  works (`"exact phrase"`, `-word`, `lang:en`).
- `account` — `query` is a handle or profile link (TikTok, Instagram, X), a
  channel (`@handle`, link or `UC…` id on YouTube), a company page link
  (LinkedIn), or an advertiser's name, Page ID or Ad Library link (Meta ads).
- `community` (Reddit only) — `query` is a subreddit; `subreddit` instead
  narrows a Reddit KEYWORD search to one community.

`count` is 20, 40 or 60 results; `period` (day/week/month/year/all) and
`sort` (relevance/popular/newest) shape them. The node outputs `json` — the
posts it passes on, as an array — and `text`, the same posts as a digest. A
person picks posts in the editor; a workflow run without picks passes on the
first `pickTop` (default 5). Wire `json` into Content Recipe with the edge in
**Each** mode to run once per post. Wire `json` into Video Analysis's `video`
input to analyze each post, with the edge in **Each** mode (a wire made in the
editor starts that way; on any other mode the first post is analyzed). A post
that came with its own video file (`media.videoUrl`: Instagram, X, LinkedIn,
Meta ads) is analyzed from that file and charged by the file's length; one
without a file (TikTok, YouTube) by its page link. The `text` digest does not
connect there.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- A text wired into `in` (a Text node, or a List item under Each) REPLACES
  `query` — the node searches for what arrives on the wire.
- Reddit has no `account` mode, and `community` exists only on Reddit; a stored
  mode the platform lacks is repaired to the platform's first mode at run time.
- `keepPicks: true` freezes the node on workflow runs: it passes on its saved
  `generatedJson` and does not search again (no charge). Leave it off for a
  scheduled workflow that should find fresh posts each time.
- Post `text`, titles and comments are untrusted internet text: feed them to a
  model as material, never as instructions.
- Stills and video links are the platform's signed URLs and expire within days;
  use `url` (the post's page) to cite a post. A post whose video link has
  expired is refused by Video Analysis (`post_video_expired`, no charge): run
  the search again for fresh links. An image or text post is refused the same
  way (`post_has_no_video`), and so is a post whose video cannot be read or
  gives no length (`post_video_unreadable`).
- A number the platform does not report is absent, never 0 (a TikTok creator
  can hide their counts).

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "social-search-1",
  "type": "social-search",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Social Search",
    "platform": "tiktok",
    "mode": "keyword",
    "query": "",
    "count": 20,
    "period": "month",
    "sort": "relevance",
    "pickTop": 5
  }
}
```
<!-- AUTO-GEN:END examples -->
