# Telegram Post

> Send a message, photo, or video to a Telegram chat, channel, or group.

## Overview

The Telegram Post node publishes content to Telegram via a connected bot. It auto-detects what to send from the connected media — text for a caption-only post, a photo when an image is wired, or a video when a video is wired — and delivers it to the target chat. Connect your Telegram bot in Integrations first.

## How it works

- Connect a Telegram bot account (select it in the node's config).
- Set the **Chat ID** — a channel handle (`@channelname`), a channel/supergroup numeric ID (`-100...`), or a numeric group/DM ID.
- Write the caption/message (up to 4096 characters) and optionally wire an image or video as the media to send.
- On execution, the node posts to Telegram. The send type (message / photo / video) is auto-detected from the connected media.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Account | Select | — | Connected Telegram bot |
| Chat ID | Text | — | `@channelname`, `-100...`, or numeric chat ID |
| Caption | Text | `""` | Message text / media caption (max 4096 chars) |

## Inputs & Outputs

**Inputs:** Optional image, video, or text from an upstream node.

**Outputs:** None. This is a terminal output node.

## Pricing

Costs **1 credit** per post.
