# Telegram Trigger

> Trigger workflow execution when your Telegram bot receives a message.

## Overview

The Telegram Trigger node starts a workflow whenever a connected Telegram bot receives an incoming message. It registers a Telegram webhook for the selected bot and, on each matching message, fires the workflow with the message's text and any attached media. Connect your Telegram bot in Integrations first, then activate the trigger.

## How it works

- Select a connected Telegram bot.
- Optionally filter by **Chat ID** (restrict to one chat) and by **Message Types** (text, photo, video, audio, document).
- Click **Activate Trigger** to register the webhook. The status indicator shows whether it is actively listening.
- When a matching message arrives, the node downloads any media to storage and starts the workflow, passing the message data to downstream nodes.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Telegram Bot | Select | — | Connected bot to listen on |
| Chat ID Filter | Text | empty (all chats) | Restrict to a specific chat (`@channel` or `-100...`) |
| Message Types | Checkboxes | all | Which message types fire the trigger: text, photo, video, audio, document |
| Active | Toggle | off | Activate / deactivate the webhook |

## Inputs & Outputs

**Inputs:** None (this is a trigger node).

**Outputs:** The incoming message — `text`, `chatId`, `messageId`, `messageType`, plus `imageUrl` / `videoUrl` / `audioUrl` when the message carries media.

## Pricing

Free — no credits charged for the trigger itself. Downstream nodes incur their own costs.
