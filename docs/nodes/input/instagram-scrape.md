# Instagram

> Pull public Instagram posts (images, carousels, reels) by profile, by hashtag or by post link and emit structured JSON (caption, media, likes, comments).

## Overview

The Instagram node scrapes PUBLIC Instagram posts and returns them as a JSON array. Each post carries its caption, owner, timestamp, like/comment counts, and image/video URLs (carousel children flattened). Pipe the array into Extract Field, JSON Process or a List node to fan out, or straight into a Generate Text node for content analysis.

## When to Use

- Track a creator or brand's recent posts (profile mode)
- Research what's performing under a hashtag (hashtag mode)
- Remake one post you liked: paste its link (post mode), then an [Extract Field](../utility/extract-field.md) with the field `images` and **Output Type** `list` hands every slide of the carousel to the next step, one run per slide (set its outgoing wire to **Each**)
- Seed a creative pipeline with real captions and visuals
- Combine with a Schedule Trigger for a recurring content digest

## Configuration

### Search by

| Mode | Input | Description |
|------|-------|-------------|
| `profile` (Profile) | Usernames | One username per line, up to 5 (`nike`; `@` optional). Use `{}` to inject an upstream list |
| `hashtag` (Hashtag) | Hashtags | One hashtag per line, up to 5 (`running`; `#` optional). Use `{}` to inject an upstream list |
| `post` (Post link) | Post links | One post link per line, up to 5 (`https://www.instagram.com/p/…`, `/reel/…` and `/tv/…` links too; tracking parameters are ignored). Each link brings exactly that post, however old. Anything that is not an Instagram post link is ignored |

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Posts per source | number | 20 | How many posts per profile / hashtag (1–100). Not used in post mode — each link is one post |
| Period | select | Last 30 days | `Last 24 hours`, `Last 7 days`, `Last 30 days` or `All time`, by the post's date (honoured by the scraper). Not used in post mode |
| Creative format | toggles | none (no filter) | Keep only posts whose creative is `vertical` (reels / portrait), `square` or `horizontal`, classified from the post's real pixels. Fewer posts than requested may come back. Not used in post mode |
| Copy all videos | toggle | off | Copy every returned post's video into your library (the expensive bytes; they count toward storage) |
| AI analysis | toggle + model + focus | off | Run a content-analyst pass on every post — asset type, format, visual hooks, audiences, graphic identity, content angles, value, CTA and a summary. Each analysis is charged for the tokens it used at the model's rate — see the AI analysis add-on under Pricing |

After a run the node card features one post — creative, owner, caption, likes / comments, format — with a thumbnail strip and ‹ › to move between posts; the **Results** tab lists them all, filters by format, and clicking a row features it.

## Creatives in your library

Instagram's image and video links are signed and expire, so after every run the node copies each post's images and video covers into your library (they count towards your storage; they stay out of the media picker until you press **Save to library** on a post). The featured post's video is copied when the node's **video** output is wired; turn on **Copy all videos** to copy every post's video. When storage is full, or on an install without media storage, the posts keep their original links and the run still succeeds.

## Inputs & Outputs

**Inputs:** `in` (optional) — upstream text: profiles (one per line) in `profile` mode, hashtags in `hashtag` mode, or post links in `post` mode.

**Outputs:**

| Handle | Carries |
|--------|---------|
| `json` | the whole array of posts (below) — wire it to a List node to fan out, to Extract Field to pull one field, or to a prompt input |
| `text` | the featured post's caption |
| `image` | the featured post's first image (or its video cover) |
| `video` | the featured post's first video |

The featured post is the one shown on the card (‹ ›, or a Results row click). A run, from the editor or the API, features the first returned post; "Run from here" reuses the post featured on the saved node without scraping again. In `post` mode with one link, the first returned post IS that post — so a full run of a workflow lands on it every time.

The `json` handle emits an array of posts, each shaped as:

```json
{
  "postId": "3712…",
  "shortCode": "DdMeNa0O_x_",
  "url": "https://www.instagram.com/p/DdMeNa0O_x_/",
  "type": "image",
  "caption": "New York, Paris, Melbourne…",
  "ownerUsername": "nike",
  "timestamp": "2026-09-12T17:01:28.000Z",
  "likesCount": 53999,
  "commentsCount": 169,
  "images": ["https://…/creative.jpg"],
  "videos": [],
  "videoPreviews": [],
  "hashtags": ["running"]
}
```

## Pricing

**1.1 credits<!-- credits-rate: instagram-scrape:10@0.1 --> per requested post**, rounded up to the next tier of the requested total (`Posts per source × number of sources`; in `post` mode every link is one post, so the requested total is the number of links). These are the prices a run is charged on Nodaro Cloud; the node's Run button, and `GET /v1/models` / the MCP `list_models` tool, show the price your instance charges.

| Requested total | Credits |
|-----------------|---------|
| up to 10 | 11 CR<!-- credits: instagram-scrape:10 --> |
| up to 20 | 22 CR<!-- credits: instagram-scrape:20 --> |
| up to 50 | 55 CR<!-- credits: instagram-scrape:50 --> |
| up to 100 | 110 CR<!-- credits: instagram-scrape:100 --> |
| up to 200 | 220 CR<!-- credits: instagram-scrape:200 --> |
| up to 500 | 550 CR<!-- credits: instagram-scrape:500 --> |

Post mode: 1 link → requested total 1 → **11 CR**<!-- credits: instagram-scrape:10 -->; 5 links → requested total 5 → still **11 CR**<!-- credits: instagram-scrape:10 --> (the count setting does not apply).

### AI analysis add-on

Turning on **AI analysis** adds one LLM call per analysed post — its frame and copy, your focus, and the analysis it writes — charged for the tokens it actually used at the analysis model's rate on the lane that served it ([LLM model rates](../../pricing/llm-models.md)). A run's analyses are added up and charged once, on top of the scrape's own price, as one charge. A typical analysis on the default model, Gemini 3.6 Flash, is estimated at ≈4 credits<!-- credits: meta-ads-analysis:gemini-3.6-flash -->; Gemini 4 Argon runs only on its provider's own API and is charged at that lane's rate.

- **Before the run** a hold is reserved: the scrape's price plus a typical analysis per requested post. A balance below it is refused before anything runs (`402`, "Needs up to N credits").
- **After the run** it is charged the scrape's price plus what the analyses used. A post the run never analysed (the batch came back short, or a long run hit its time budget) costs nothing; an analysis the provider billed is charged even when it failed.
- **A failed run** refunds the scrape's price; analyses the provider had already billed are still charged.

Example: 20 posts on Gemini 3.6 Flash, each analysis about 1,500 tokens in and 400 out (30,000 in and 8,000 out in all) → 22<!-- credits-rate: instagram-scrape:20 --> for the scrape + 18<!-- credits-llm-rate: gemini-3.6-flash:kie@30000/8000 --> for the analyses = **40 CR**<!-- credits: n/a -->.

## Providers

Uses Apify (`apify/instagram-scraper`). Needs `APIFY_API_TOKEN`, or a connected nodaro.ai account (the run — scrape and analysis — is relayed and billed there). AI analysis additionally needs an LLM key on a local run.

## Running it (editor vs. API)

A real profile scrape (media copy included) routinely runs longer than a browser's ~100-second HTTP limit, so the request returns a **job id right away** and the scrape finishes on the server. In the editor and in a workflow there is nothing to do — both poll for you and show the posts when they land.

A direct API/SDK caller gets `{ "jobId": "…", "status": "pending" }` and reads the result from the job:

- SDK: `client.nodes.runAndWait("instagram-scrape", { … })` returns the posts (it polls for you); or `run(...)` then `client.jobs.get(jobId)` and read `output_data`.
- The posts array, the featured `text` / `imageUrl` / `videoUrl`, `mediaStorage`, and any `analysis` all live on the completed job's `output_data`.
