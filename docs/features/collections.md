# Collections

**Collections** are where a workflow's records live: named sets of records
your workflows save to and read back — the articles a news pipeline writes,
the posts a feed brought in, the leads a form collected. It is a page in the
sidebar (Activity → Collections), in preview for admins, and an API on every
edition.

A collection holds **text and links only, never files**. Each record has:

- a **title** and a **text** (the text up to 20,000 characters)
- a **link**, when the record has one (an `http(s)` address)
- **media links**: the addresses of its pictures, videos or sounds, as given.
  Links from a platform (Telegram, a social network) expire on that
  platform's schedule; a record keeps the link, not the file. A workflow that
  needs the picture later copies it with an upload node.
- **fields**: up to 50 extra scalar values (a channel, a score, a slug)
- where it came from: the node, workflow and run that saved it

## One record per story

The same link saved twice is one record: a collection deduplicates on a
**dedupe key**, which defaults to the record's link (a workflow or an API
call can set another key, such as an article's slug). Saving a record that is
already there answers with the existing record and `outcome: "duplicate"`;
nothing fails. A workflow run that is retried saves each record once more
under the same **idempotency key** and gets `outcome: "replayed"` back.

## How much a collection holds

| Plan | Collections | Records per collection |
|---|---|---|
| Free | 3 | 500 |
| Pay as you go | 10 | 5,000 |
| Basic | 10 | 5,000 |
| Standard | 30 | 20,000 |
| Pro | 100 | 100,000 |
| Business | 300 | 250,000 |

Past the records cap, the **oldest records are removed as new ones arrive** —
a scheduled pipeline is never stopped by a full collection, and the page shows
how full each one is. One write removes at most 100 records, so a cap that
drops at once (a plan that lapsed) trims a large collection a little per write
rather than emptying it in one go. Creating a collection past the collections cap is
refused (`403 collection_limit_reached`). A self-hosted server has no caps
unless the operator sets `COLLECTIONS_MAX_PER_USER` /
`COLLECTIONS_MAX_RECORDS_PER_COLLECTION` (see [deployment](../deployment.md)).

## The page

- **Collections**: every collection with its description, how many records it
  holds and how full it is. **New collection** asks for a name (unique for
  you, whatever its case) and a description. The menu on a card renames or
  deletes a collection; deleting one deletes its records, after asking.
- **A collection**: its records newest first. Type words to search titles,
  texts and links; a record's headline opens its link; the bin on a record
  removes it (after asking). **Export** downloads the whole collection as CSV
  or JSON, newest first. Cells that a spreadsheet would read as a formula are
  written as text.

## In a workflow

Two nodes write and read collections from a workflow —
[**Save to Collection**](../nodes/output/collection-write.md) (one record per
item it receives; a JSON item fills the title, text and link by itself; no
duplicates) and [**Read Collection**](../nodes/input/collection-read.md) (what
was saved in the last N hours or days, as a list and as text for a prompt).
Both are free. The API, SDK, CLI and MCP below write and read the same records.

## From code

The same collections are available over the API (`/v1/collections`, see
[API integration](../api-integration.md#16d-collections)), the SDK
(`client.collections`, see the [SDK reference](../sdk-reference.md#clientcollections)),
the CLI (`nodaro collections`, see [CLI](../cli.md)) and MCP
(`list_collections`, `read_collection`, `add_collection_record`, see
[MCP tools](../mcp/tools.md#list_collections)).

Collections are free; they use no credits.
