# Telegram Channel Feed

> Read recent posts from a PUBLIC Telegram channel and emit their text — for follow / rewrite / repost workflows.

## Overview

The Telegram Channel Feed node reads a public channel's recent posts via its web preview page (`t.me/s/<channel>`) — no bot and no auth required. It emits the posts' text, so you can chain it into an LLM to rewrite and then a publish node to repost. Pair it with a Schedule Trigger to poll a channel on an interval.

## How it works

- Set the **Channel** — a public channel by `@name`, `t.me/name`, or bare id. It must have its web preview enabled (most public channels do).
- On each run the node fetches the channel's most recent posts and emits their combined text on its **Posts** output.
- A per-node cursor tracks the highest post id seen; the next run emits only **newer** posts, so a scheduled feed doesn't reprocess the same content.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Channel | Text | — | Public channel (`@name`, `t.me/name`, or id) |
| Max posts per run | Number | 5 | 1–20; caps how many fresh posts are emitted each run |

## Inputs & Outputs

**Inputs:** Optionally a text input to override the channel at runtime.

**Outputs:** `Posts` — the fresh posts' text, newest content joined with `---` separators (wire into an LLM / prompt / caption).

## Pricing

Costs **1 credit** per run.

## Notes & limits

- Public channels with web preview enabled only. Private channels, or channels that disabled the preview, return a clear error.
- Reads roughly the ~20 most recent posts the preview page renders.
- Typical pattern: **Schedule Trigger → Telegram Channel Feed → Generate Text (rewrite) → Publish to Social**.
