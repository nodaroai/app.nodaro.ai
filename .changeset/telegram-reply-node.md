---
"@nodaro/shared": minor
---

A new Cloud node, Telegram Reply (`telegram-account-send`): sends the run's text back to its owner on Telegram, as their connected account (under the post that started the run, or to their Saved Messages) or from their own bot (a private message).

- `TELEGRAM_ACCOUNT_SEND_NODE_TYPE`, and the node data vocabulary: `TELEGRAM_SEND_AS` (`account`, `bot`) and `TELEGRAM_SEND_DESTINATIONS` (`reply`, `saved`), read through `telegramSendAsOf` / `telegramSendDestinationOf` (anything else reads as `account` / `reply`).
- `FAN_IN_TARGETS` lists `telegram-account-send` on its `in` handle: whatever is wired into the text arrives as one message per run.
- A template export drops the node's `accountId` and `connectionId` (the exporter's account and bot), like the other owner-bound references.
