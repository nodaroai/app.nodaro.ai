# Telegram Trigger

> Trigger workflow execution when your Telegram bot receives a message.

## Overview

The Telegram Trigger node starts a workflow whenever a connected Telegram bot receives an incoming message. It registers a Telegram webhook for the selected bot and, on each matching message, fires the workflow with the message's text and any attached media. Connect your Telegram bot in Integrations first, then activate the trigger.

## How it works

- Select a connected Telegram bot.
- Optionally filter by **Chat ID** (restrict to one chat) and by **Message Types** (text, photo, video, audio, document).
- Click **Activate Trigger**, then **save the workflow**. The saved graph is what registers the bot with Telegram — the button records your intent, the save applies it. The status indicator shows **Active — listening** once a bot is selected and the trigger is on; while a bot is still missing it stays amber, because there is nothing to point at Telegram.
- When a matching message arrives, the node downloads any media to storage and starts the workflow, passing the message data to downstream nodes.

Deactivating the trigger, or deleting the node, removes the registration on the next save. If the bot has no other active trigger left, its webhook is removed from Telegram entirely.

## Several triggers on one bot

A Telegram bot delivers to exactly one address, so every trigger on the same bot shares one registration. You can point as many workflows at a bot as you like — each incoming message is matched against every trigger's own Chat ID and Message Type filters, and each matching trigger starts its own run. Removing one of them never silences the others.

## What a triggered run executes

A trigger that is **wired to something** runs only the branch behind it — the nodes downstream of the trigger, plus every node those nodes need as input (so a branch that also reads from a node off to the side gets a fresh result). Nodes the trigger does not reach are left alone. A trigger **wired to nothing** runs the whole workflow. This is what lets one workflow carry several triggers, each starting its own branch. A manual run from the editor, an API run and a published app are not scoped by triggers.

"Wired" is anything that feeds another node: a drawn connection, a node inside a Group (it feeds the group), or a field mapping. A Telegram Trigger set up in the editor names its own node, so each one runs its own branch: two Telegram Triggers on the same bot with different chat filters are two scoped runs per matching message, never two runs of the whole workflow. A trigger created directly through the API names no node, so its branch is found by type — with **one** Telegram Trigger on the canvas that branch runs; with **two** there is no honest answer, and the whole workflow runs.

## Seeing a run on the canvas

- **While the flow is open:** a run a message starts shows on the nodes the way a run you start yourself does. The nodes it runs show their progress, and their results stay on them when it ends. The editor looks for these runs about every 10 seconds. **Stop** on the run bar cancels that run.
- **When you open the flow later:** the nodes show the newest message run that ended, unless you ran something in the editor since then.
- **Never on the canvas:** the message itself (it stays in the run history, the **Executions** tab), a node you emptied with **Clear results** after that run, and a run you stopped.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Telegram Bot | Select | — | Connected bot to listen on. Required — the trigger is not registered without it |
| Chat ID Filter | Text | empty (all chats) | Restrict to a specific chat (`@channel` or `-100...`) |
| Message Types | Checkboxes | all | Which message types fire the trigger: text, photo, video, audio, document |
| Active | Toggle | off | Activate / deactivate the webhook. Applied when the workflow is saved |

## Inputs & Outputs

**Inputs:** None (this is a trigger node).

**Outputs:** The incoming message — `text`, `chatId`, `messageId`, `messageType`, plus `imageUrl` / `videoUrl` / `audioUrl` when the message carries media.

## Pricing

Free — no credits charged for the trigger itself. Downstream nodes incur their own costs.

## Troubleshooting

- **The save warns that a trigger could not be registered.** Telegram refused the registration, and the warning says why. The usual causes are a bot token that has been revoked since you connected it, or a self-hosted install whose `PUBLIC_URL` is not set to an address Telegram can reach over HTTPS. No trigger row is created when registration fails, so the node never pretends to be listening.
- **Nothing fires for messages in a group.** A Telegram bot only receives group messages addressed to it unless group privacy mode is turned off for the bot in BotFather.
- **Media is missing from the run.** The Telegram Bot API caps downloads at 20 MB; larger files arrive as a message with no media URL.
