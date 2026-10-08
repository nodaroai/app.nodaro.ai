# Read Competitor

> Read a tracked competitor's posts — published in the last hours or days, or on one day — as structured posts and as text for a prompt. Nodaro Cloud. Free.

> **Preview:** shown to administrators only until it is released to everyone.

## Overview

The Read Competitor node reads the posts of a brand you track on the [Competitors](../../features/competitors.md) page, as its scans found them: optionally one platform (X, Instagram, TikTok, YouTube, LinkedIn, Reddit, Meta Ads — the platforms the brand is read on), and the brand's own posts, the posts about it, or both. It emits them on its **JSON** output as posts — the same shape a [Social Search](social-search.md) node emits, plus each post's `role` — and on its **Posts** output as text, ready to paste into a prompt. Set the JSON wire to **Each** and the next node runs once per post.

## How it works

- Pick the **Competitor** — one of the brands you track.
- Pick the **Platform** (or all of them) and **Which posts**: their own posts (`own`), posts about them (`about`), or every post the scans found (`all` — the brand's own, the posts about it, and the market posts a scan reads beside them).
- Pick the **Period**:
  - **The last hours or days** — posts published in the last N hours (up to 720) or days (up to 365).
  - **One day** — posts published on one calendar day, read in the time zone your browser had when you picked the day (a day stored without a time zone — by an agent or a template — is read in UTC).
- Set **Max posts** (1–100) and the **Order** (newest or oldest first, by the day each was published).
- **It reads what the scans already found.** A scan reads each account's latest posts (up to 20 per account, about a month back). The node reads the scans taken in the period — spread evenly over it when there are more than 40 — and the first scan after it, and lists each post once, with the newest scan's numbers. A day no scan covered has no posts — scan the brand (or set it to scan daily) before relying on a short period. A post the platform gave no date for counts on the day the first scan saw it (one the scan before the period already held is not the period's). If a scan cannot be read, the run fails rather than return part of the period.
- The period is held to how long your plan keeps scans (one month to twelve, see [Competitors](../../features/competitors.md)).
- **Only the workflow's owner can run it.** It reads your own library, so a run of someone else's workflow — a published app's run, a workflow shared with you, a component — is refused (`403 owner_only`): the people running it would otherwise hand their posts to whoever built the steps after it.
- **Nothing in the period**: the run emits nothing on either output; the nodes behind it that needed that text are skipped, and the run ends `completed` with `outcome: "nothing_new"` (see [Runs that find nothing new](../../api-integration.md#runs-that-find-nothing-new)).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Competitor | Picker | — | The tracked brand to read |
| Platform | Select | All platforms | One of the platforms the brand is read on, or all |
| Which posts | Select | All the posts the scans found | `all`, `own` or `about` |
| Period | Select | The last hours or days | `window` (the last N hours or days) or `day` (one calendar day) |
| Time window | Number + unit | 7 days | In window mode: the last N hours (1–720) or days (1–365) |
| Day | Date | today | In day mode: the day to read, in your time zone |
| Max posts | Number | 20 | 1–100 posts per run |
| Order | Select | Newest first | `Newest first` or `Oldest first`, by the day each post was published |

## Inputs & Outputs

**Inputs:** none — the node is a source, like a feed.

**Outputs:**

| Handle | Type | Content |
|--------|------|---------|
| `json` (**JSON**) | list of posts | The posts of the period, one per item — the Social Search post shape plus `role` (`own`, `about` or `market`) |
| `text` (**Posts**) | text | The posts as a digest — wire it into a prompt |

## On the canvas

After a run, the card shows the posts it read the way the [Telegram Channel Feed](telegram-channel-feed.md) shows its posts: the first post featured (picture or video, who posted it, views, text, the day it was published, and **Open in Instagram** — or X, TikTok, … — for the original post), arrows and a thumbnail strip over the rest, and **View all** listing every post with its own link.

## Credits

Free. It reads scans you already ran; a scan itself is priced on the Competitors page.

## Example

```
Read Competitor (Acme, Instagram, their own posts, last 7 days) ──► Generate Text ("What worked for them this week, and what should we try?")
```

## Tips

- Pair it with a Schedule Trigger after the brand's daily scan to get each day's posts into a workflow.
- Posts about the brand (`about`) are other people's posts that name it — useful for what customers say.

## Related

- [Competitors](../../features/competitors.md) — tracking brands, scans, cards
- [Read Inspiration](inspiration-read.md) — the posts you saved
- [Social Search](social-search.md) — the post shape both nodes emit
