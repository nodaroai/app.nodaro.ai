# Telegram Account Trigger

> Start a workflow when a message arrives in a chosen chat of the Telegram account you connected.

**Availability:** Nodaro Cloud, preview. Only admins see it while the feature is in preview.

## Overview

The Telegram Account Trigger listens through **your own Telegram account**, connected on the Integrations page (**Telegram account**, then **Connect account**). A bot sees only what is sent to the bot. Your account sees the channels and groups you belong to, including private ones.

To use it:

1. Pick the account.
2. Pick one or more of its chats.
3. Optionally narrow the trigger by message type and keywords.
4. Click **Start listening** and **save the workflow**.

Each matching message starts one run.

## How it works

- **Nothing is sent to Telegram.** The trigger only reads. It listens through the connection Nodaro already holds for the account.
- **It listens only to the chats you pick.** You must pick at least one chat before it can start. With no chat picked, it never listens to the whole account.
- **Changes take effect on save.** Starting, stopping and changing filters all apply when the workflow is saved.
- **Only you can switch it on.** Only the workflow's owner can start the trigger or change it, and only on their own connected account. Someone who can edit a shared workflow cannot point it at your account.
- **One message starts one run.** A message that is delivered again (for example after a reconnect) does not start a second run.
- **Runs are limited per trigger.** Each trigger starts at most 20 runs a minute and has at most 3 runs in progress at a time. Messages beyond that are skipped.
- **A deleted trigger node stops listening.** If its node is removed from the workflow, the trigger switches itself off.

## What a triggered run executes

A trigger that is **wired to something** runs only the branch behind it. A trigger **wired to nothing** runs the whole workflow. The rules are the same as the [Telegram Trigger](./telegram-trigger.md#what-a-triggered-run-executes).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Telegram account | Select | — | One of your connected accounts. Required |
| Chats to listen to | Checkboxes | none | One or more of the account's chats. At least one is required to listen |
| Message types | Checkboxes | none (every type) | text, photo, video, voice message, audio, file |
| Keywords | Text | empty | Comma-separated. The trigger fires only when the message contains one of them (case-insensitive) |
| Also my own messages | Checkbox | off | Also fire on messages you send from your other devices |
| Listening | Button | off | Start or stop listening. Applied when the workflow is saved |

## Inputs & Outputs

**Inputs:** none (this is a trigger node).

**Outputs:**

| Output | Description |
|--------|-------------|
| `text` (Message handle) | The message text. For a media message this is the caption, or empty |
| `chatId` | The chat's id |
| `messageId` | The message's id in its chat |
| `senderId` | Who sent it. For a channel post, this is the channel itself |
| `chatType` | `private`, `group`, `supergroup` or `channel` |

Media is described but not attached yet: the run receives the message's type, not the file.

## Credits

Free. Downstream nodes incur their own costs.
