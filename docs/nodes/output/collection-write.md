# Save to Collection

> Keep each item a run produces as a record in a collection — text and links, never files. One record per item, no duplicates, free.

> **Preview:** shown to administrators only until it is released to everyone.

## Overview

The Save to Collection node is where a workflow's output lives after the run: articles, rewritten posts, leads, captions. Every item that reaches it becomes one record in the chosen [collection](../../features/collections.md) — searchable on the Collections page, exportable as CSV or JSON, readable back into a later run with [Read Collection](collection-read.md). A fan-out (one item per list row) saves one record per row; an item already in the collection is **not saved twice**.

## How it works

- Pick the **Collection** (or make one from the node's settings).
- Wire what to save into **Item**: a JSON object (from Generate Text, Extract Field, a feed, a scrape) fills the record by itself — the title from `title | headline | name | subject`, the text from `text | body | caption | description | content | summary | dek`, the link from `url | postUrl | link | href | permalink`, pictures and videos from `media[]` / `imageUrl` / `thumbnailUrl` / `videoUrl` / `audioUrl`, and every other text, number or true/false value into `fields`. Plain text becomes the record's text; a plain link (a row of a list of addresses) becomes the record's link.
- **Title**, **Text**, **Link** and **Duplicate key** set in the node (typed, or mapped from another node) **win** over what the item carries.
- A picture wired into **Image** and a video wired into **Video** are saved as **links** beside the record, together with the item's own media (`media`).
- **Duplicates:** the record's duplicate key is the **Duplicate key** field, else its link, else the item's `slug`, `postId`, `externalId` or a named `id` (a numeric id is not a key — each run numbers its items from 1). A record whose key is already in the collection is not saved again — the node reports `duplicate`, nothing fails, and the run goes on.
- **Re-runs:** when the same run re-picks the node (a retry after a crash, a resumed run) the write is recognised and answered with the existing record (`replayed`) — per fan-out iteration, inside sub-workflows too. A new run, an editor Run or "Run from here" is a new write; the duplicate key is what keeps those from saving the same story twice.
- **Caps:** a collection holds a number of records that depends on your plan (see [Collections](../../features/collections.md#caps)). Past the cap the oldest records are removed as new ones arrive; the write's result carries how many were evicted (`evicted`), and the Collections page shows a meter.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Collection | Picker | — | The collection to save into (one of yours) |
| Title | Text (mappable) | — | Empty: taken from the item |
| Text | Text (mappable) | — | Empty: taken from the item (a plain-text item is the text itself) |
| Link | Text (mappable) | — | Empty: the item's link |
| Duplicate key | Text (mappable) | — | Empty: the link, else the item's `slug`, `id` or `postId` |

## Inputs & Outputs

**Inputs:**

| Handle | Accepts | Content |
|--------|---------|---------|
| `in` (**Item**) | text, JSON, a list row | The item to save — one record per item (a row that is a link becomes the record's link) |
| `image` (**Image**) | image producers | Saved as a link in the record's `media` |
| `video` (**Video**) | video producers | Saved as a link in the record's `media` |

**Output:**

| Handle | Type | Content |
|--------|------|---------|
| `json` (**Record**) | record | The record saved (or the one already there) — `id`, `title`, `text`, `url`, `media`, `fields`, `dedupeKey`, `createdAt` |

## Credits

Free — saving a record costs 0 credits.

A record is text, not media, so it does not count against your media storage space. You can keep saving records even when your storage is full.

Workflow runs, from the editor or on the server, are not rate-limited here, so a long list can save every item. A direct API call with an API token or an app token is limited to 120 records a minute per token, the same as the Collections API.

## Example: an article pipeline that remembers

```
Generate Text (one article per story, as JSON) ──► Save to Collection ("articles")
Generate Image (one cover per story) ────────────┘ (Image)
```

The writer emits one JSON object per article (`{ "headline", "body", "slug", "primarySource" }`) on a fan-out; the image node fans out beside it. Save to Collection pairs them row by row: the article's `headline` and `body` become the record's title and text, `slug` is the duplicate key, the cover rides along as a media link. For the pairing to hold, set **both** wires into Save to Collection (Item and Image) to **Each**, and build the image prompts as an Each fan-out over the writer's items so the two lists have the same number of rows — lists of different lengths wrap around, and the fifth article would get the first cover. A cover that failed leaves its record without a picture; the article is still saved. A [Read Collection](../input/collection-read.md) node at the top of the next run reads the last 48 hours of "articles" into the story picker's prompt, so a story is never written twice.

## Tips

- Give the item a stable key (`slug`, the source `url`) — that is what keeps re-runs and overlapping feeds from creating duplicates.
- Records store text and links only (text up to 20,000 characters, 50 extra fields). A picture is kept as its link; a link from a Telegram feed expires within days — save the generated cover, not the source photo, when it must last.
- Run the node once on its own (Run button) before a schedule relies on it — it costs nothing.

## Related

- [Read Collection](../input/collection-read.md) — read records back into a run
- [Collections](../../features/collections.md) — the page, caps, export
- [API — Collections](../../api-integration.md#16d-collections), [SDK](../../sdk-reference.md#clientcollections), [MCP tools](../../mcp/tools.md#add_collection_record)
