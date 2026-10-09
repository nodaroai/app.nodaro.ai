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
- whether it has been **used**, when, and by what (a workflow and its run, the API, or you)

## Used and not yet used

A record starts out **not used yet**. It becomes **used** when:

- a [Save to Collection](../nodes/output/collection-write.md) node with **Mark the item as used** on saves it — the pattern of a queue: a [Read Collection](../nodes/input/collection-read.md) node hands a record to the run, the run posts it, and a Save to Collection into a "published" collection marks the original as used, once that save has run (the mark does not wait for the post, which runs beside it; a record already used keeps its first "used by");
- you mark it on the page (**Mark as used**, and **Mark as not used** to undo);
- the API, SDK or CLI marks it (`PATCH /v1/collections/:id/records/:recordId`).

Read Collection can read **only the records not used yet** (or only the used ones) inside its time window, so a queue takes what is left and a record goes out once. Nothing is deleted by being used; the page keeps both lists, and **Mark as not used** puts a record back in the queue.

## The Trash

A delete — on the page, through the API (`DELETE /v1/collections/:id/records/:recordId`,
the bulk call), the SDK or the CLI — moves a record to the collection's
**Trash** rather than removing it. A record in the Trash leaves every list,
every [Read Collection](../nodes/input/collection-read.md) read, every export
and every MCP read, but keeps its row: its dedupe key still holds (saving the
same story again is a duplicate of it, and the record **stays in the Trash**
— a pipeline that keeps seeing the same item never undoes a delete), it keeps
its used / not-used state, and it **still counts toward the collection's
cap**, where it is evicted like any other record, oldest first. **Restore** —
on the Trash tab, one record or a selection — brings it back as it was.
Nothing in the Trash expires on its own: **Delete forever** (a record or a
selection on the Trash tab; `DELETE …/records/:recordId/permanent` or the bulk
call's `delete` action) removes it for good and frees its place under the
cap. A live record cannot be deleted for good in one step — it goes to the
Trash first.

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
- **A collection**: its records as numbered cards, newest first or **Oldest
  first**, a page at a time (6, 12 or 24 per page, with page numbers and
  "Showing a–b of N"). Four tabs with counts — **All**, **Used**, **Not used
  yet**, **Trash**. Type words to search titles, texts and links; pick a
  **From** / **To** day (or Today, Last 7 days, Last 30 days, Any time) to see
  one day or a range — the header names the day or the range and how many
  records it holds. Every card carries a provenance row: **Source** (the
  record's link, by its site), **Workflow** (a link to the workflow that saved
  it), when it was saved, and **Open run** (the run that saved it, in the
  editor's Executions tab; a record written by hand says so instead). A used
  record wears a **Used** pill, says when and by what it was used (with the
  same links), and offers **Undo**; a record not used yet offers **Mark as
  used**. **Delete** moves a record to the **Trash** after asking; **Select
  multiple** shows a checkbox beside every card and a bar to select the whole
  page, move the selection to the Trash, or — on the Trash tab — **Restore**
  it; a card in the Trash offers **Restore** on its own. A record with a
  picture or a video shows a thumbnail. **Export** downloads the live records
  (the Trash left out) as CSV or JSON, newest first. Cells that a spreadsheet
  would read as a formula are written as text.

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
