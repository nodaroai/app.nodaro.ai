# Publish to Social

> Publish to any connected social account from a single node — the platform follows the account you pick.

## Overview

The Publish to Social node is the unified publisher: one node that can post to **any** network you've connected in Integrations (Instagram, Facebook, X, LinkedIn, TikTok, YouTube, Telegram, Bluesky, Reddit, and more). Instead of adding a separate per-platform node, drop one Publish to Social node, pick the connected account, and the platform is derived from that account automatically.

## How it works

- Connect one or more social accounts in **Integrations** first.
- Add a Publish to Social node and select the **Account** — the dropdown lists every connected account across all networks, labeled by platform.
- The node sets its platform from the chosen account and shows the right options for it (action selector where the platform has multiple post types; Chat ID for Telegram; description for YouTube).
- Write the caption/text and optionally wire an image, video, or audio input. On execution the node calls the same `/v1/social/publish` endpoint as the per-platform nodes.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Account | Select | first connected | Any connected account; the platform is derived from it |
| Action | Select | platform default | Post type, when the platform has more than one (hidden otherwise) |
| Chat ID | Text | — | Telegram only — `@channelname`, `-100...`, or numeric chat ID |
| Caption | Text | `""` | Message text / media caption |

## Inputs & Outputs

**Inputs:** Optional image, video, audio, or text from an upstream node (media routes to the platform's media post; text becomes the caption).

**Outputs:** None. This is a terminal output node.

## Pricing

Costs **1 credit** per post — the same as the per-platform nodes.

## Notes

- Networks added after this node is placed appear in the account dropdown automatically — no node change needed.
- The 7 original per-platform nodes (Instagram Post, Telegram Post, …) still work; Publish to Social is the one-node alternative that covers all of them plus the newer networks.
