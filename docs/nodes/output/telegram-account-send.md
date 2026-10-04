# Telegram Reply

> Send the result of a run back to yourself on Telegram: as your connected account, under the post that started the run or to your Saved Messages, or from your own bot as a private message.

**Availability:** Nodaro Cloud, preview. Only admins see it while the feature is in preview.

## Overview

Telegram Reply closes the loop of a workflow that starts on Telegram. You share a post with the [Telegram Account Trigger](../input/telegram-account-trigger.md), the workflow works on it, and Telegram Reply sends the answer back, so the exchange reads like a conversation.

It only ever sends to you. The node has no chat field: you choose who writes the message and which of your own chats it goes to.

## Who writes the message

| Send as | Where the message goes | Notification |
|---------|------------------------|--------------|
| **My Telegram account** | Under the post that started the run, in the same chat, or to your Saved Messages | None: Telegram does not notify you about your own messages |
| **My bot** | A private message from your bot to you | Yes, like any message from a bot |

### As your account

Connect the account on the Integrations page (**Telegram account**). Then pick a destination:

- **Under the post that started the run.** The message is a reply to the post you shared, in the same chat.
  - It works only in a run that the Telegram Account Trigger started, and only for a post you sent yourself.
  - It never writes in a private chat with another person.
  - In a group or a channel, its members see the reply too. A private channel of your own (for example "Nodaro inbox") keeps it to yourself.
  - In any other run (Run from here, a schedule, the API), the node fails before sending anything. Use Saved Messages there.
- **My Saved Messages.** Works in every run, for example a weekly schedule.

Your reply never starts another run of your inbox, even when it contains a link.

### As your bot

Connect the bot on the Integrations page (**Telegram**), pick it in the node, and pick your Telegram account: the bot writes to that account, privately.

A bot cannot write to someone first. Open your bot in Telegram and press **Start** once before the first run; until then the node fails with a message that says so.

## The message

- **One message per run.** Everything wired into the input arrives as one message: a list, or a node that ran once per item, is joined, not sent once per item. With nothing wired, the node sends the text written in its settings.
- **Long text** is split into up to 3 parts, numbered "(1/3)", "(2/3)" and so on. Text that does not fit in 3 parts is cut, and the last part ends with "…".
- **Plain text.** Formatting marks such as `**`, `__` and `#` are removed, and a Markdown link becomes its text followed by the address. Link previews are off.

## Running it

The node runs on the server only. In the editor, **Run** on the node (and **Run from here**) sends with the inputs from the last run of the nodes before it.

A message is never sent twice for the same run, even if the run is retried. The same text is sent once per run, even if the node runs again within it.

If the connection to Telegram drops while a message is on its way, the node fails rather than risk a second copy. The run is refunded, although the message may still have arrived.

## Limits

While the feature is in preview, your Telegram account sends at most:

- 20 messages a minute,
- 250 messages a day,
- to 20 different chats a day.

Your bot writes to you at most 20 times a minute and 250 times a day.

Each part of a long message counts as one message. A run past a limit fails before sending anything, and its credits come back.

If Telegram asks the account to slow down:

- Nothing more is sent, and the account waits as long as Telegram asked before it sends again.
- The parts already sent stay, and the run is charged. A run that sent nothing is refunded.
- After repeated requests to slow down, or when Telegram limits the account, the account is paused. Resume it on the Integrations page.

A bot never answers a run that a message in its own chat started: if your account trigger listens to your chat with your bot, the node fails instead of starting an endless exchange.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Send as | Choice | My Telegram account | My Telegram account or My bot |
| Telegram account | Select | — | One of your connected accounts. Required in both modes |
| Where | Choice | Under the post that started the run | As the account: under the post, or My Saved Messages |
| Your bot | Select | Your default bot | As the bot: which of your connected bots |
| Message when nothing is connected | Text | empty | Sent when nothing is wired into the input |

## Inputs & Outputs

**Inputs:** `in` (Text). The message to send.

**Outputs:** none. The card shows the message the node sent last.

## Credits

**10 credits** per run: one message, up to 3 parts. A run that sends nothing is refunded.
