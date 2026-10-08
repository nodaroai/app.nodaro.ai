# Read Inspiration

> Read the posts saved to your Inspiration library — from the last hours or days, or from one day — as structured posts and as text for a prompt. Free.

> **Preview:** shown to administrators only until it is released to everyone.

## Overview

The Read Inspiration node reads the posts you saved to your [Inspiration](../../features/inspiration.md) library: the posts you bookmarked from Social Search, from a competitor's page, or through the API. It reads them by the day each was **saved**, optionally only one platform (X, Instagram, TikTok, YouTube, Reddit, LinkedIn, Meta Ads) and one tag. It emits them on its **JSON** output as posts — the same post shape a [Social Search](social-search.md) node emits — and on its **Posts** output as text, ready to paste into a prompt. Set the JSON wire to **Each** and the next node runs once per post.

## How it works

- Pick the **Platform** (or all of them) and, optionally, a **Tag** — only saves carrying that tag are read.
- Pick the **Period**:
  - **The last hours or days** — posts saved in the last N hours (up to 720) or days (up to 365).
  - **One day** — posts saved on one calendar day, read in the time zone your browser had when you picked the day (a day stored without a time zone — by an agent or a template — is read in UTC).
- Set **Max posts** (1–100) and the **Order** (newest or oldest first).
- Each post is the post as you saved it, plus when it was saved (`savedAt`), its note (`note`) and its tags (`tags`). The picture copied into your storage when you saved the post replaces the platform's own thumbnail, which expires within days.
- **Only the workflow's owner can run it.** It reads your own library, so a run of someone else's workflow — a published app's run, a workflow shared with you, a component — is refused (`403 owner_only`): the people running it would otherwise hand their posts to whoever built the steps after it.
- **Nothing in the period**: the run emits nothing on either output; the nodes behind it that needed that text are skipped, and the run ends `completed` with `outcome: "nothing_new"` (see [Runs that find nothing new](../../api-integration.md#runs-that-find-nothing-new)).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Platform | Select | All platforms | `all`, `x`, `instagram`, `tiktok`, `youtube`, `reddit`, `linkedin` or `meta_ads` |
| Tag | Text | — | Only saves carrying this tag (case and a leading `#` do not matter) |
| Period | Select | The last hours or days | `window` (the last N hours or days) or `day` (one calendar day) |
| Time window | Number + unit | 7 days | In window mode: the last N hours (1–720) or days (1–365) |
| Day | Date | today | In day mode: the day to read, in your time zone |
| Max posts | Number | 20 | 1–100 posts per run |
| Order | Select | Newest first | `Newest first` or `Oldest first`, by the day each post was saved |

## Inputs & Outputs

**Inputs:** none — the node is a source, like a feed.

**Outputs:**

| Handle | Type | Content |
|--------|------|---------|
| `json` (**JSON**) | list of posts | The posts of the period, one per item — the Social Search post shape plus `savedAt`, `note`, `tags` |
| `text` (**Posts**) | text | The posts as a digest — wire it into a prompt |

## On the canvas

After a run, the card shows the posts it read the way the [Telegram Channel Feed](telegram-channel-feed.md) shows its posts: the first post featured (picture or video, who posted it, views, text, the day it was published and the day it was saved, and **Open in Instagram** — or X, TikTok, … — for the original post), arrows and a thumbnail strip over the rest, and **View all** listing every post with its own link.

## Credits

Free. It reads what your account already holds.

## Example

```
Read Inspiration (Instagram, tag "hooks", last 7 days) ──► Generate Text ("Write 5 hooks in this style for our launch")
```

The writer gets the week's saved hooks as text and writes new ones in their style.

## Tips

- Tag what you save (on the Inspiration page) so a node can read one theme at a time.
- A video's own file link expires quickly; a post's page link and the copied picture do not.

## Related

- [Inspiration](../../features/inspiration.md) — the library, saving posts, tags
- [Read Competitor](competitor-read.md) — a tracked brand's posts as its scans found them
- [Social Search](social-search.md) — the post shape both nodes emit
