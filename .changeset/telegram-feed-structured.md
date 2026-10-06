---
"@nodaro/shared": minor
---

Telegram Channel Feed emits structured posts. New exports: `TelegramChannelPost` / `TelegramChannelPostMedia` (id, channel, link, text, date, forwarded-from, every photo and video, the first picture, views — what the node's `json` handle carries and `get_workflow_json` saves on `generatedJson`), `telegramPostsFrom(value)` (a saved list read back, normalized), `telegramFeedDigest(posts)` (the `text` handle's join rule), `planFeedEmission(posts, since, limit)` (where the feed's position goes after a run: the newest N on a first run, the oldest N above the stored position and the highest post emitted otherwise), and the limits `TELEGRAM_FEED_LIMIT_MAX` (30), `TELEGRAM_FEED_PEEK_MAX` (20), `TELEGRAM_FEED_PAGE_SIZE`, `TELEGRAM_FEED_DEFAULT_LIMIT`.
