# Telegram Channel Feed

> Read a PUBLIC Telegram channel's new posts — as structured posts (text, link, date, media, forwarded from) and as plain text — for follow / rewrite / repost workflows.

## Overview

The Telegram Channel Feed node reads a public channel's posts via its web preview page (`t.me/s/<channel>`) — no bot and no auth required. Each run emits the posts that are **new since the last run**: on its **JSON** output as structured posts, and on its **Posts** output as their combined text. Chain it into Generate Text to rewrite, Generate Image for a cover, a Collection to keep the stories, or a publish node to repost. Pair it with a Schedule Trigger to poll a channel on an interval.

## How it works

- Set the **Channel** — a public channel by `@name`, `t.me/name`, or bare id. It must have its web preview enabled (most public channels do).
- The node keeps a **position**: the id of the last post it emitted, stored on the server per node of the saved workflow **and per channel** — changing the channel starts fresh, changing back resumes where that channel stood. The position belongs to the workflow: a scheduled run, a published app's run and the owner's single-node Run move the same one; another person's editor Run reads the feed without touching it.
- **First run** (or the first after a Reset): the newest **Max posts per run** posts, and the position jumps to the newest post — older posts are never revisited.
- **Every run after that**: the oldest posts above the position, up to **Max posts per run**, and the position moves to the highest post emitted. When posts pile up faster than the schedule reads them, each run takes the next batch — a backlog drains at your pace and nothing is skipped. Posts with nothing to read (a poll, a voice note, a document with no caption) are passed over and the position moves past them. The position moves when the posts are fetched: a run that fails later does not read that batch again (**Re-fetch** shows it without moving the position).
- **Nothing new**: the run emits no post, is not charged, and the nodes behind the feed that would have worked on its text are skipped — the run ends `completed` with `outcome: "nothing_new"` (see [Runs that find nothing new](../../api-integration.md#runs-that-find-nothing-new)).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Channel | Text | — | Public channel (`@name`, `t.me/name`, or id) |
| Max posts per run | Number | 5 | 1–30; how many new posts each run emits (at most two preview pages) |
| Position | — | not started | Where the feed stands: "Last seen post #N · date", or "Not started". Shown once the workflow is saved. |
| Reset position | Button | — | Forgets the position; the next run reads the newest posts again (asks you to confirm) |
| Re-fetch the last N | Button | — | Reads the newest N posts (N ≤ 20) **without moving the position** — for checking what the channel carries. A fetch is charged like a run. |

## Inputs & Outputs

**Inputs:** Optionally a text input to override the channel at runtime.

**Outputs:**

- **JSON** (handle id `json`) — the new posts, oldest first, one object each:

  | Field | Meaning |
  |-------|---------|
  | `id` | The post's sequential id in the channel |
  | `channel` | The channel's bare id |
  | `postUrl` | Link to the post (`https://t.me/<channel>/<id>`) |
  | `text` | The post's text (a reply's quoted text is not included) |
  | `date` | ISO timestamp |
  | `forwardedFrom` | `{ name, url? }` when the post was forwarded |
  | `media` | Every photo and video: `{ type: "photo", url }` or `{ type: "video", url?, posterUrl }` — an album is several; a video's file is present when the preview page embeds it |
  | `imageUrl` | The first picture (the first photo, else a video's poster) — for a node that takes one image |
  | `views` | The view counter as the page shows it ("1.52M") |

  On an **Each** wire the node runs its neighbour once per post; Extract Field and List read the posts directly.

- **Posts** (handle id `text`) — the same posts' text, joined with `---` separators (wire into an LLM / prompt / caption).

**Media links expire.** Photo and video links come from Telegram's CDN and stop working within days. To keep a picture, pass it on in the same run — into an upload node, a Collection, or a generation node — rather than storing the link.

## Pricing

Costs **10 credits** per run that returns at least one new post (a **Re-fetch** too). A run that finds nothing new is not charged.

## Notes & limits

- Public channels with web preview enabled only. Private channels, or channels that disabled the preview, return a clear error.
- A run reads at most two preview pages (~40 posts); with **Max posts per run** at 30 and a long backlog, the rest comes on the next runs.
- An older workflow that kept the position in the node itself hands it over on its first run after this change; nothing is re-emitted.
- Typical pattern: **Schedule Trigger → Telegram Channel Feed → Generate Text (rewrite) → Publish to Social**, with the feed's **JSON** into a **Collection** to keep every story.
