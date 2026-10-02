# Social Search

> Search TikTok, Instagram, YouTube, X, Reddit, LinkedIn or Meta's Ad Library by keyword or account, get up to 60 posts with their numbers, and pick the ones the workflow uses.

## Overview

Social Search finds public posts on one platform and returns them in one shape, whatever the platform: the link, who posted it, when, the words, the still and (where the platform gives one) the video, and the numbers — views, likes, comments, shares, saves, or a Reddit score. Meta ads also carry how long the ad has run, how many versions it has, its call to action and where it links.

After a search, open **Pick posts** on the node to browse the results as cards and pick the posts this node passes on, in the order you want them. With no picks, the node passes on the first few (5 by default). Wire the `json` output into Content Recipe, Video Analysis, a List or Extract Field; set the wire to **Each** to run the next node once per post.

Social Search runs on Nodaro Cloud. It is in preview for admins.

## When to Use

- Find what is working right now on a topic, before writing a script
- Collect a competitor's or a creator's recent posts and pick the strongest
- See which ads an advertiser keeps running (an ad that runs for weeks is one that works)
- Read what a subreddit is discussing about your product
- Feed real posts into Content Recipe to learn their structure

## Configuration

### Platform and search mode

| Platform | Keyword | Account |
|----------|---------|---------|
| TikTok | posts matching the words | a creator's videos (`@handle` or profile link) |
| Instagram | reels matching the words | an account's reels |
| YouTube | videos and Shorts matching the words | a channel's latest videos (`@handle`, channel link or channel ID) |
| X | posts matching the words (X search syntax works) | an account's own posts, without its replies in other threads |
| Reddit | threads matching the words (optionally inside one subreddit) | — (use **Subreddit**: a community's threads) |
| LinkedIn | posts matching the words | a company page's posts (`linkedin.com/company/…`) |
| Meta Ads | ads matching the words | an advertiser's ads (name, Page ID or Ad Library link) |

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Platform | select | TikTok | One of the seven platforms above |
| Search by | select | Keyword | Keyword, Account (Channel, Company page, Advertiser) or Subreddit, as the platform allows |
| Query | text | — | The keyword or the account. A Text or List node wired into the input replaces it |
| Results | 20 / 40 / 60 | 20 | How many posts to fetch |
| Posted in | select | The last month | The last day, week, month or year, or any time. Not used for Meta ads (they are judged by how long they run) |
| Order | select | Most relevant | Most relevant (the platform's own order), Most popular or Newest |
| Region | text | — | TikTok keyword search: a two-letter region |
| Country | text | All | Meta ads: a two-letter country, or ALL |
| Running ads only | toggle | on | Meta ads: only ads that are running now |
| Inside one subreddit | text | — | Reddit keyword search: search one community only |
| Video type | select | All | YouTube keyword search: all, long videos or Shorts |
| Posts to pass on | number | 5 | How many posts a run passes on when none are picked |
| Keep the chosen posts on workflow runs | toggle | off | On: a workflow run passes on the posts chosen in the editor and does not search again. Off: every run searches again and passes on the first ones |

## Inputs & Outputs

**Inputs:** `in` (optional) — a keyword or an account from a Text node, or one per item from a List (the node runs once per item).

**Outputs:**

| Handle | Carries |
|--------|---------|
| `json` | the posts the node passes on — the ones picked, else the first few — as an array (below) |
| `text` | the same posts as plain text: who, when, reach, the first words and the link, one post per paragraph |

Each post in the `json` array is shaped as:

```json
{
  "id": "tiktok:7691344608554503444",
  "platform": "tiktok",
  "url": "https://www.tiktok.com/@creator/video/7691344608554503444",
  "text": "Day 2 of the launch #aivideo",
  "author": { "handle": "creator", "name": "Creator", "followers": 6691, "verified": false },
  "publishedAt": "2026-09-30T15:05:22.000Z",
  "metrics": { "views": 581844, "likes": 81383, "comments": 534, "shares": 87311, "saves": 9389 },
  "media": { "kind": "video", "thumbnailUrl": "https://…", "durationSec": 85.8, "aspect": "9:16" },
  "hashtags": ["aivideo"],
  "extra": { "sound": { "title": "original sound - creator", "uses": 7, "commercial": true } }
}
```

A number the platform does not report is left out, never shown as zero (a TikTok creator can hide their counts). Platform links to stills and videos are signed and expire within days.

## Pricing

Charged per page of results, the same on every platform:

| Results | Credits |
|---------|---------|
| 20 posts | 10 CR |
| 40 posts | 20 CR |
| 60 posts | 30 CR |

These are list prices: the node's Run button, and `GET /v1/models` / the MCP `list_models` tool, show the price your instance charges. A search that fails is refunded.

## Running it (editor vs. API)

A search can take up to two minutes (X is the slowest), so the request returns a **job id right away** and the search finishes on the server. In the editor and in a workflow there is nothing to do — both wait for you and show the posts when they land.

A direct API/SDK caller gets `{ "jobId": "…" }` and reads the result from the job:

- SDK: `client.nodes.runAndWait("social-search", { platform: "tiktok", query: "ai video ad" })` returns the completed job; or `run(...)` then `client.jobs.get(jobId)`.
- The completed job's `output_data.json` holds **every** post found (picking is an editor step); `output_data.warnings` holds non-fatal notes.
