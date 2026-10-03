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
- **What its panel shows is what it listens to.** When you start the trigger or change it in its settings panel, it listens to everything the panel shows then. The panel lists every chat the trigger would listen to at the top (once your chats have loaded, one that is not among your recent chats is marked as such), any sender filter, and each keyword on its own, so check them before you start. Start waits until your chats have loaded. A change you make before they have loaded, or while the trigger points at an account that is not one of yours, stops the trigger instead of applying. A copy of the trigger (duplicate, paste or import) starts stopped.
- **Only you can switch it on, in the editor.** Only the workflow's owner can start the trigger or change what it listens to, only on their own connected account, and only in the editor. Someone who can edit a shared workflow cannot point it at your account. An API token, a connected app or an AI assistant working in your account can switch it off, never on: chats or filters they write do not take effect when you save the workflow. They show in the panel, and take effect only if you then start or change the trigger there. A change you made in the panel counts once: after it has been saved, the same settings written back by anything else after a stop do not switch the trigger on again.
- **One message starts one run.** A message that is delivered again (for example after a reconnect) does not start a second run.
- **Runs are limited.** Each trigger starts at most 20 runs a minute; a message past that is skipped. A workflow has at most 3 runs from Telegram account triggers in progress at a time; a message that arrives meanwhile waits its turn for up to 10 minutes.
- **A deleted or switched-off trigger node stops listening at once.** If its node is removed from the workflow or switched off, from anywhere, the trigger stops before the next message.

## Inbox mode

Inbox mode turns a chat into an inbox for posts you want to work on: you share a post into it from your phone, and the workflow runs on that post.

- **Only your own shares start a run:** a message with a post link, or a post you forwarded. Every other message in the chat is ignored, so a plain note costs nothing.
- **One run per link.** A message with several post links starts one run for each (up to 3). A forwarded post with text starts one run.
- **The post outputs say what the run is about:**
  - **Video link** holds the post's link when the post has a video to analyze: TikTok, Instagram Reels, YouTube, Facebook videos, and X posts whose link preview shows a video.
  - **Post text** holds the post's words when it has no video: what the message says, the link preview's title and description (for example a LinkedIn or X post), or the forwarded post's text.
  - **Post link** holds the link of the post, whatever its kind.
  - Exactly one of Video link and Post text has a value; the other is empty. Wire each into its own Router with the condition **is not equal to** and the value left empty, so only the branch with a value runs.
- **Your own messages are always included** in inbox mode, so "Also my own messages" is not offered.
- **Saved Messages works as an inbox**, but every link you save there for yourself then starts a run. A private channel of your own (for example "Nodaro inbox") keeps the two apart.

A forwarded Telegram video is read by its caption for now: the run does not receive the video file yet.

## What a triggered run executes

A trigger that is **wired to something** runs only the branch behind it. A trigger **wired to nothing** runs the whole workflow. The rules are the same as the [Telegram Trigger](./telegram-trigger.md#what-a-triggered-run-executes).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Telegram account | Select | — | One of your connected accounts. Required |
| Chats to listen to | Checkboxes | none | One or more of the account's chats, Saved Messages first. At least one is required to listen |
| Message types | Checkboxes | none (every type) | text, photo, video, voice message, audio, file |
| Keywords | Text | empty | Comma-separated. The trigger fires only when the message contains one of them (case-insensitive). Each keyword is listed on its own under the box |
| Only from these senders | List | none | Shown only when set outside the panel (for example by the API): only messages from these Telegram user ids start a run. **Clear** removes the filter |
| Inbox mode | Checkbox | off | Only your own shares start a run: one run per post link, or one for a forwarded post. See [Inbox mode](#inbox-mode). Turning it off also turns off "Also my own messages" |
| Also my own messages | Checkbox | off | Also fire on messages you send from your other devices. Not offered in inbox mode, which always includes them |
| Listening | Button | off | Start or stop listening. Applied when the workflow is saved |

## Inputs & Outputs

**Inputs:** none (this is a trigger node).

**Outputs:**

| Output | Description |
|--------|-------------|
| `out` (Message) | The message text. For a media message this is the caption, or empty |
| `videoLink` (Video link) | The post's link when the post has a video. Empty otherwise |
| `postText` (Post text) | The post's words when it has no video. Empty otherwise |
| `postLink` (Post link) | The link of the post the run is about, whatever its kind |
| `chatId` | The chat's id |
| `messageId` | The message's id in its chat |
| `senderId` | Who sent it. For a channel post, this is the channel itself |
| `chatType` | `private`, `group`, `supergroup` or `channel` |

In inbox mode each run is about one post. Outside inbox mode the three post outputs describe the message's first post link, and are empty for a message without one.

`chatId`, `messageId`, `senderId` and `chatType` are not drawn on the card. A Router condition can compare its input with them: write `{{trigger.chatId}}` (and so on) as the condition's value.

Media is described but not attached yet: the run receives the message's type, not the file.

## Credits

Free. Downstream nodes incur their own costs.
