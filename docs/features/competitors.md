# Competitors

**Competitors** tracks brands (your competitors, or your own brand) and
tells you what to do about them. It is a page in the sidebar (Activity →
Competitors) on Nodaro Cloud, in preview for admins.

## Adding a brand

Press **Add a brand** and paste its website, then **Find accounts**. Nodaro
reads the site and fills in the accounts it links: TikTok, Instagram,
YouTube, X, a LinkedIn company page. Accounts the site does not link may be
filled in as guesses, marked **Guess, check it**. Check every account, and
add a Meta advertiser if you want their ads read too.

A YouTube account is an `@handle` or a channel link
(`youtube.com/channel/…`). An old custom link (`youtube.com/c/…` or
`/user/…`) is refused: searched by its name it can lead to someone else's
channel. Open the channel and copy its `@handle` instead.

Then choose:

- **Search posts that name it on:** the platforms where a scan also looks
  for other people's posts that name the brand (TikTok, Instagram, YouTube,
  X and Reddit by default; LinkedIn too).
- **Schedule:** weekly (the default), daily, or no schedule (scan only when
  you press **Scan now**).
- **This is my brand:** track yourself. Cards about your own brand speak to
  you ("your post did 5x your usual: make another one like it"), and the
  kinds that only make sense about someone else are left out.

Adding a brand is free.

## What a scan costs

A scan runs one Social Search page (up to 20 posts) per account and per
platform its name is searched on. A brand with two accounts and five
platforms is seven searches, so a scan costs seven Social Search pages.
The window shows the price before you save, and the **Scan now** button
shows it on each brand. Searches that fail are not charged; if every search
fails, nothing is charged. Scheduled scans cost the same as manual ones.

## Action cards

**What to do now** lists the cards from each brand's latest scan, most
urgent first:

| Card | What it says |
|---|---|
| A post did several times their usual | One of their new posts went far beyond what their posts on that platform usually reach. The idea worked: study it and make your own version. |
| A new announcement | They posted about something new. Answer while people are talking. |
| Complaints | New posts about them complain. Show how you solve exactly this. |
| A post about them is spreading fast | Someone else's post about them is gaining reach quickly. React while it is hot. |
| A sound in their new videos | The same TikTok sound in several of their new videos. Check the rights before a brand account uses it. |
| A sound around several competitors | The same sound with several of the brands you track: a trend in your market. |
| More people talking about them | Clearly more posts about them than in the scan before, counted only on the platforms both scans could read. |
| Posting more | They are posting noticeably more on a platform than the week before. |

A post is new when no earlier stored scan had it and it went up after the
last scan that could read its platform, so a search that fails one week
does not turn old posts into news the next. Cards of one kind are ranked by
how strong they are, across all your brands.

The API's card kinds also include `top_in_sources`; competitor scans do not
produce it.

Each card shows the posts it rests on; the bookmark on a post saves it to
[Inspiration](./inspiration.md). **Posts** on a brand opens everything its
latest scan found: their posts, and the posts about them.

The newest twelve scans of each brand are kept. While a scan of a brand
runs, its name, accounts and platforms cannot be changed (the scan was
priced on them); its schedule can.

## What works

**What works for you** (on the brand marked **This is my brand**) and **What
works for them** (on a competitor) read the brand's own posts across every
scan kept, and say what its best posts share. Open it with the button on the
brand's row, or the tab in its posts.

Per platform it shows:

- how many of the brand's posts it read, and their usual reach (the median);
- its **lessons**: a trait its best posts share, and how far posts with that
  trait went compared with the rest — a video length, a format, opening with
  a question, a first line that starts with a number, a short or a long
  caption, a hashtag, a sound, or the day of the week (UTC). Each lesson
  shows the posts it rests on;
- its best posts, which you can save to [Inspiration](./inspiration.md).

A platform needs enough of the brand's own posts before it gets lessons (the
tab says how many it has and how many it needs); each scan adds more. It is
free: it reads the scans already made and charges nothing.

**Content Ideas learns from it.** A [Content Ideas](../nodes/ai-text/content-ideas.md)
node leans its ideas on what works for your own brand (the one marked **This
is my brand**; with several, the one scanned last), and on the advice that
worked for you (see **Did it work?** below), and after a run says which
brand it read. Turn it off with **Learn from my brand's results** in the
node's settings. It costs nothing more.

## Did it work?

When you act on a card, press **I did this** on it. You can paste the link to
your post that came of it right there, pick it from your recent posts, or
press **Later**. The button is on the cards whose advice ends in a post of
yours: a post like a competitor's hit, an answer to a launch or to
complaints about a competitor, a sound to try. Marked cards move to **Tried**.

Each scan of your own brand then checks how it went: once your post is a few
days old, it is compared with your usual on the same platform, and the card
says **Worked: 2.1x your usual**, **About your usual** or **Below your
usual**, with both numbers. The first answer stays, even as the post keeps
growing. A sound card finds its post by itself: your first post with that
sound after the advice. Without a linked post, the card shows how your posts
since went, without a verdict, and offers them to pick from. When a result
comes in, the wall says so.

Results add up per kind of advice: **Sound advice: 3 of 4 worked for you**.
Once a kind has enough results, its record shows on its cards and in **What
works for you**, and the cards of a kind that keeps working for you come
first among cards of the same urgency (a kind that keeps missing goes last).
Urgency always comes first. Content Ideas leans on the same record.

It needs your own brand tracked and scanned (**This is my brand**). It is
free. **Undo** removes a mark and its result.

## From code

The same brands, scans, cards, lessons and marks are available over the API
(`/v1/competitors*`, see [API integration](../api-integration.md#16c-competitors-nodaro-cloud)),
the SDK (`client.competitors`), the CLI (`nodaro competitors`) and MCP
(`list_competitors`, `competitor_cards`, `competitor_lessons`,
`competitor_tried`, `mark_card_done`, `add_competitor`, `scan_competitor`).
