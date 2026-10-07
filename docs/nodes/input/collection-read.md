# Read Collection

> Read what a collection holds from the last N hours or days — as structured records and as text for a prompt. Free.

> **Preview:** shown to administrators only until it is released to everyone.

## Overview

The Read Collection node reads the records a [collection](../../features/collections.md) received inside a time window — the articles a pipeline wrote yesterday, the posts it saved this week. It emits them on its **JSON** output as records (one per item — set the wire to **Each** and a fan-out runs once per record) and on its **Records** output as text — headlines or full records — ready to paste into a prompt. Its classic job is cross-run dedupe: read the last 48 hours of a collection into the prompt of the node that picks stories, and tell it to drop anything already covered.

## How it works

- Pick the **Collection** (or make one from the node's settings).
- Set the **Time window** — the last N **hours** or **days**, up to 30 days back — and **Max records** (1–200).
- Each run reads the records saved inside that window, in the chosen **Order**, and emits them twice: as records (JSON) and as their text (**Text output**: `Headlines` — one line per record with its title, date and link; `Full records` — title, text and link of each record).
- **Nothing in the window**: the run emits nothing on either output; the nodes behind it that needed that text — a Generate Text, a Save to Collection — are skipped, and the run ends `completed` with `outcome: "nothing_new"` (see [Runs that find nothing new](../../api-integration.md#runs-that-find-nothing-new)).
- Records come from [Save to Collection](../output/collection-write.md), the Collections page, the API, the SDK, the CLI or MCP — the node reads them all the same.

## On the canvas

After a run, the card shows the records it read the way the [Telegram Channel Feed](telegram-channel-feed.md) shows posts:

- The first record, in the run's **Order**, is featured: its picture (the first image, else a video's poster), its title (else who posted it, when the item carried a handle or an author), its text, the views it carried, and its date.
- The date is the post's own when the item said when it went out — `publishedAt`, `date` or `timestamp` among its fields, written as an ISO date (`2026-10-06` or `2026-10-06T09:00:00Z`); otherwise the card says when the record was saved.
- **Open in Instagram** (or X, TikTok, YouTube, Telegram, … — any other site by its name, such as `nytimes.com`) opens the record's link, the original post. Only an `http(s)` link opens.
- The arrows and the thumbnail strip page through the rest; **View all** lists every record with its own link, and **Copy JSON** copies the run's records.
- The header says how many records the run read. An empty window says "No records in this window".

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Collection | Picker | — | The collection to read (one of yours) |
| Time window | Number + unit | 24 hours | The last N hours (1–720) or days (1–30) |
| Max records | Number | 50 | 1–200 records per run |
| Order | Select | Newest first | `Newest first` or `Oldest first` |
| Text output | Select | Headlines | `Headlines` (title · date · link per record) or `Full records` (title, text and link) |

## Inputs & Outputs

**Inputs:** none — the node is a source, like a feed.

**Outputs:**

| Handle | Type | Content |
|--------|------|---------|
| `json` (**JSON**) | list of records | The records in the window, one per item — wire it into a List, Extract Field, or (as an **Each** wire) a node that runs once per record |
| `text` (**Records**) | text | The digest in the chosen text output — wire it into a prompt |

Each record carries: `id`, `collectionId`, `title`, `text`, `url`, `media` (links to pictures / videos saved beside it), `fields` (the other keys of the item it was made from), `dedupeKey`, `source` (the node, workflow and run that saved it) and `createdAt`.

## Credits

Free — reading a collection costs 0 credits.

Reading works even when your media storage is full, because records are text.

Workflow runs, from the editor or on the server, are not rate-limited here. A direct API call with an API token or an app token is limited to 120 reads a minute per token.

## Example: do not cover the same story twice

```
Telegram Channel Feed ──► Combine Text ──► Generate Text (pick stories) ──► ...
Read Collection ("articles", last 48 hours, headlines) ──┘  (wired into the picker's System prompt input)
```

Wire the posts into the picker's **Prompt** input and leave its Prompt field empty, so a tick with nothing new skips the picker. Wire Read Collection into the picker's **System prompt** input and refer to it from the typed system prompt: "Here is what was already covered in the last two days: {Read Collection}. Drop any story on that list." (Typed text in the Prompt field would win over the wired posts, and a second wire into Prompt would replace them.) With [Save to Collection](../output/collection-write.md) at the end of the pipeline, every scheduled run knows what the earlier runs produced. Set **Max records** high enough for the window — two days of a 2-hour schedule at a dozen stories each is well over the default 50.

## Tips

- Keep the window a little longer than the schedule interval (a 2-hour schedule → a 24–48 hour window) so a late or skipped tick still sees the previous stories.
- Use `Headlines` for prompts: it is short and names each story once. `Full records` is for a node that needs the text itself (a summary of the week, a newsletter).
- A record's media are **links**, not files — a link from a Telegram feed expires within days.

## Related

- [Save to Collection](../output/collection-write.md) — the node that writes records
- [Collections](../../features/collections.md) — the page, caps, export
- [API — Collections](../../api-integration.md#16d-collections), [SDK](../../sdk-reference.md#clientcollections), [MCP tools](../../mcp/tools.md#read_collection)
