# Topics

**Topics** follows a hashtag or phrase with no brand around it ("ai video",
"#ugcads") and tells you what is spreading in it. It is a page in the
sidebar (Activity → Topics) on Nodaro Cloud, in preview for admins.

## Following a topic

Press **Add a topic** and choose:

- **Name:** how the topic is shown to you.
- **Search for:** the hashtag or phrase a scan searches (the name, unless
  you give another). A post is kept only when it names it as a whole word,
  phrase or hashtag, never as part of another word or handle.
- **Platforms:** where to search it (TikTok, Instagram, YouTube and X by
  default; Reddit and LinkedIn too).
- **Posts per search:** 20, 40 or 60. A scan reads the posts each platform
  ranks highest for the term, not every post that uses it: a busy hashtag
  can have millions. More posts give a fuller picture of what is working.
- **Schedule:** weekly (the default), daily, or no schedule (scan only when
  you press **Scan now**).

Following a topic is free. Standard plans can follow 10 topics, Pro 30 and
Business 50; Free and Basic plans see the page locked.

## What a scan costs

A scan searches the term once on each platform you picked. 20 posts is one
Social Search page, 40 two and 60 three; YouTube and Reddit return one page
whatever is asked. Each page costs 22 credits<!-- credits: topic-scan:per-page -->.
Four platforms at 20 posts is four pages,
88 credits<!-- credits: topic-scan:per-page@4 -->; the same four at 60 posts is
3 + 3 + 3 + 1 = 10 pages, 220 credits<!-- credits: topic-scan:per-page@10 -->.
The window shows the price before you save, and the scan button shows it.
Searches that fail are not charged; if every search fails, nothing is
charged. Scheduled scans cost the same as manual ones.

## What you see

- **Latest scan:** the posts it kept, most reach first, on every platform.
- **Cards:** what to act on, as on the Competitors page: a post in the topic
  spreading fast, complaints piling up, the topic being talked about more
  than before.
- **Over time:** how many posts each scan found per platform, and their
  reach, scan by scan.

Scans are kept for as long as your plan keeps Competitors scans.

## From code

The same topics, scans and cards are available over the API (`/v1/topics*`,
see [API integration](../api-integration.md#16d-topics-nodaro-cloud)).
